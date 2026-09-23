// POST /api/mobile/payments/razorpay/webhook
// Razorpay → server. Configure in the Razorpay dashboard with RAZORPAY_WEBHOOK_SECRET and the events
// payment.captured, payment.failed, order.paid. Verifies X-Razorpay-Signature over the raw body.
// Updates payment_transactions only; it does NOT email or push the client. If client notifications are
// wanted in production, set RAZORPAY_NOTIFY_CLIENT=true (uses lib/notifications like the Cashfree webhook).
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyWebhookSignature, paymentMethodJson } from '@/lib/razorpay'

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const sig = request.headers.get('x-razorpay-signature') || ''
  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let evt: any
  try { evt = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const event: string = evt?.event || ''
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

    if (rows.length && process.env.RAZORPAY_NOTIFY_CLIENT === 'true') {
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
