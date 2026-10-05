// POST /api/razorpay-demo/verify { orderId, paymentId, signature } → { ok, status, amount }
// Confirms a /pay demonstration payment the way the app's real flow does: checks Razorpay's signature, then asks
// Razorpay for the payment's status. Only orders tagged demo=true are answered; nothing is written.
import { NextRequest, NextResponse } from 'next/server'
import { verifyPaymentSignature, fetchRazorpayOrder, fetchRazorpayOrderPayments } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let b: any = {}
  try { b = await req.json() } catch {}
  const orderId = String(b?.orderId || ''), paymentId = String(b?.paymentId || ''), signature = String(b?.signature || '')
  if (!orderId || !paymentId || !signature) return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
  try {
    const order: any = await fetchRazorpayOrder(orderId, 'demo')
    if (order?.notes?.demo !== 'true') return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!verifyPaymentSignature(orderId, paymentId, signature, 'demo')) return NextResponse.json({ ok: false, error: 'Payment signature mismatch' }, { status: 400 })
    const list: any = await fetchRazorpayOrderPayments(orderId, 'demo').catch(() => null)
    const p = (list?.items || []).find((x: any) => x.id === paymentId) || null
    const status: string = p?.status || 'authorized'
    return NextResponse.json({ ok: status === 'captured' || status === 'authorized', status, amount: (Number(order.amount) || 0) / 100, method: p?.method || null })
  } catch (e) {
    console.error('[razorpay-demo/verify]', (e as Error).message)
    return NextResponse.json({ error: 'Could not confirm the payment' }, { status: 502 })
  }
}
