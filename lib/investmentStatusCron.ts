// Investment status tracker — runs via /api/cron/investment-status (called by external cron)
// Schedule: 9:00 AM and 12:00 PM IST daily (just after pms_master_sheet updates at 8am/11am)
//
// Pipeline (ONE-TIME payments only — SIPs are tracked via webhooks):
//   PAYMENT_SUCCESS  →  (gateway settlement has a UTR?)              → SETTLED
//                        Cashfree: PGFetchSettlements(order_id) has transfer_utr
//                        Razorpay: settlements/recon/combined row for the payment id is settled
//   SETTLED          →  (cash_in_out match in pms_master_sheet?)     → DEPLOYED
//   PENDING_PAYMENT  →  (older than 2 days, payment_type ≠ SIP?)     → EXPIRED
//
// Client notifications: Cashfree rows notify as the web always has. Razorpay rows (mobile app) follow
// shouldNotifyClient() — silent with test keys / RAZORPAY_NOTIFY_CLIENT=false, so a real client account
// can be used for testing without being emailed.
//
// IMPORTANT: Steps run SEQUENTIALLY — checkSettlements must complete before
// checkDeployments so that orders newly settled in this run can also be
// marked DEPLOYED in the same run (rather than waiting for the next cron).
import pool from '@/lib/db'
import { Cashfree, CFEnvironment } from 'cashfree-pg'
import { notifyClientById } from '@/lib/notifications'
import { fetchRazorpaySettlementRecon, shouldNotifyClient } from '@/lib/razorpay'

const SETTLEMENT_TOLERANCE = 0.05  // ±5% — covers gateway charges deducted pre-settlement

// Razorpay rows are only ever notified when the keys/flag say so (see header).
const notifyAllowed = (gateway: string | null | undefined) => gateway !== 'razorpay' || shouldNotifyClient()

function initCashfree() {
  const clientId     = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const environment  = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX
  if (!clientId || !clientSecret) throw new Error('Cashfree credentials not configured')
  return new Cashfree(environment, clientId, clientSecret)
}

// ── Step 1: PAYMENT_SUCCESS → SETTLED ────────────────────────────────────────
// Poll the gateway's settlement data for each pending transaction.
// Only advances status when a UTR is present (funds actually moved).
async function checkSettlements(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT order_id, cf_payment_id, amount, client_id, gateway, razorpay_payment_id, created_at
     FROM payment_transactions
     WHERE investment_status = 'PAYMENT_SUCCESS'
       AND payment_type      != 'SIP'
       AND created_at        >= NOW() - INTERVAL '30 days'`
  )
  if (rows.length === 0) return 0

  const cashfreeRows = rows.filter((r) => r.gateway !== 'razorpay')
  const razorpayRows = rows.filter((r) => r.gateway === 'razorpay')
  let settled = 0

  const markSettled = async (tx: any, settlementAmount: number | null, utr: string, settledAt: Date | null) => {
    await pool.query(
      `UPDATE payment_transactions SET
         investment_status = 'SETTLED',
         settlement_amount = $1,
         transfer_utr      = $2,
         settled_at        = COALESCE($3::timestamptz, NOW()),
         updated_at        = NOW()
       WHERE order_id = $4`,
      [settlementAmount, utr, settledAt, tx.order_id]
    )
    console.log(`[cron] SETTLED: ${tx.order_id} UTR=${utr}`)
    settled++

    // Notify investor that Qode has received their funds
    if (notifyAllowed(tx.gateway)) {
      notifyClientById(tx.client_id, 'SETTLED', {
        amount:  parseFloat(tx.amount),
        orderId: tx.order_id,
      }).catch(() => {})
    }
  }

  // Cashfree (web orders) — one settlements query per order, as before.
  if (cashfreeRows.length > 0) {
    const cashfree = initCashfree()
    for (const tx of cashfreeRows) {
      try {
        const resp: any = await cashfree.PGFetchSettlements('2023-08-01', undefined, undefined, {
          pagination: { limit: 5, cursor: null },
          filters:    { order_ids: [tx.order_id] },
        })

        const settlements: any[] = resp?.data?.data ?? []
        const match = settlements.find(
          (s: any) => s.transfer_utr && s.order_id === tx.order_id
        )
        if (match) await markSettled(tx, match.settlement_amount ?? null, match.transfer_utr, null)
      } catch (err) {
        console.warn(`[cron] Settlement check failed for ${tx.order_id}:`, err)
      }
    }
  }

  // Razorpay (mobile orders) — the recon report is per calendar month, so fetch each month between the
  // oldest pending order and today once, then look every pending payment up in it.
  if (razorpayRows.length > 0) {
    try {
      const recon = new Map<string, any>()
      const months = new Set<string>()
      const now = new Date()
      for (const tx of razorpayRows) {
        const d = new Date(tx.created_at)
        for (const m = new Date(d.getFullYear(), d.getMonth(), 1); m <= now; m.setMonth(m.getMonth() + 1)) {
          months.add(`${m.getFullYear()}-${m.getMonth() + 1}`)
        }
      }
      for (const ym of months) {
        const [y, m] = ym.split('-').map(Number)
        for (const item of await fetchRazorpaySettlementRecon(y, m)) {
          if (item?.type === 'payment' && item.entity_id) recon.set(item.entity_id, item)
        }
      }
      for (const tx of razorpayRows) {
        try {
          const item = tx.razorpay_payment_id ? recon.get(tx.razorpay_payment_id) : null
          if (!item || !item.settled || !item.settlement_utr) continue
          await markSettled(
            tx,
            item.credit != null ? Number(item.credit) / 100 : null,
            String(item.settlement_utr),
            item.settled_at ? new Date(Number(item.settled_at) * 1000) : null
          )
        } catch (err) {
          console.warn(`[cron] Settlement check failed for ${tx.order_id}:`, err)
        }
      }
    } catch (err) {
      console.warn('[cron] Razorpay settlement recon failed:', err)
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
    `SELECT order_id, nuvama_code, amount, settlement_amount, settled_at, client_id, strategy_type, gateway
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
      if (notifyAllowed(tx.gateway)) {
        notifyClientById(tx.client_id, 'DEPLOYED', {
          amount:       matchAmount,
          orderId:      tx.order_id,
          strategyType: tx.strategy_type ?? undefined,
          deployedAt:   String(deployedDate),
        }).catch(() => {})
      }
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
  // Razorpay SIP mandates that were never authorised: Razorpay itself expires the subscription after
  // 2 days (expire_by, lib/razorpay.ts); this keeps our row in step so it leaves the client's pending list.
  // Cashfree SIP rows are left alone (SUBSCRIPTION_EXPIRED webhook handles those).
  const sip = await pool.query(
    `UPDATE payment_transactions SET
       investment_status = 'EXPIRED',
       updated_at        = NOW()
     WHERE investment_status = 'PENDING_PAYMENT'
       AND payment_type  = 'SIP'
       AND gateway       = 'razorpay'
       AND created_at    <  NOW() - INTERVAL '2 days'`
  )
  return (rowCount ?? 0) + (sip.rowCount ?? 0)
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
