// Investment status tracker — runs via /api/cron/investment-status (called by external cron)
// Schedule: 9:00 AM and 12:00 PM IST daily (just after pms_master_sheet updates at 8am/11am)
//
// Pipeline:
//   PAYMENT_SUCCESS → (Cashfree settlement API has transfer_utr?) → SETTLED
//   SETTLED         → (cash_in_out match in pms_master_sheet?)    → DEPLOYED
import pool from '@/lib/db'
import { Cashfree, CFEnvironment } from 'cashfree-pg'

const SETTLEMENT_TOLERANCE = 0.05  // 5% — covers Cashfree service charges

function initCashfree() {
  const clientId     = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const environment  = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX
  if (!clientId || !clientSecret) throw new Error('Cashfree credentials not configured')
  return new Cashfree(environment, clientId, clientSecret)
}

// ── Step 1: PAYMENT_SUCCESS → SETTLED ────────────────────────────────────────
// Query Cashfree settlements API by order_id to check if transfer_utr is present.
async function checkSettlements(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT order_id, cf_payment_id, amount
     FROM payment_transactions
     WHERE investment_status = 'PAYMENT_SUCCESS'
       AND created_at >= NOW() - INTERVAL '30 days'`
  )
  if (rows.length === 0) return 0

  const cashfree = initCashfree()
  let settled = 0

  for (const tx of rows) {
    try {
      // POST /settlements with order_id filter
      const resp: any = await cashfree.PGFetchSettlements('2023-08-01', undefined, undefined, {
        pagination: { limit: 5, cursor: null },
        filters: { order_ids: [tx.order_id] },
      })

      const settlements: any[] = resp?.data?.data ?? []
      const match = settlements.find((s: any) => s.transfer_utr && s.order_id === tx.order_id)

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
      }
    } catch (err) {
      console.warn(`[cron] Settlement check failed for ${tx.order_id}:`, err)
    }
  }
  return settled
}

// ── Step 2: SETTLED → DEPLOYED ───────────────────────────────────────────────
// Match settlement_amount against cash_in_out in pms_master_sheet within ±5%
// on the account_code, within the last 7 days.
async function checkDeployments(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT order_id, nuvama_code, amount, settlement_amount, settled_at
     FROM payment_transactions
     WHERE investment_status = 'SETTLED'
       AND created_at >= NOW() - INTERVAL '30 days'`
  )
  if (rows.length === 0) return 0

  let deployed = 0

  for (const tx of rows) {
    const matchAmount = parseFloat(tx.settlement_amount ?? tx.amount)
    const low  = matchAmount * (1 - SETTLEMENT_TOLERANCE)
    const high = matchAmount * (1 + SETTLEMENT_TOLERANCE)

    // Look for a cash_in_out entry on this account within 7 days of settlement
    const { rows: matches } = await pool.query(
      `SELECT report_date, cash_in_out
       FROM pms_master_sheet
       WHERE account_code = $1
         AND cash_in_out BETWEEN $2 AND $3
         AND report_date >= COALESCE($4::date, CURRENT_DATE - INTERVAL '7 days')
         AND report_date <= CURRENT_DATE
       LIMIT 1`,
      [tx.nuvama_code, low, high, tx.settled_at ? new Date(tx.settled_at).toISOString().split('T')[0] : null]
    )

    if (matches.length > 0) {
      await pool.query(
        `UPDATE payment_transactions SET
           investment_status = 'DEPLOYED',
           deployed_at       = $1,
           updated_at        = NOW()
         WHERE order_id = $2`,
        [matches[0].report_date, tx.order_id]
      )
      console.log(`[cron] DEPLOYED: ${tx.order_id} on ${matches[0].report_date}`)
      deployed++
    }
  }
  return deployed
}

// ── Step 3: Mark stale PENDING_PAYMENT as EXPIRED ────────────────────────────
async function expireStale(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE payment_transactions SET
       investment_status = 'EXPIRED',
       updated_at        = NOW()
     WHERE investment_status = 'PENDING_PAYMENT'
       AND created_at < NOW() - INTERVAL '2 days'`
  )
  return rowCount ?? 0
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function runInvestmentStatusCron(): Promise<{
  settled: number; deployed: number; expired: number
}> {
  console.log('[cron] Investment status check started', new Date().toISOString())

  const [settled, deployed, expired] = await Promise.all([
    checkSettlements().catch(e => { console.error('[cron] settlements error:', e); return 0 }),
    checkDeployments().catch(e => { console.error('[cron] deployments error:', e); return 0 }),
    expireStale().catch(e => { console.error('[cron] expire error:', e); return 0 }),
  ])

  console.log(`[cron] Done — settled=${settled} deployed=${deployed} expired=${expired}`)
  return { settled, deployed, expired }
}
