// POST /api/mobile/payments/razorpay/webhook
// Razorpay → server. Configure in the Razorpay dashboard with RAZORPAY_WEBHOOK_SECRET and the events
// payment.captured, payment.failed, order.paid (one-time payments) plus subscription.authenticated,
// subscription.activated, subscription.charged, subscription.pending, subscription.halted,
// subscription.cancelled, subscription.paused, subscription.resumed, subscription.completed (SIPs).
// Verifies X-Razorpay-Signature over the raw body.
// Updates payment_transactions (+ sip_charges per installment). Client notifications (lib/notifications,
// like the Cashfree webhook) follow the keys: on with live keys, off with test keys — see
// shouldNotifyClient() in lib/razorpay.ts; RAZORPAY_NOTIFY_CLIENT=true|false overrides.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyWebhookSignature, paymentMethodJson, shouldNotifyClient } from '@/lib/razorpay'

// Razorpay subscription_status → Qode investment_status (same mapping as verify-sip)
function mapSubStatus(rzStatus: string): string {
  switch ((rzStatus || '').toLowerCase()) {
    case 'active':
    case 'pending':       return 'SIP_ACTIVE'        // at least one instalment charged
    case 'authenticated': return 'SIP_AUTHORISED'    // mandate registered, first charge ahead
    case 'halted':
    case 'expired':       return 'SIP_MANDATE_FAILED'
    case 'cancelled':     return 'SIP_CANCELLED'
    case 'paused':        return 'SIP_PAUSED'
    case 'completed':     return 'SIP_COMPLETED'
    default:               return 'PENDING_PAYMENT'
  }
}

async function handleSubscriptionEvent(event: string, evt: any) {
  const sub = evt?.payload?.subscription?.entity
  const subId: string = sub?.id || ''
  if (!subId) return NextResponse.json({ ok: true, ignored: event })

  const payment = evt?.payload?.payment?.entity   // present on subscription.charged
  const investStatus = mapSubStatus(sub?.status)
  const nextChargeDate = sub?.charge_at ? new Date(sub.charge_at * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null

  const { rows } = await pool.query(
    `UPDATE payment_transactions
     SET investment_status = CASE
           WHEN investment_status IN ('SIP_CANCELLED','SIP_COMPLETED') THEN investment_status
           WHEN investment_status IN ('SIP_ACTIVE','SIP_PAUSED') AND $1 IN ('SIP_AUTHORISED','PENDING_PAYMENT') THEN investment_status
           ELSE $1 END,
         payment_status = COALESCE($5, payment_status),      -- Razorpay's own state: authenticated | active | paused …
         next_charge_date = COALESCE($2::date, next_charge_date),
         razorpay_payment_id = COALESCE($3, razorpay_payment_id),
         updated_at = NOW()
     WHERE razorpay_subscription_id = $4 AND gateway = 'razorpay'
     RETURNING client_id, nuvama_code, amount, order_id, frequency`,
    [investStatus, nextChargeDate, payment?.id || null, subId, sub?.status ? String(sub.status).toLowerCase() : null]
  )
  if (!rows.length) return NextResponse.json({ ok: true, ignored: 'unknown subscription ' + subId })
  const tx = rows[0]

  // subscription.charged: one installment was actually debited — record it in sip_charges (per-installment
  // history, same shape the Cashfree webhook already writes) so Investments can show a charge timeline.
  if (event === 'subscription.charged' && payment?.id) {
    await pool.query(
      `INSERT INTO sip_charges (
         subscription_id, razorpay_subscription_id, gateway, nuvama_code, client_id,
         installment_number, charge_amount, currency, charge_status,
         razorpay_payment_id, payment_time, charge_date, bank_reference, payment_method, created_at, updated_at
       ) VALUES ($1,$2,'razorpay',$3,$4,$5,$6,'INR','SUCCESS',$7,to_timestamp($8::double precision),CURRENT_DATE,$9,$10::jsonb,NOW(),NOW())
       ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL DO NOTHING`,
      [
        tx.order_id, subId, tx.nuvama_code, tx.client_id, sub?.paid_count || null,
        payment.amount ? Number(payment.amount) / 100 : Number(tx.amount),
        payment.id, payment.created_at ? Number(payment.created_at) : null,
        payment.acquirer_data?.rrn || null, JSON.stringify(paymentMethodJson(payment)),
      ]
    )
  }

  if (shouldNotifyClient() && event === 'subscription.charged') {
    const { notifyClientById } = await import('@/lib/notifications')
    notifyClientById(tx.client_id, 'PAYMENT_SUCCESS', {
      orderId: tx.order_id, amount: Number(tx.amount), nuvamaCode: tx.nuvama_code,
    } as any).catch(() => {})
  }

  return NextResponse.json({ ok: true, updated: rows.length, investStatus })
}

const SUBSCRIPTION_EVENTS = new Set([
  'subscription.authenticated', 'subscription.activated', 'subscription.charged', 'subscription.pending',
  'subscription.halted', 'subscription.cancelled', 'subscription.paused', 'subscription.resumed', 'subscription.completed',
])

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const sig = request.headers.get('x-razorpay-signature') || ''
  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let evt: any
  try { evt = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const event: string = evt?.event || ''

  if (SUBSCRIPTION_EVENTS.has(event)) {
    try { return await handleSubscriptionEvent(event, evt) }
    catch (err) { console.error('[mobile/payments/razorpay/webhook] subscription event', err); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }) }
  }

  const payment = evt?.payload?.payment?.entity
  const orderId: string = payment?.order_id || evt?.payload?.order?.entity?.id || ''
  if (!orderId) return NextResponse.json({ ok: true, ignored: event })

  try {
    let investmentStatus: string | null = null
    if (event === 'payment.captured' || event === 'order.paid') investmentStatus = 'PAYMENT_SUCCESS'
    else if (event === 'payment.failed') investmentStatus = 'PAYMENT_FAILED'
    if (!investmentStatus) return NextResponse.json({ ok: true, ignored: event })

    const { rows } = await pool.query(
      `UPDATE payment_transactions
       SET payment_status = $1,
           investment_status = CASE
             WHEN investment_status IN ('DEPLOYED','SETTLED','CANCELLED','EXPIRED') THEN investment_status
             WHEN investment_status = 'PAYMENT_SUCCESS' AND $2 = 'PAYMENT_FAILED' THEN investment_status
             ELSE $2 END,
           razorpay_payment_id = COALESCE($3, razorpay_payment_id),
           payment_time   = COALESCE(to_timestamp($4::double precision), payment_time),
           payment_method = COALESCE($5::jsonb, payment_method),
           bank_reference = COALESCE($6, bank_reference),
           payment_message = COALESCE($7, payment_message),
           updated_at = NOW()
       WHERE razorpay_order_id = $8 AND gateway = 'razorpay'
       RETURNING client_id, nuvama_code, amount, order_id, investment_status`,
      [
        String(payment?.status || (investmentStatus === 'PAYMENT_SUCCESS' ? 'captured' : 'failed')).toUpperCase(),
        investmentStatus,
        payment?.id || null,
        payment?.created_at ? Number(payment.created_at) : null,
        payment ? JSON.stringify(paymentMethodJson(payment)) : null,
        payment?.acquirer_data?.rrn || null,
        payment?.error_description || null,
        orderId,
      ]
    )

    if (rows.length && shouldNotifyClient()) {
      const { notifyClientById } = await import('@/lib/notifications')
      const tx = rows[0]
      notifyClientById(tx.client_id, investmentStatus === 'PAYMENT_SUCCESS' ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED', {
        orderId: tx.order_id, amount: Number(tx.amount), nuvamaCode: tx.nuvama_code,
      } as any).catch(() => {})
    }

    return NextResponse.json({ ok: true, updated: rows.length })
  } catch (err) {
    console.error('[mobile/payments/razorpay/webhook]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
