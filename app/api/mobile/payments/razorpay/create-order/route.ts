// POST /api/mobile/payments/razorpay/create-order
// Body: { accountId, amount }   (one-time top-up; amount in rupees, ₹100 – ₹5,00,000)
// Creates a Razorpay order, records it in payment_transactions (gateway = 'razorpay') and returns what the
// app needs to open Razorpay Checkout: a hosted checkout URL (for a WebView) plus the raw order details.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { razorpayConfig, createRazorpayOrder, checkoutToken } from '@/lib/razorpay'

const MIN_AMOUNT = 100
const MAX_AMOUNT = 500000 // per-transaction ceiling verified on the Razorpay account (see app/demo)

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ error: 'Not available for the reviewer account' }, { status: 403 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const accountId = String(body?.accountId || '').trim()
  const amount = Number(body?.amount)
  if (!accountId || !amount) return NextResponse.json({ error: 'amount and accountId are required' }, { status: 400 })
  if (amount < MIN_AMOUNT) return NextResponse.json({ error: `Minimum amount is ₹${MIN_AMOUNT}` }, { status: 400 })
  if (amount > MAX_AMOUNT) return NextResponse.json({ error: `Maximum online amount is ₹${MAX_AMOUNT.toLocaleString('en-IN')}. For larger amounts please use a bank transfer.` }, { status: 400 })
  if (!user!.accountCodes?.includes(accountId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const cfg = razorpayConfig()
    const clientRes = await pool.query(
      `SELECT clientid, clientcode, email, mobile, salutation, firstname, middlename, lastname
       FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`,
      [accountId]
    )
    if (clientRes.rows.length === 0) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const client = clientRes.rows[0]
    const customerName = [client.salutation, client.firstname, client.middlename, client.lastname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || accountId
    const phone = String(client.mobile || '').replace(/\D/g, '').slice(-10)

    // TEST keys: never hand the real client's contact details to the gateway (no receipt/SMS can reach them).
    const prefill = cfg.isTest
      ? { name: customerName, email: 'test@razorpay.com', contact: '9999999999' }
      : { name: customerName, email: client.email || '', contact: phone }

    const receipt = `qode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const rzOrder: any = await createRazorpayOrder(amount, receipt, {
      nuvama_code: accountId, client_id: String(client.clientid), order_type: 'one_time', source: 'qode_mobile_app',
    })

    await pool.query(
      `INSERT INTO payment_transactions (
         order_id, client_id, nuvama_code, client_name, amount, currency,
         payment_type, payment_status, investment_status,
         gateway, razorpay_order_id, created_at, updated_at, is_new_strategy
       ) VALUES ($1,$2,$3,$4,$5,'INR','ONE_TIME',$6,'PENDING_PAYMENT','razorpay',$7,NOW(),NOW(),false)`,
      [rzOrder.id, client.clientid, accountId, customerName, amount, rzOrder.status || 'created', rzOrder.id]
    )

    const exp = Date.now() + 30 * 60 * 1000
    const base = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, '') || new URL(request.url).origin
    const q = new URLSearchParams({ orderId: rzOrder.id, exp: String(exp), t: checkoutToken(rzOrder.id, exp) })

    return NextResponse.json({
      orderId: rzOrder.id,
      amount, currency: 'INR',
      keyId: cfg.keyId,
      environment: cfg.isTest ? 'test' : 'live',
      prefill,
      // Hosted checkout page for the app's WebView (same origin as this API; the app swaps in its own base URL).
      checkoutPath: '/api/mobile/payments/razorpay/checkout?' + q.toString(),
      checkoutUrl: base + '/api/mobile/payments/razorpay/checkout?' + q.toString(),
    })
  } catch (err: any) {
    console.error('[mobile/payments/razorpay/create-order]', err)
    return NextResponse.json({ error: err?.message || 'Could not create the payment order' }, { status: 502 })
  }
}
