// GET /api/razorpay/payment-details?order_id=...
//
// Backs the success page. The interesting case is the race it exists to absorb:
// the browser can return from checkout BEFORE Razorpay's webhook lands, so the
// local row may still say PENDING_PAYMENT even though the money is captured.
//
// When the local row is non-terminal, this route reconciles against the live
// Razorpay API rather than reporting stale data — which is what stops the
// success page from telling a user their completed payment is still pending.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import pool from '@/lib/db'
import {
  getRazorpayClient,
  toInvestmentStatus,
  toPaise,
  TERMINAL_INVESTMENT_STATUSES,
} from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

interface SessionClient { clientid: string; clientcode: string }

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    if (cookieStore.get('qode-auth')?.value !== '1') {
      return NextResponse.json(
        { success: false, error: 'Not authenticated', error_code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    let sessionClients: SessionClient[] = []
    try {
      sessionClients = JSON.parse(cookieStore.get('qode-clients')?.value ?? '[]')
    } catch {
      sessionClients = []
    }

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('order_id')
    const subscriptionId = searchParams.get('subscription_id')

    if (!orderId && !subscriptionId) {
      return NextResponse.json(
        { success: false, error: 'order_id or subscription_id is required', error_code: 'MISSING_ID' },
        { status: 400 },
      )
    }

    // Accept either our own receipt or Razorpay's order id, since the success
    // page may hold whichever the checkout handler returned.
    const { rows } = await pool.query(
      `SELECT * FROM payment_transactions
        WHERE gateway = 'razorpay'
          AND ($1::text IS NULL OR order_id = $1 OR razorpay_order_id = $1)
          AND ($2::text IS NULL OR razorpay_subscription_id = $2)
        ORDER BY created_at DESC
        LIMIT 1`,
      [orderId, subscriptionId],
    )

    if (!rows.length) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found', error_code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    let tx = rows[0]

    // Never let one client read another's transaction.
    const owns = sessionClients.some(
      (c) => c.clientcode === tx.nuvama_code || c.clientid === String(tx.client_id),
    )
    if (!owns) {
      console.warn(`[razorpay/payment-details] ownership check failed for order=${orderId ?? subscriptionId}`)
      return NextResponse.json(
        { success: false, error: 'Not found', error_code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    // ── Reconcile if we might be looking at pre-webhook state ───────────────
    const isTerminal = TERMINAL_INVESTMENT_STATUSES.includes(tx.investment_status)

    if (!isTerminal && tx.razorpay_order_id) {
      try {
        const razorpay = getRazorpayClient()
        const payments: any = await (razorpay.orders as any).fetchPayments(tx.razorpay_order_id)
        const list: any[] = payments?.items ?? []

        // Prefer a captured payment; fall back to the most recent attempt.
        const captured = list.find((p) => p.status === 'captured')
        const latest = captured ?? list[list.length - 1]

        if (latest) {
          const investStatus = toInvestmentStatus(latest.status)
          const amountOk = Number(latest.amount) === toPaise(tx.amount)

          if (!amountOk && latest.status === 'captured') {
            console.error(
              `[razorpay/payment-details] AMOUNT MISMATCH order=${tx.razorpay_order_id} ` +
              `expected=${toPaise(tx.amount)} captured=${latest.amount}`,
            )
          }

          const { rows: refreshed } = await pool.query(
            `UPDATE payment_transactions SET
               razorpay_payment_id = COALESCE(razorpay_payment_id, $1),
               payment_status      = $2,
               payment_time        = COALESCE(payment_time, $3),
               payment_method      = COALESCE($4, payment_method),
               investment_status   = CASE
                 WHEN investment_status = ANY($5::text[]) THEN investment_status
                 ELSE $6
               END,
               updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
            [
              latest.id,
              latest.status,
              latest.created_at ? new Date(latest.created_at * 1000) : null,
              latest.method
                ? JSON.stringify({ method: latest.method, bank: latest.bank, wallet: latest.wallet, vpa: latest.vpa })
                : null,
              TERMINAL_INVESTMENT_STATUSES as unknown as string[],
              // Only promote to a terminal status when the amount is right.
              amountOk ? investStatus : 'PENDING_PAYMENT',
              tx.id,
            ],
          )
          if (refreshed.length) tx = refreshed[0]
        }
      } catch (err) {
        // Reconciliation is best-effort — return the local row rather than 500.
        console.warn('[razorpay/payment-details] reconcile failed, returning local state:', err)
      }
    }

    const settled = tx.investment_status === 'PAYMENT_SUCCESS'
                 || tx.investment_status === 'SETTLED'
                 || tx.investment_status === 'DEPLOYED'

    return NextResponse.json({
      success: true,
      order_id:                 tx.order_id,
      razorpay_order_id:        tx.razorpay_order_id,
      razorpay_payment_id:      tx.razorpay_payment_id,
      razorpay_subscription_id: tx.razorpay_subscription_id,
      amount:                   parseFloat(tx.amount),
      currency:                 tx.currency,
      payment_type:             tx.payment_type,
      payment_status:           tx.payment_status,
      investment_status:        tx.investment_status,
      payment_method:           tx.payment_method,
      payment_time:             tx.payment_time,
      bank_reference:           tx.bank_reference,
      client_name:              tx.client_name,
      nuvama_code:              tx.nuvama_code,
      strategy_type:            tx.strategy_type,
      is_new_strategy:          tx.is_new_strategy,
      frequency:                tx.frequency,
      next_charge_date:         tx.next_charge_date,
      // Mandate verification state — the success page uses this to explain a
      // SIP that is authorised but deliberately not yet active.
      payer_verification_status: tx.payer_verification_status,
      payer_account_last4:       tx.payer_account_last4,
      settled,
      // True while we are still waiting on a webhook; drives UI polling.
      pending: !settled && tx.investment_status === 'PENDING_PAYMENT',
    })
  } catch (error: any) {
    console.error('[razorpay/payment-details] unhandled:', error)
    return NextResponse.json(
      { success: false, error: 'Could not fetch payment details', error_code: 'FETCH_FAILED' },
      { status: 500 },
    )
  }
}
