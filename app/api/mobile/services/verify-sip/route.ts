// GET /api/mobile/services/verify-sip?subscriptionId=sub_xxx
// Called by the mobile app immediately after the Razorpay Checkout mandate-authorisation flow completes
// (success or failure). Syncs the live subscription status from Razorpay into payment_transactions so the
// user sees the correct state without waiting for a webhook — the SIP equivalent of
// /api/mobile/payments/razorpay/verify for one-time orders.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { fetchRazorpaySubscription } from '@/lib/razorpay'

// Razorpay subscription_status → Qode investment_status
// SIP_AUTHORISED = mandate registered, first instalment still ahead (Razorpay `authenticated`, or `created`
// with our signed payment id). SIP_ACTIVE = at least one instalment charged (Razorpay `active`/`pending`).
// Only SIP_ACTIVE can be paused; both can be cancelled.
function mapStatus(rzStatus: string): string {
  switch ((rzStatus || '').toLowerCase()) {
    case 'active':
    case 'pending':        return 'SIP_ACTIVE'       // 'pending' = mandate live, a charge retry is in progress
    case 'authenticated':  return 'SIP_AUTHORISED'    // mandate authorised, first charge not yet attempted
    case 'halted':         return 'SIP_MANDATE_FAILED' // Razorpay halts after repeated charge failures
    case 'cancelled':      return 'SIP_CANCELLED'
    case 'completed':      return 'SIP_COMPLETED'
    case 'expired':        return 'SIP_MANDATE_FAILED'
    case 'created':
    default:                return 'PENDING_PAYMENT'   // not yet authorised
  }
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const subscriptionId = searchParams.get('subscriptionId')
  if (!subscriptionId) return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 })

  try {
    const txRes = await pool.query(
      `SELECT order_id, nuvama_code, client_id, amount, payment_type, payment_status, investment_status,
              frequency, razorpay_subscription_id, payment_message
       FROM payment_transactions WHERE razorpay_subscription_id = $1 LIMIT 1`,
      [subscriptionId]
    )
    if (!txRes.rows.length) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    const tx = txRes.rows[0]

    if (!user!.accountCodes?.includes(tx.nuvama_code)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (tx.payment_type !== 'SIP') return NextResponse.json({ error: 'This endpoint is for SIP subscriptions only' }, { status: 400 })

    const rzSub: any = await fetchRazorpaySubscription(subscriptionId)
    const rzStatus = rzSub.status ?? 'unknown'
    // Razorpay can still report `created` for a few seconds after the client authorised (an immediate first
    // charge is captured asynchronously). Our own record wins there: a signed payment id from the return
    // route, or a row already marked active, means the mandate IS authorised — never downgrade it because
    // the gateway has not caught up yet (that downgrade made the app void a perfectly good SIP).
    const authorised = !!tx.razorpay_payment_id || ['SIP_AUTHORISED', 'SIP_ACTIVE', 'SIP_PAUSED'].includes(tx.investment_status)
    const mapped = mapStatus(rzStatus)
    const investStatus = mapped === 'PENDING_PAYMENT' && authorised
      ? (['SIP_ACTIVE', 'SIP_PAUSED'].includes(tx.investment_status) ? tx.investment_status : 'SIP_AUTHORISED')
      : mapped
    // IST calendar date (en-CA gives YYYY-MM-DD); toISOString would report the UTC day, one day early
    const nextChargeDate = rzSub.charge_at ? new Date(rzSub.charge_at * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null

    const statusChanged = tx.investment_status !== investStatus
    if (statusChanged) {
      await pool.query(
        `UPDATE payment_transactions SET
           payment_status    = $1,
           investment_status = CASE
             WHEN investment_status IN ('SIP_CANCELLED','SIP_COMPLETED','SIP_MANDATE_FAILED') THEN investment_status
             WHEN investment_status IN ('SIP_AUTHORISED','SIP_ACTIVE','SIP_PAUSED') AND $2 = 'PENDING_PAYMENT' THEN investment_status   -- never back to pending
             WHEN investment_status IN ('SIP_ACTIVE','SIP_PAUSED') AND $2 = 'SIP_AUTHORISED' THEN investment_status         -- never back from charged to registered
             ELSE $2
           END,
           next_charge_date  = COALESCE($3::date, next_charge_date),
           updated_at        = NOW()
         WHERE razorpay_subscription_id = $4`,
        [rzStatus, investStatus, nextChargeDate, subscriptionId]
      )
    }

    // What the row ended up as: a terminal state we already recorded (e.g. Mandate Failed after a bank decline,
    // even though we then voided the subscription on Razorpay → 'cancelled') is what the client is told.
    const TERMINAL = ['SIP_CANCELLED', 'SIP_COMPLETED', 'SIP_MANDATE_FAILED']
    const finalStatus = TERMINAL.includes(tx.investment_status) ? tx.investment_status : investStatus
    return NextResponse.json({
      subscriptionId,
      razorpaySubscriptionStatus: rzStatus,
      investmentStatus: finalStatus,
      isActive: finalStatus === 'SIP_ACTIVE' || finalStatus === 'SIP_AUTHORISED',     // mandate live (set-up succeeded)
      isCharged: finalStatus === 'SIP_ACTIVE',                                          // first instalment done → pausable
      authorised: authorised && !TERMINAL.includes(finalStatus),
      isMandatePending: finalStatus === 'PENDING_PAYMENT',
      isFailed: finalStatus === 'SIP_MANDATE_FAILED',
      amount: parseFloat(tx.amount),
      frequency: tx.frequency,
      nextChargeDate: nextChargeDate ?? null,
      lastError: tx.payment_message || null,          // Razorpay's reason for the last failed authorisation
      authAttempts: rzSub.auth_attempts ?? 0,
      paidCount: rzSub.paid_count ?? 0,
      remainingCount: rzSub.remaining_count ?? null,
    })
  } catch (err: any) {
    console.error('[mobile/services/verify-sip]', err)
    if (err?.message?.includes('404') || /not exist/i.test(err?.message || '')) {
      return NextResponse.json({ error: 'Subscription not found on Razorpay' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to verify SIP status' }, { status: 500 })
  }
}
