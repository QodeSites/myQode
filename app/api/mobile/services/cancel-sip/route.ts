// POST /api/mobile/services/cancel-sip
// Cancel an active SIP subscription. Verifies ownership via JWT.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

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
    const { subscription_id, accountId } = body

    if (!subscription_id || !accountId) {
      return NextResponse.json(
        { error: 'Fields required: subscription_id, accountId' },
        { status: 400 }
      )
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { rows } = await pool.query(
      `SELECT id, order_id, payment_status, cf_subscription_id, amount, frequency
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

    const cancellable = ['ACTIVE', 'BANK_APPROVAL_PENDING', 'PENDING', 'PAUSED', 'ON_HOLD', 'CUSTOMER_PAUSED']
    if (!cancellable.includes(sip.payment_status?.toUpperCase())) {
      return NextResponse.json(
        { error: `SIP cannot be cancelled in '${sip.payment_status}' status` },
        { status: 400 }
      )
    }

    try {
      await makeCashfreeRequest(`/subscriptions/${sip.cf_subscription_id}/cancel`, 'POST')
    } catch (cfErr: any) {
      // Accept 404 (already deleted) and 409-style "already cancelled" by http status code
      const isAlreadyCancelled =
        cfErr.httpStatus === 404 ||
        cfErr.httpStatus === 409 ||
        cfErr.cfCode === 'already_cancelled'
      if (!isAlreadyCancelled) throw cfErr
    }

    const { rows: updated } = await pool.query(
      `UPDATE payment_transactions
       SET payment_status    = 'CANCELLED',
           investment_status = 'SIP_CANCELLED',
           canceled_at       = NOW(),
           updated_at        = NOW()
       WHERE order_id = $1 AND nuvama_code = $2
       RETURNING canceled_at`,
      [subscription_id, accountId]
    )

    return NextResponse.json({
      success: true,
      message: 'SIP cancelled successfully',
      data: {
        subscription_id,
        previous_status: sip.payment_status,
        new_status: 'CANCELLED',
        cancelled_at: updated[0]?.canceled_at,
        amount: sip.amount,
        frequency: sip.frequency,
      },
    })
  } catch (err) {
    console.error('[mobile/services/cancel-sip]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
