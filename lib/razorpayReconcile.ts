// Razorpay reconciliation — the safety net beneath the webhook.
//
// Webhooks are reliable but not guaranteed: a deploy during delivery, a DNS
// blip, or an expired retry window all leave a payment captured at Razorpay but
// PENDING_PAYMENT in our ledger. Left alone, the client's money is taken and the
// portal shows nothing.
//
// This runs on a schedule and asks Razorpay directly. Order matters:
//   1. Reconcile pending orders  — pull true state from the gateway.
//   2. Expire genuinely stale    — only AFTER step 1 has had its say, so a
//                                  missed webhook can never cause a paid order
//                                  to be marked EXPIRED.
//
// Deliberately NOT handled here: SETTLED and DEPLOYED transitions. Those are
// driven by the PMS master-sheet match in investmentStatusCron.ts, which is
// gateway-agnostic and already runs for both.
import pool from '@/lib/db'
import {
  getRazorpayClient,
  toInvestmentStatus,
  toPaise,
  TERMINAL_INVESTMENT_STATUSES,
} from '@/lib/razorpay'
import { notifyClientById } from '@/lib/notifications'

/** How long an unpaid order may sit before being written off. */
const EXPIRY_HOURS = 48
/** How far back to look. Beyond this, ops handles it manually. */
const LOOKBACK_DAYS = 30

interface ReconcileResult {
  checked:   number
  recovered: number
  failed:    number
  expired:   number
  mandatesPending: number
}

/**
 * Step 1 — ask Razorpay what actually happened to each pending order.
 *
 * Only touches rows that are still non-terminal, so a settled payment is never
 * re-examined and cannot be regressed.
 */
async function reconcilePendingOrders(): Promise<{ checked: number; recovered: number; failed: number }> {
  const { rows } = await pool.query(
    `SELECT id, order_id, razorpay_order_id, client_id, amount, investment_status,
            strategy_type, nuvama_code
       FROM payment_transactions
      WHERE gateway            = 'razorpay'
        AND payment_type      != 'SIP'
        AND razorpay_order_id IS NOT NULL
        AND investment_status  = 'PENDING_PAYMENT'
        AND created_at        >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'
      ORDER BY created_at DESC
      LIMIT 200`,
  )

  if (!rows.length) return { checked: 0, recovered: 0, failed: 0 }

  const razorpay = getRazorpayClient()
  let recovered = 0
  let failed = 0

  for (const tx of rows) {
    try {
      const resp: any = await (razorpay.orders as any).fetchPayments(tx.razorpay_order_id)
      const payments: any[] = resp?.items ?? []

      if (!payments.length) continue   // nobody ever attempted payment

      // A captured payment is definitive. Otherwise inspect the latest attempt.
      const captured = payments.find((p) => p.status === 'captured')
      const latest   = captured ?? payments[payments.length - 1]
      const investStatus = toInvestmentStatus(latest.status)

      if (investStatus === 'PENDING_PAYMENT') continue  // still genuinely in flight

      // Never promote to success on an amount we did not ask for.
      if (latest.status === 'captured' && Number(latest.amount) !== toPaise(tx.amount)) {
        console.error(
          `[razorpay-reconcile] AMOUNT MISMATCH order=${tx.razorpay_order_id} ` +
          `expected=${toPaise(tx.amount)} captured=${latest.amount} — left pending for ops`,
        )
        await pool.query(
          `UPDATE payment_transactions
              SET payment_message = $1, updated_at = NOW()
            WHERE id = $2`,
          [`Reconcile: captured ${latest.amount} paise != ordered ${toPaise(tx.amount)} paise`, tx.id],
        )
        continue
      }

      const { rows: updated } = await pool.query(
        `UPDATE payment_transactions SET
           razorpay_payment_id = COALESCE(razorpay_payment_id, $1),
           payment_status      = $2,
           payment_time        = COALESCE(payment_time, $3),
           payment_method      = COALESCE($4, payment_method),
           payment_message     = COALESCE($5, payment_message),
           investment_status   = CASE
             WHEN investment_status = ANY($6::text[]) THEN investment_status
             ELSE $7
           END,
           updated_at = NOW()
         WHERE id = $8
         RETURNING investment_status, client_id, amount, order_id, strategy_type`,
        [
          latest.id,
          latest.status,
          latest.created_at ? new Date(latest.created_at * 1000) : null,
          latest.method
            ? JSON.stringify({ method: latest.method, bank: latest.bank, wallet: latest.wallet, vpa: latest.vpa })
            : null,
          latest.error_description ?? null,
          TERMINAL_INVESTMENT_STATUSES as unknown as string[],
          investStatus,
          tx.id,
        ],
      )

      const row = updated[0]
      if (!row) continue

      if (row.investment_status === 'PAYMENT_SUCCESS') {
        recovered++
        console.log(
          `[razorpay-reconcile] RECOVERED order=${tx.order_id} payment=${latest.id} ` +
          `— webhook was missed`,
        )
        notifyClientById(row.client_id, 'PAYMENT_SUCCESS', {
          amount:       parseFloat(row.amount),
          orderId:      row.order_id,
          strategyType: row.strategy_type ?? undefined,
        }).catch(() => {})
      } else if (row.investment_status === 'PAYMENT_FAILED') {
        failed++
        console.log(`[razorpay-reconcile] marked failed order=${tx.order_id}`)
      }
    } catch (err) {
      console.warn(`[razorpay-reconcile] check failed for ${tx.razorpay_order_id}:`, err)
    }
  }

  return { checked: rows.length, recovered, failed }
}

/**
 * Step 2 — expire orders that are still unpaid well past the window.
 *
 * Runs only after reconcilePendingOrders, so anything Razorpay knows about has
 * already been pulled in. What remains was genuinely never paid.
 */
async function expireStaleOrders(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE payment_transactions SET
       investment_status = 'EXPIRED',
       payment_message   = COALESCE(payment_message, 'Order expired — no payment received'),
       updated_at        = NOW()
     WHERE gateway            = 'razorpay'
       AND payment_type      != 'SIP'
       AND investment_status  = 'PENDING_PAYMENT'
       AND created_at        <  NOW() - INTERVAL '${EXPIRY_HOURS} hours'`,
  )
  return rowCount ?? 0
}

/**
 * Step 3 — report mandates waiting on payer verification.
 *
 * These are SIPs the customer authorised but which we refused to activate
 * because the payer account could not be matched to the registered account
 * (TPV being disabled). They need a human, so surface the count loudly rather
 * than letting them sit silently.
 */
async function reportPendingMandates(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT razorpay_subscription_id, nuvama_code, payer_verification_status,
            payer_account_last4, payer_verification_note, updated_at
       FROM payment_transactions
      WHERE gateway = 'razorpay'
        AND payment_type = 'SIP'
        AND payer_verification_status IN ('PENDING','MISMATCH','UNVERIFIABLE')
        AND investment_status NOT IN ('SIP_CANCELLED','SIP_COMPLETED','EXPIRED')`,
  )

  if (rows.length) {
    console.warn(`[razorpay-reconcile] ${rows.length} SIP mandate(s) awaiting payer verification:`)
    for (const r of rows) {
      console.warn(
        `  - ${r.razorpay_subscription_id} nuvama=${r.nuvama_code} ` +
        `status=${r.payer_verification_status} payer_last4=${r.payer_account_last4 ?? 'n/a'}`,
      )
    }
  }

  return rows.length
}

export async function runRazorpayReconcile(): Promise<ReconcileResult> {
  const start = Date.now()
  console.log('[razorpay-reconcile] started', new Date(start).toISOString())

  let checked = 0, recovered = 0, failed = 0, expired = 0, mandatesPending = 0

  // Sequential and order-dependent: expiry must not run before reconciliation.
  try {
    const r = await reconcilePendingOrders()
    checked = r.checked; recovered = r.recovered; failed = r.failed
  } catch (e) {
    console.error('[razorpay-reconcile] reconcile error:', e)
  }

  try {
    expired = await expireStaleOrders()
  } catch (e) {
    console.error('[razorpay-reconcile] expiry error:', e)
  }

  try {
    mandatesPending = await reportPendingMandates()
  } catch (e) {
    console.error('[razorpay-reconcile] mandate report error:', e)
  }

  console.log(
    `[razorpay-reconcile] done in ${Date.now() - start}ms — ` +
    `checked=${checked} recovered=${recovered} failed=${failed} expired=${expired} ` +
    `mandates_pending=${mandatesPending}`,
  )

  return { checked, recovered, failed, expired, mandatesPending }
}
