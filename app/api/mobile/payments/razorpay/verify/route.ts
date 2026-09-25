// POST /api/mobile/payments/razorpay/verify
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }  (from Checkout's success handler)
// Also: { razorpay_order_id } alone → re-checks the order's payments with Razorpay (e.g. after a closed WebView).
// Verifies the signature, confirms the payment with Razorpay, and updates payment_transactions.
// Never notifies the client (the webhook is the only place notifications could be wired).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { verifyPaymentSignature, fetchRazorpayPayment, fetchRazorpayOrderPayments, fetchRazorpayOrder, paymentMethodJson } from '@/lib/razorpay'
import { notifyIrPayment } from '@/lib/mobileIrMail'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const orderId = String(body?.razorpay_order_id || '').trim()
  const paymentId = String(body?.razorpay_payment_id || '').trim()
  const signature = String(body?.razorpay_signature || '').trim()
  if (!orderId) return NextResponse.json({ error: 'razorpay_order_id is required' }, { status: 400 })

  try {
    const { rows } = await pool.query(
      `SELECT order_id, nuvama_code, amount, payment_status, investment_status, razorpay_payment_id
       FROM payment_transactions WHERE razorpay_order_id = $1 LIMIT 1`,
      [orderId]
    )
    if (!rows.length) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    const tx = rows[0]
    if (!user!.accountCodes?.includes(tx.nuvama_code)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let payment: any = null
    let attempts = 0
    try { const o: any = await fetchRazorpayOrder(orderId); attempts = Number(o?.attempts || 0) } catch {}
    if (paymentId && signature) {
      if (!verifyPaymentSignature(orderId, paymentId, signature)) {
        return NextResponse.json({ error: 'Payment signature mismatch', code: 'BAD_SIGNATURE' }, { status: 400 })
      }
      payment = await fetchRazorpayPayment(paymentId)
    } else {
      const list: any = await fetchRazorpayOrderPayments(orderId)
      const items: any[] = list?.items || []
      payment = items.find((p) => p.status === 'captured') || items.find((p) => p.status === 'authorized') || items[items.length - 1] || null
    }

    const status: string = payment?.status || 'created'   // created | authorized | captured | refunded | failed
    const isSuccess = status === 'captured' || status === 'authorized'
    const isFailed = status === 'failed'
    const investmentStatus = isSuccess ? 'PAYMENT_SUCCESS' : isFailed ? 'PAYMENT_FAILED' : 'PENDING_PAYMENT'

    const { rows: upd } = await pool.query(
      `UPDATE payment_transactions t
       SET payment_status = $1,
           investment_status = CASE
             WHEN t.investment_status IN ('DEPLOYED','SETTLED','CANCELLED','EXPIRED') THEN t.investment_status
             WHEN t.investment_status = 'PAYMENT_SUCCESS' AND $2 <> 'PAYMENT_FAILED' THEN t.investment_status
             ELSE $2 END,
           razorpay_payment_id = COALESCE($3, t.razorpay_payment_id),
           razorpay_signature  = COALESCE($4, t.razorpay_signature),
           payment_time   = COALESCE(to_timestamp($5::double precision), t.payment_time),
           payment_method = COALESCE($6::jsonb, t.payment_method),
           bank_reference = COALESCE($7, t.bank_reference),
           payment_message = COALESCE($8, t.payment_message),
           updated_at = NOW()
       FROM (SELECT id, investment_status AS prev_status FROM payment_transactions WHERE razorpay_order_id = $9 FOR UPDATE) old
       WHERE t.id = old.id
       RETURNING t.client_id, t.investment_status, old.prev_status`,
      [
        status.toUpperCase(), investmentStatus,
        payment?.id || null, signature || null,
        payment?.created_at ? Number(payment.created_at) : null,
        payment ? JSON.stringify(paymentMethodJson(payment)) : null,
        payment?.acquirer_data?.rrn || payment?.acquirer_data?.bank_transaction_id || null,
        payment?.error_description || (isSuccess ? 'Payment captured' : null),
        orderId,
      ]
    )

    // "Payment Completed" to Investor Relations, once, when this call is what confirmed it (web parity).
    if (upd[0] && upd[0].prev_status === 'PENDING_PAYMENT' && upd[0].investment_status === 'PAYMENT_SUCCESS') {
      notifyIrPayment({ kind: 'one_time', accountId: tx.nuvama_code, clientId: upd[0].client_id, userEmail: user!.email, amount: Number(tx.amount), reference: orderId, method: payment?.method || null })
    }

    return NextResponse.json({
      orderId, paymentStatus: status.toUpperCase(), investmentStatus,
      isSuccess, isFailed, attempts,   // attempts = 0 → the user never got as far as paying
      amount: Number(tx.amount),
      payment: payment ? { id: payment.id, method: payment.method, vpa: payment.vpa || null, bank: payment.bank || null, time: payment.created_at, reference: payment.acquirer_data?.rrn || null, message: payment.error_description || null } : null,
    })
  } catch (err: any) {
    console.error('[mobile/payments/razorpay/verify]', err)
    return NextResponse.json({ error: err?.message || 'Could not verify the payment' }, { status: 502 })
  }
}
