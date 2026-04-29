// POST /api/mobile/services/pause-resume-sip
// Pause or resume an active SIP. Verifies ownership via JWT.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

// Uses Cashfree API v3 (same version as setup-sip and cancel-sip)
const makeCashfreeRequest = async (endpoint: string, method: string, body?: any) => {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const baseUrl =
    process.env.CASHFREE_ENVIRONMENT === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-version': '2025-01-01',
      'x-client-id': clientId!,
      'x-client-secret': clientSecret!,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    // Prefer structured error code over message string for robustness
    throw Object.assign(
      new Error(err.message || `Cashfree error: ${response.status}`),
      { cfCode: err.code, httpStatus: response.status }
    )
  }
  return response.json()
}

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const body = await request.json()
    const { subscription_id, accountId, action } = body

    if (!subscription_id || !accountId || !action) {
      return NextResponse.json(
        { error: 'Fields required: subscription_id, accountId, action ("pause" | "resume")' },
        { status: 400 }
      )
    }

    if (!['pause', 'resume'].includes(action)) {
      return NextResponse.json({ error: 'action must be "pause" or "resume"' }, { status: 400 })
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { rows } = await pool.query(
      `SELECT id, order_id, payment_status, cf_subscription_id, amount, frequency, next_charge_date
       FROM payment_transactions
       WHERE order_id = $1 AND nuvama_code = $2 AND payment_type = 'SIP'`,
      [subscription_id, accountId]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'SIP not found' }, { status: 404 })
    }

    const sip = rows[0]

    if (!sip.cf_subscription_id) {
      return NextResponse.json({ error: 'SIP not properly linked, contact support' }, { status: 400 })
    }

    const status = sip.payment_status?.toUpperCase()
    if (action === 'pause' && status !== 'ACTIVE') {
      return NextResponse.json({ error: `SIP cannot be paused in '${sip.payment_status}' status` }, { status: 400 })
    }
    if (action === 'resume' && !['PAUSED', 'CUSTOMER_PAUSED'].includes(status)) {
      return NextResponse.json({ error: `SIP cannot be resumed in '${sip.payment_status}' status` }, { status: 400 })
    }

    let newStatus: string
    try {
      if (action === 'pause') {
        // v3 API: PATCH /subscriptions/{id} with status=PAUSED
        await makeCashfreeRequest(
          `/subscriptions/${sip.cf_subscription_id}`,
          'PATCH',
          { status: 'PAUSED' },
        )
        newStatus = 'PAUSED'
      } else {
        // v3 API: PATCH /subscriptions/{id} with status=ACTIVE
        await makeCashfreeRequest(
          `/subscriptions/${sip.cf_subscription_id}`,
          'PATCH',
          { status: 'ACTIVE' },
        )
        newStatus = 'ACTIVE'
      }
    } catch (cfErr: any) {
      // Accept idempotent "already in target state" errors (HTTP 400 with code 409/already_*)
      const isIdempotent =
        cfErr.httpStatus === 400 &&
        (cfErr.cfCode === 'already_paused' ||
          cfErr.cfCode === 'already_active' ||
          cfErr.message?.includes('already'))
      if (isIdempotent) {
        newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE'
      } else {
        throw cfErr
      }
    }

    const investStatus = newStatus === 'PAUSED' ? 'SIP_PAUSED' : 'SIP_ACTIVE'
    await pool.query(
      `UPDATE payment_transactions
       SET payment_status    = $1,
           investment_status = $2,
           updated_at        = NOW()
       WHERE order_id = $3 AND nuvama_code = $4`,
      [newStatus, investStatus, subscription_id, accountId]
    )

    return NextResponse.json({
      success: true,
      message: `SIP ${action}d successfully`,
      data: {
        subscription_id,
        previous_status: sip.payment_status,
        new_status: newStatus,
        action,
        amount: sip.amount,
        frequency: sip.frequency,
        next_charge_date: sip.next_charge_date,
      },
    })
  } catch (err) {
    console.error('[mobile/services/pause-resume-sip]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
