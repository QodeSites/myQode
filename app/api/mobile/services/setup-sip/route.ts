// POST /api/mobile/services/setup-sip
// Create a new PERIODIC SIP subscription via Cashfree.
// Returns subscription_session_id for the React Native SDK mandate flow.
//
// Flow: User submits form → this API creates subscription → SDK opens mandate UI
//       → user authorizes → INSTRUMENT_ACTIVE webhook fires → SIP goes ACTIVE
//
// IMPORTANT: plan_type must be PERIODIC (not ON_DEMAND).
// ON_DEMAND = you manually trigger each charge. PERIODIC = Cashfree auto-debits on schedule.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

function generateSubscriptionId(): string {
  return `qode_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

// Cashfree interval type mapping
const FREQUENCY_MAP: Record<string, { intervalType: string; intervals: number }> = {
  daily:     { intervalType: 'DAY',   intervals: 1 },
  weekly:    { intervalType: 'WEEK',  intervals: 1 },
  monthly:   { intervalType: 'MONTH', intervals: 1 },
  quarterly: { intervalType: 'MONTH', intervals: 3 },
  yearly:    { intervalType: 'YEAR',  intervals: 1 },
}

async function makeCashfreeRequest(endpoint: string, data: any) {
  const clientId     = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const baseUrl =
    process.env.CASHFREE_ENVIRONMENT === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'

  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials not configured')
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      accept:           'application/json',
      'content-type':   'application/json',
      'x-api-version':  '2025-01-01',
      'x-client-id':    clientId,
      'x-client-secret': clientSecret,
    },
    body: JSON.stringify(data),
  })

  const result = await response.json()
  if (!response.ok) {
    const msg = result.message || result.error || `Cashfree error ${response.status}`
    const err: any = new Error(msg)
    err.cfCode = result.code
    err.httpStatus = response.status
    err.cfDetails  = result
    throw err
  }
  return result
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

  const { accountId, amount, frequency, startDate, endDate, totalInstallments } = body

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!accountId || !amount || !frequency || !startDate) {
    return NextResponse.json(
      { error: 'Fields required: accountId, amount, frequency, startDate' },
      { status: 400 }
    )
  }

  if (!FREQUENCY_MAP[frequency]) {
    return NextResponse.json(
      { error: `frequency must be one of: ${Object.keys(FREQUENCY_MAP).join(', ')}` },
      { status: 400 }
    )
  }

  if (typeof amount !== 'number' || isNaN(amount) || amount < 100) {
    return NextResponse.json({ error: 'Minimum SIP amount is ₹100' }, { status: 400 })
  }

  // Validate startDate is YYYY-MM-DD and is today or in the future
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 400 })
  }

  const startDateObj = new Date(`${startDate}T00:00:00+05:30`)
  if (isNaN(startDateObj.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
  }

  // Minimum start date is tomorrow (Cashfree rejects same-day mandates in most cases)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  if (startDateObj < tomorrow) {
    return NextResponse.json(
      { error: 'startDate must be at least tomorrow or a future date' },
      { status: 400 }
    )
  }

  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 400 })
    }
    const endDateObj = new Date(`${endDate}T23:59:59+05:30`)
    if (isNaN(endDateObj.getTime()) || endDateObj <= startDateObj) {
      return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 })
    }
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // ── Fetch customer from DB ───────────────────────────────────────────────
    const clientRes = await pool.query(
      `SELECT clientid, clientcode, firstname, middlename, lastname, email, mobile
       FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`,
      [accountId]
    )
    if (!clientRes.rows.length) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const client = clientRes.rows[0]

    const customerName = [client.firstname, client.middlename, client.lastname]
      .filter(Boolean).join(' ').trim() || 'Investor'

    const phone = (client.mobile || '').replace(/\D/g, '').slice(-10)
    if (phone.length !== 10) {
      return NextResponse.json(
        { error: 'Valid phone number not on file. Contact support.' },
        { status: 422 }
      )
    }

    // ── Build Cashfree subscription request ──────────────────────────────────
    const subscriptionId = generateSubscriptionId()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://myqode.qodeinvest.com'
    const { intervalType, intervals } = FREQUENCY_MAP[frequency]

    // Authorization amount = the per-cycle SIP amount.
    // Cashfree debits up to this amount per cycle. Do NOT multiply by 100.
    const authAmount = amount

    const subscriptionPayload: any = {
      subscription_id:   subscriptionId,
      subscription_type: 'PERIODIC',          // Cashfree auto-debits on schedule

      authorization_details: {
        authorization_amount:   authAmount,
        authorization_currency: 'INR',
      },

      plan_details: {
        plan_name:          `SIP_${accountId}_${Date.now()}`,
        plan_type:          'PERIODIC',        // PERIODIC = automatic recurring charge
        plan_max_cycles:    totalInstallments  || 120,
        plan_max_amount:    amount,            // max debit per cycle = the SIP amount
        plan_intervals:     intervals,
        plan_interval_type: intervalType,
        plan_currency:      'INR',
      },

      customer_details: {
        customer_id:    client.clientid,
        customer_name:  customerName,
        customer_email: client.email,
        customer_phone: phone,
      },

      // IST-formatted timestamps
      subscription_first_charge_time: `${startDate}T10:00:00+05:30`,
      ...(endDate ? { subscription_expiry_time: `${endDate}T23:59:59+05:30` } : {}),

      subscription_meta: {
        return_url: `${baseUrl}/payment/sip-success?subscription_id={subscription_id}&source=mobile`,
        notify_url: `${baseUrl}/api/cashfree/webhook`,
      },

      subscription_tags: {
        nuvama_code: accountId,
        client_id:   client.clientid,
        source:      'qode_mobile_app',
        frequency,
      },
    }

    // ── Call Cashfree ────────────────────────────────────────────────────────
    const cfResponse = await makeCashfreeRequest('/subscriptions', subscriptionPayload)

    if (!cfResponse.subscription_session_id) {
      console.error('[setup-sip] Missing subscription_session_id:', cfResponse)
      throw new Error('Cashfree did not return a subscription_session_id')
    }

    // ── Persist to DB ────────────────────────────────────────────────────────
    // investment_status is set to PENDING_PAYMENT here.
    // It transitions to SIP_ACTIVE when SUBSCRIPTION_ACTIVE webhook fires.
    // client_id and client_name are required NOT NULL columns — always set them.
    const firstChargeDate = cfResponse.subscription_first_charge_time
      ? new Date(cfResponse.subscription_first_charge_time).toISOString().split('T')[0]
      : startDate

    await pool.query(
      `INSERT INTO payment_transactions (
         order_id, client_id, nuvama_code, client_name, amount, currency,
         payment_type, payment_status, investment_status,
         cf_subscription_id, frequency,
         start_date, end_date, total_installments,
         next_charge_date,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'INR','SIP','PENDING','PENDING_PAYMENT',
                 $6,$7,$8,$9,$10,$8,NOW(),NOW())
       ON CONFLICT (order_id) DO NOTHING`,
      [
        subscriptionId,
        client.clientid,
        accountId,
        customerName,
        amount,
        cfResponse.cf_subscription_id || null,
        frequency,
        firstChargeDate,
        endDate || null,
        totalInstallments || null,
      ]
    )

    return NextResponse.json({
      subscriptionId,
      subscriptionSessionId: cfResponse.subscription_session_id,
      cfSubscriptionId:      cfResponse.cf_subscription_id,
      status:                cfResponse.subscription_status,   // INITIALIZED
      amount,
      frequency,
      startDate,
      firstChargeTime:  cfResponse.subscription_first_charge_time,
      expiryTime:       cfResponse.subscription_expiry_time ?? null,
      environment: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    })
  } catch (err: any) {
    console.error('[mobile/services/setup-sip]', err)
    // Surface Cashfree-specific error messages to the client
    const userMessage = err.cfDetails?.message
      ?? err.message
      ?? 'Failed to set up SIP. Please try again.'
    return NextResponse.json(
      { error: userMessage, code: err.cfCode ?? 'SIP_SETUP_FAILED' },
      { status: err.httpStatus && err.httpStatus < 500 ? 400 : 500 }
    )
  }
}
