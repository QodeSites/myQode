// Investment status tracker — runs via /api/cron/investment-status (called by external cron)
// Schedule: 9:00 AM and 12:00 PM IST daily (just after pms_master_sheet updates at 8am/11am)
//
// Pipeline (ONE-TIME payments only — SIPs are tracked via webhooks):
//   PAYMENT_SUCCESS  →  (Cashfree settlement API has transfer_utr?)  → SETTLED
//   SETTLED          →  (cash_in_out match in pms_master_sheet?)     → DEPLOYED
//   PENDING_PAYMENT  →  (older than 2 days, payment_type ≠ SIP?)     → EXPIRED
//
// IMPORTANT: Steps run SEQUENTIALLY — checkSettlements must complete before
// checkDeployments so that orders newly settled in this run can also be
// marked DEPLOYED in the same run (rather than waiting for the next cron).
import pool from '@/lib/db'
import { Cashfree, CFEnvironment } from 'cashfree-pg'
import { notifyClientById } from '@/lib/notifications'

const SETTLEMENT_TOLERANCE = 0.05  // ±5% — covers Cashfree service charges deducted pre-settlement

function initCashfree() {
  const clientId     = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const environment  = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX
  if (!clientId || !clientSecret) throw new Error('Cashfree credentials not configured')
  return new Cashfree(environment, clientId, clientSecret)
}

// ── Step 1: PAYMENT_SUCCESS → SETTLED ────────────────────────────────────────
// Poll Cashfree's settlements API for each pending transaction.
// Only advances status when transfer_utr is present (funds actually moved).
async function checkSettlements(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT order_id, cf_payment_id, amount, client_id
     FROM payment_transactions
     WHERE investment_status = 'PAYMENT_SUCCESS'
       AND payment_type      != 'SIP'
       AND created_at        >= NOW() - INTERVAL '30 days'`
  )
  if (rows.length === 0) return 0

  const cashfree = initCashfree()
  let settled = 0

  for (const tx of rows) {
    try {
      const resp: any = await cashfree.PGFetchSettlements('2023-08-01', undefined, undefined, {
        pagination: { limit: 5, cursor: null },
        filters:    { order_ids: [tx.order_id] },
      })

      const settlements: any[] = resp?.data?.data ?? []
      const match = settlements.find(
        (s: any) => s.transfer_utr && s.order_id === tx.order_id
      )

      if (match) {
        await pool.query(
          `UPDATE payment_transactions SET
             investment_status = 'SETTLED',
             settlement_amount = $1,
             transfer_utr      = $2,
             settled_at        = NOW(),
             updated_at        = NOW()
           WHERE order_id = $3`,
          [match.settlement_amount ?? null, match.transfer_utr, tx.order_id]
        )
        console.log(`[cron] SETTLED: ${tx.order_id} UTR=${match.transfer_utr}`)
        settled++

        // Notify investor that Qode has received their funds
        notifyClientById(tx.client_id, 'SETTLED', {
          amount:  parseFloat(tx.amount),
          orderId: tx.order_id,
        }).catch(() => {})
      }
    } catch (err) {
      console.warn(`[cron] Settlement check failed for ${tx.order_id}:`, err)
    }
  }
  return settled
}

// ── Step 2: SETTLED → DEPLOYED ───────────────────────────────────────────────
// Match settlement_amount against pms_master_sheet.cash_in_out within ±5%
// for the account_code, within 7 days after settled_at.
// This confirms the money was actually deployed into the PMS strategy.
async function checkDeployments(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT order_id, nuvama_code, amount, settlement_amount, settled_at, client_id, strategy_type
     FROM payment_transactions
     WHERE investment_status = 'SETTLED'
       AND payment_type      != 'SIP'
       AND created_at        >= NOW() - INTERVAL '30 days'`
  )
  if (rows.length === 0) return 0

  let deployed = 0

  for (const tx of rows) {
    const matchAmount = parseFloat(tx.settlement_amount ?? tx.amount)
    const low  = matchAmount * (1 - SETTLEMENT_TOLERANCE)
    const high = matchAmount * (1 + SETTLEMENT_TOLERANCE)

    const settledDate = tx.settled_at
      ? new Date(tx.settled_at).toISOString().split('T')[0]
      : null

    const { rows: matches } = await pool.query(
      `SELECT report_date, cash_in_out
       FROM pms_master_sheet
       WHERE account_code = $1
         AND cash_in_out  BETWEEN $2 AND $3
         AND report_date  >= COALESCE($4::date, CURRENT_DATE - INTERVAL '7 days')
         AND report_date  <= CURRENT_DATE
       ORDER BY report_date ASC
       LIMIT 1`,
      [tx.nuvama_code, low, high, settledDate]
    )

    if (matches.length > 0) {
      const deployedDate = matches[0].report_date

      await pool.query(
        `UPDATE payment_transactions SET
           investment_status = 'DEPLOYED',
           deployed_at       = $1,
           updated_at        = NOW()
         WHERE order_id = $2`,
        [deployedDate, tx.order_id]
      )
      console.log(`[cron] DEPLOYED: ${tx.order_id} on ${deployedDate}`)
      deployed++

      // Notify investor — this is the final, most important status update
      notifyClientById(tx.client_id, 'DEPLOYED', {
        amount:       matchAmount,
        orderId:      tx.order_id,
        strategyType: tx.strategy_type ?? undefined,
        deployedAt:   String(deployedDate),
      }).catch(() => {})
    }
  }
  return deployed
}

// ── Step 3: Mark stale PENDING_PAYMENT as EXPIRED ────────────────────────────
// Only for one-time orders (not SIPs — SIP expiry is handled via SUBSCRIPTION_EXPIRED webhook).
// Orders unpaid after 2 days are considered abandoned.
async function expireStale(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE payment_transactions SET
       investment_status = 'EXPIRED',
       updated_at        = NOW()
     WHERE investment_status = 'PENDING_PAYMENT'
       AND payment_type  != 'SIP'
       AND created_at    <  NOW() - INTERVAL '2 days'`
  )
  return rowCount ?? 0
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function runInvestmentStatusCron(): Promise<{
  settled: number
  deployed: number
  expired: number
}> {
  const start = new Date()
  console.log('[cron] Investment status check started', start.toISOString())

  // Run SEQUENTIALLY: settlements first, then deployments.
  // If run in parallel (Promise.all), orders settled in this run are missed
  // by checkDeployments because the SETTLED update hasn't committed yet.
  let settled = 0
  let deployed = 0
  let expired = 0

  try {
    settled = await checkSettlements()
  } catch (e) {
    console.error('[cron] settlements error:', e)
  }

  try {
    deployed = await checkDeployments()
  } catch (e) {
    console.error('[cron] deployments error:', e)
  }

  try {
    expired = await expireStale()
  } catch (e) {
    console.error('[cron] expire error:', e)
  }

  const elapsed = Date.now() - start.getTime()
  console.log(
    `[cron] Done — settled=${settled} deployed=${deployed} expired=${expired} elapsed=${elapsed}ms`
  )
  return { settled, deployed, expired }
}
