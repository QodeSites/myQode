// POST /api/mobile/payments/razorpay/webhook
// Razorpay → server. Configure in the Razorpay dashboard with RAZORPAY_WEBHOOK_SECRET and the events
// payment.captured, payment.failed, order.paid, refund.processed (one-time payments) plus
// subscription.authenticated, subscription.activated, subscription.charged, subscription.pending,
// subscription.halted, subscription.cancelled, subscription.paused, subscription.resumed,
// subscription.completed (SIPs).
// Verifies X-Razorpay-Signature over the raw body.
// Updates payment_transactions (+ sip_charges per installment). Client notifications use the same
// lib/notifications events as the Cashfree webhook (SIP_ACTIVE, SIP_PAYMENT_SUCCESS, …) and follow the
// keys: on with live keys, off with test keys — see shouldNotifyClient() in lib/razorpay.ts;
// RAZORPAY_NOTIFY_CLIENT=true|false overrides.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyWebhookSignature, paymentMethodJson, shouldNotifyClient } from '@/lib/razorpay'
import { notifyIrPayment } from '@/lib/mobileIrMail'

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

  // Forward-only, same rules as verify-sip / investment-status: finished states stick, a charged or paused
  // SIP never drops back to "registered", and Mandate Failed (recorded by the return route after a bank
  // decline, or by `halted`) only moves on if Razorpay reports the mandate live again (`active`).
  const { rows } = await pool.query(
    `UPDATE payment_transactions t
     SET investment_status = CASE
           WHEN t.investment_status IN ('SIP_CANCELLED','SIP_COMPLETED') THEN t.investment_status
           WHEN t.investment_status = 'SIP_MANDATE_FAILED' AND $1 <> 'SIP_ACTIVE' THEN t.investment_status
           WHEN t.investment_status IN ('SIP_ACTIVE','SIP_PAUSED') AND $1 IN ('SIP_AUTHORISED','PENDING_PAYMENT') THEN t.investment_status
           ELSE $1 END,
         payment_status = COALESCE($5, t.payment_status),      -- Razorpay's own state: authenticated | active | paused …
         next_charge_date = COALESCE($2::date, t.next_charge_date),
         razorpay_payment_id = COALESCE($3, t.razorpay_payment_id),
         updated_at = NOW()
     FROM (SELECT id, investment_status AS prev_status FROM payment_transactions
           WHERE razorpay_subscription_id = $4 AND gateway = 'razorpay' FOR UPDATE) old
     WHERE t.id = old.id
     RETURNING t.client_id, t.nuvama_code, t.amount, t.order_id, t.frequency, t.investment_status, t.next_charge_date, old.prev_status`,
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

  // Investor Relations: "SIP set up", once, when the webhook is what first confirmed the mandate.
  if (tx.prev_status === 'PENDING_PAYMENT' && ['SIP_AUTHORISED', 'SIP_ACTIVE'].includes(tx.investment_status)) {
    notifyIrPayment({ kind: 'sip', accountId: tx.nuvama_code, clientId: tx.client_id, userEmail: null, amount: Number(tx.amount), reference: subId, frequency: tx.frequency })
  }

  // Client notifications — the same events, per state, that the Cashfree webhook sends on the web.
  if (shouldNotifyClient()) {
    const { notifyClientById } = await import('@/lib/notifications')
    const base = { amount: Number(tx.amount), subscriptionId: subId, frequency: tx.frequency || undefined }
    const next = tx.next_charge_date ? String(tx.next_charge_date).slice(0, 10) : nextChargeDate || undefined
    const becameLive = ['PENDING_PAYMENT', 'SIP_MANDATE_FAILED'].includes(tx.prev_status)
      && ['SIP_AUTHORISED', 'SIP_ACTIVE'].includes(tx.investment_status)
    let note: Promise<void> | null = null
    if (becameLive && (event === 'subscription.authenticated' || event === 'subscription.activated')) {
      note = notifyClientById(tx.client_id, 'SIP_ACTIVE', { ...base, nextChargeDate: next })
    } else if (event === 'subscription.charged') {
      note = notifyClientById(tx.client_id, 'SIP_PAYMENT_SUCCESS', {
        ...base, amount: payment?.amount ? Number(payment.amount) / 100 : Number(tx.amount),
        installmentNumber: sub?.paid_count || undefined, nextChargeDate: next,
      })
    } else if (event === 'subscription.pending' || event === 'subscription.halted') {
      // a scheduled debit failed (pending = Razorpay is retrying; halted = it gave up)
      note = notifyClientById(tx.client_id, 'SIP_PAYMENT_FAILED', {
        ...base, installmentNumber: sub?.paid_count ? Number(sub.paid_count) + 1 : undefined,
        failureReason: payment?.error_description || (event === 'subscription.halted' ? 'Instalment debits failed repeatedly; the SIP has been halted' : 'Instalment debit failed; Razorpay will retry'),
      })
    } else if (event === 'subscription.cancelled' && tx.prev_status !== 'SIP_CANCELLED') {
      note = notifyClientById(tx.client_id, 'SIP_CANCELLED', base)
    } else if (event === 'subscription.completed' && tx.prev_status !== 'SIP_COMPLETED') {
      note = notifyClientById(tx.client_id, 'SIP_COMPLETED', base)
    }
    if (note) note.catch(() => {})
  }

  return NextResponse.json({ ok: true, updated: rows.length, investStatus: tx.investment_status })
}

// refund.processed: money went back to the client. A full refund cancels the investment (web: Cashfree
// REFUND SUCCESS → CANCELLED unless already DEPLOYED); a partial one is only noted on the row.
async function handleRefund(evt: any) {
  const refund = evt?.payload?.refund?.entity
  const payment = evt?.payload?.payment?.entity
  const paymentId: string = refund?.payment_id || payment?.id || ''
  if (!paymentId) return NextResponse.json({ ok: true, ignored: 'refund without payment id' })
  const refunded = Number(payment?.amount_refunded ?? refund?.amount ?? 0)
  const full = payment?.amount ? refunded >= Number(payment.amount) : true
  const partial = 'Partial refund of \u20b9' + (Number(refund?.amount || 0) / 100).toLocaleString('en-IN')
  const { rowCount } = await pool.query(
    `UPDATE payment_transactions
     SET investment_status = CASE WHEN $1 AND investment_status <> 'DEPLOYED' THEN 'CANCELLED' ELSE investment_status END,
         payment_status    = CASE WHEN $1 THEN 'REFUNDED' ELSE payment_status END,
         payment_message   = $2,
         updated_at        = NOW()
     WHERE razorpay_payment_id = $3 AND gateway = 'razorpay' AND payment_type <> 'SIP'`,
    [full, `${full ? 'Refund' : partial} processed: ${refund?.id || ''}`.trim(), paymentId]
  )
  return NextResponse.json({ ok: true, updated: rowCount || 0, full })
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
  if (event === 'refund.processed') {
    try { return await handleRefund(evt) }
    catch (err) { console.error('[mobile/payments/razorpay/webhook] refund', err); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }) }
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
      `UPDATE payment_transactions t
       SET payment_status = $1,
           investment_status = CASE
             WHEN t.investment_status IN ('DEPLOYED','SETTLED','CANCELLED','EXPIRED') THEN t.investment_status
             WHEN t.investment_status = 'PAYMENT_SUCCESS' AND $2 = 'PAYMENT_FAILED' THEN t.investment_status
             ELSE $2 END,
           razorpay_payment_id = COALESCE($3, t.razorpay_payment_id),
           payment_time   = COALESCE(to_timestamp($4::double precision), t.payment_time),
           payment_method = COALESCE($5::jsonb, t.payment_method),
           bank_reference = COALESCE($6, t.bank_reference),
           payment_message = COALESCE($7, t.payment_message),
           updated_at = NOW()
       FROM (SELECT id, investment_status AS prev_status FROM payment_transactions
             WHERE razorpay_order_id = $8 AND gateway = 'razorpay' FOR UPDATE) old
       WHERE t.id = old.id
       RETURNING t.client_id, t.nuvama_code, t.amount, t.order_id, t.investment_status, t.strategy_type, old.prev_status`,
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

    if (rows.length && rows[0].prev_status === 'PENDING_PAYMENT' && rows[0].investment_status === 'PAYMENT_SUCCESS') {
      notifyIrPayment({ kind: 'one_time', accountId: rows[0].nuvama_code, clientId: rows[0].client_id, userEmail: null, amount: Number(rows[0].amount), reference: orderId, method: payment?.method || null })
    }
    if (rows.length && shouldNotifyClient()) {
      const { notifyClientById } = await import('@/lib/notifications')
      const tx = rows[0]
      // Only when this event actually changed the row (a captured payment re-delivered, or payment.failed
      // after a success, must not e-mail the client again).
      if (tx.investment_status === investmentStatus && tx.prev_status !== investmentStatus) {
        notifyClientById(tx.client_id, investmentStatus === 'PAYMENT_SUCCESS' ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED', {
          orderId: tx.order_id, amount: Number(tx.amount), strategyType: tx.strategy_type || undefined,
          failureReason: investmentStatus === 'PAYMENT_FAILED' ? payment?.error_description || undefined : undefined,
        }).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true, updated: rows.length })
  } catch (err) {
    console.error('[mobile/payments/razorpay/webhook]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
