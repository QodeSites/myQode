// POST /api/mobile/services/setup-sip
// Create a new SIP subscription via Cashfree. Returns subscription_session_id for SDK.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'

function generateOrderId(): string {
  return `qode_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

const makeCashfreeRequest = async (endpoint: string, data: any) => {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const baseUrl =
    process.env.CASHFREE_ENVIRONMENT === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-version': '2025-01-01',
      'x-client-id': clientId!,
      'x-client-secret': clientSecret!,
    },
    body: JSON.stringify(data),
  })

  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.message || `Cashfree error: ${response.status}`)
  }
  return result
}

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const body = await request.json()
    const { accountId, amount, frequency, startDate, endDate, totalInstallments } = body

    if (!accountId || !amount || !frequency || !startDate) {
      return NextResponse.json(
        { error: 'Fields required: accountId, amount, frequency, startDate' },
        { status: 400 }
      )
    }

    const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    if (!validFrequencies.includes(frequency)) {
      return NextResponse.json(
        { error: `frequency must be one of: ${validFrequencies.join(', ')}` },
        { status: 400 }
      )
    }

    if (amount < 100) {
      return NextResponse.json({ error: 'Minimum SIP amount is ₹100' }, { status: 400 })
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch customer details from DB
    const clientRes = await query(
      `SELECT clientid, clientcode, firstname, middlename, lastname, email, mobile
       FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`,
      [accountId]
    )

    if (!clientRes.rows.length) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const client = clientRes.rows[0]
    const customerName = [client.firstname, client.middlename, client.lastname]
      .filter(Boolean).join(' ').trim()

    if (!client.mobile || client.mobile.replace(/\D/g, '').length < 10) {
      return NextResponse.json(
        { error: 'Valid phone number not on file, contact support' },
        { status: 422 }
      )
    }

    const subscriptionId = generateOrderId()
    const phone = client.mobile.replace(/\D/g, '').slice(-10)

    const subscriptionData = {
      subscription_id: subscriptionId,
      subscription_type: 'PERIODIC',
      authorization_details: {
        authorization_amount: amount,
        authorization_currency: 'INR',
      },
      plan_details: {
        plan_name: `SIP_${accountId}_${Date.now()}`,
        plan_type: 'ON_DEMAND',
        plan_max_cycles: totalInstallments || 120,
        plan_max_amount: amount,
        plan_intervals: 1,
        plan_interval_type: frequency.toUpperCase(),
        plan_currency: 'INR',
      },
      customer_details: {
        customer_id: client.clientid,
        customer_name: customerName,
        customer_email: client.email,
        customer_phone: phone,
      },
      subscription_first_charge_time: `${startDate}T00:00:00+05:30`,
      ...(endDate ? { subscription_expiry_time: `${endDate}T23:59:59+05:30` } : {}),
      subscription_meta: {
        return_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/payment/sip-success?subscription_id={subscription_id}`,
        notify_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/cashfree/webhook`,
        payment_methods: 'upi,card,netbanking',
      },
    }

    const cfResponse = await makeCashfreeRequest('/subscriptions', subscriptionData)

    // Store in DB — include start_date and next_charge_date so the mobile
    // SIP management screen can display them without extra API calls.
    const firstChargeIso = cfResponse.subscription_first_charge_time
      ? new Date(cfResponse.subscription_first_charge_time).toISOString()
      : new Date(`${startDate}T00:00:00+05:30`).toISOString()

    await query(
      `INSERT INTO payment_transactions
       (order_id, nuvama_code, amount, payment_type, payment_status, frequency,
        cf_subscription_id, start_date, next_charge_date, created_at, updated_at)
       VALUES ($1,$2,$3,'SIP','PENDING',$4,$5,$6,$6,NOW(),NOW())
       ON CONFLICT (order_id) DO NOTHING`,
      [subscriptionId, accountId, amount, frequency, cfResponse.cf_subscription_id || null, firstChargeIso]
    )

    return NextResponse.json({
      subscriptionId,
      subscriptionSessionId: cfResponse.subscription_session_id,
      cfSubscriptionId: cfResponse.cf_subscription_id,
      status: cfResponse.subscription_status,
      amount,
      frequency,
      startDate,
      firstChargeTime: cfResponse.subscription_first_charge_time,
      expiryTime: cfResponse.subscription_expiry_time,
      environment: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    })
  } catch (err) {
    console.error('[mobile/services/setup-sip]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
