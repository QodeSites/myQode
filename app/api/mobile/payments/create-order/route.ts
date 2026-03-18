// POST /api/mobile/payments/create-order
// Creates a Cashfree order and returns payment_session_id for the React Native SDK.
// Uses the same cashfree-pg SDK and env vars as the web version.
import { NextRequest, NextResponse } from 'next/server'
import { Cashfree, CFEnvironment } from 'cashfree-pg'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

function generateOrderId(): string {
  const ts = Date.now().toString()
  const rnd = Math.random().toString(36).substring(2, 8)
  return `qode_${ts}_${rnd}`
}

function initCashfree() {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const environment =
    process.env.CASHFREE_ENVIRONMENT === 'production'
      ? CFEnvironment.PRODUCTION
      : CFEnvironment.SANDBOX

  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials not configured')
  }
  return new Cashfree(environment, clientId, clientSecret)
}

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    amount,
    accountId,
    orderType = 'ONE_TIME',   // ONE_TIME | NEW_STRATEGY
    strategyType,
  }: {
    amount: number
    accountId: string
    orderType?: string
    strategyType?: string
  } = body

  // Validate
  if (!amount || !accountId) {
    return NextResponse.json(
      { error: 'amount and accountId are required' },
      { status: 400 }
    )
  }
  if (amount < 100) {
    return NextResponse.json({ error: 'Minimum amount is ₹100' }, { status: 400 })
  }
  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Fetch customer details from DB
    const clientRes = await pool.query(
      `SELECT clientid, clientcode, email, mobile,
              salutation, firstname, middlename, lastname
       FROM pms_clients_master
       WHERE clientcode = $1 LIMIT 1`,
      [accountId]
    )
    if (clientRes.rows.length === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const client = clientRes.rows[0]
    const customerName = [client.salutation, client.firstname, client.middlename, client.lastname]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    const cleanPhone = (client.mobile || '').replace(/\D/g, '').slice(-10)

    if (cleanPhone.length !== 10) {
      return NextResponse.json(
        { error: 'Invalid phone number on file. Please contact support.' },
        { status: 422 }
      )
    }

    const orderId = generateOrderId()
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://myqode.qodeinvest.com'

    const orderData: any = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: client.clientid,
        customer_name: customerName,
        customer_email: client.email,
        customer_phone: cleanPhone,
      },
      order_meta: {
        // Mobile app handles the return flow itself; notify_url hits the existing webhook
        return_url: `${baseUrl}/payment/success?order_id=${orderId}&source=mobile`,
        notify_url: `${baseUrl}/api/cashfree/webhook`,
      },
      order_note: `Investment – Account: ${accountId}, Client: ${customerName}, Amount: ₹${amount.toFixed(2)}`,
      order_tags: {
        nuvama_code: accountId,
        client_id: client.clientid,
        order_type: orderType.toLowerCase(),
        source: 'qode_mobile_app',
        is_new_strategy: orderType === 'NEW_STRATEGY' ? 'true' : 'false',
        ...(strategyType ? { strategy_type: strategyType } : {}),
      },
    }

    const cashfree = initCashfree()
    const resp = await cashfree.PGCreateOrder(orderData, undefined, undefined, {
      headers: { 'x-api-version': '2023-08-01' },
    })
    const cfOrder: any = resp.data

    // Persist to payment_transactions (same table as web)
    await pool.query(
      `INSERT INTO payment_transactions (
         order_id, client_id, nuvama_code, client_name, amount, currency,
         payment_type, payment_status, payment_session_id, cf_order_id,
         created_at, is_new_strategy, strategy_type
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        cfOrder.order_id,
        client.clientid,
        accountId,
        customerName,
        amount,
        'INR',
        orderType,
        cfOrder.order_status || 'CREATED',
        cfOrder.payment_session_id,
        cfOrder.cf_order_id || cfOrder.order_id,
        new Date(),
        orderType === 'NEW_STRATEGY',
        strategyType || null,
      ]
    )

    return NextResponse.json({
      orderId: cfOrder.order_id,
      paymentSessionId: cfOrder.payment_session_id,   // pass this to Cashfree React Native SDK
      orderAmount: cfOrder.order_amount,
      orderCurrency: cfOrder.order_currency,
      orderStatus: cfOrder.order_status,
      orderExpiryTime: cfOrder.order_expiry_time,
      environment: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    })
  } catch (err: any) {
    console.error('[mobile/payments/create-order]', err)
    const details = err.response?.data ?? err.message ?? String(err)
    return NextResponse.json(
      { error: 'Order creation failed', details },
      { status: 500 }
    )
  }
}
