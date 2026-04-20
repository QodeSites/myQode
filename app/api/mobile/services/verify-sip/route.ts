// GET /api/mobile/services/verify-sip?subscriptionId=qode_xxx
// Called by the mobile app immediately after the Cashfree SDK mandate flow
// completes (success or failure). Syncs the live subscription status from
// Cashfree into payment_transactions so the user sees the correct state
// without waiting for a webhook.
//
// This is the SIP equivalent of /api/mobile/payments/verify for one-time orders.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

async function makeCashfreeGet(endpoint: string) {
  const clientId     = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const baseUrl =
    process.env.CASHFREE_ENVIRONMENT === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'

  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials not configured')
  }

  const resp = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers: {
      accept:            'application/json',
      'x-api-version':   '2025-01-01',
      'x-client-id':     clientId,
      'x-client-secret': clientSecret,
    },
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    const err: any = new Error(body.message || `Cashfree error ${resp.status}`)
    err.httpStatus = resp.status
    err.cfCode     = body.code
    throw err
  }
  return resp.json()
}

// Map Cashfree subscription_status → Qode investment_status
function mapSubscriptionStatus(cfStatus: string): string {
  const s = (cfStatus ?? '').toUpperCase()
  switch (s) {
    case 'ACTIVE':               return 'SIP_ACTIVE'
    case 'INITIALIZED':
    case 'BANK_APPROVAL_PENDING': return 'PENDING_PAYMENT'
    case 'ON_HOLD':              return 'PENDING_PAYMENT'
    case 'PAUSED':
    case 'CUSTOMER_PAUSED':      return 'SIP_PAUSED'
    case 'CANCELLED':
    case 'CUSTOMER_CANCELLED':   return 'SIP_CANCELLED'
    case 'COMPLETED':            return 'SIP_COMPLETED'
    case 'EXPIRED':
    case 'LINK_EXPIRED':         return 'SIP_MANDATE_FAILED'
    case 'FAILED':               return 'SIP_MANDATE_FAILED'
    default:                     return 'PENDING_PAYMENT'
  }
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const subscriptionId = searchParams.get('subscriptionId')

  if (!subscriptionId) {
    return NextResponse.json(
      { error: 'subscriptionId is required' },
      { status: 400 }
    )
  }

  try {
    // ── Verify ownership ─────────────────────────────────────────────────────
    const txRes = await pool.query(
      `SELECT order_id, nuvama_code, client_id, amount, payment_type,
              payment_status, investment_status, frequency, cf_subscription_id
       FROM payment_transactions
       WHERE order_id = $1 LIMIT 1`,
      [subscriptionId]
    )
    if (!txRes.rows.length) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }
    const tx = txRes.rows[0]

    if (!user!.accountCodes?.includes(tx.nuvama_code)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (tx.payment_type !== 'SIP') {
      return NextResponse.json(
        { error: 'This endpoint is for SIP subscriptions only' },
        { status: 400 }
      )
    }

    // ── Fetch live status from Cashfree ──────────────────────────────────────
    const cfSub = await makeCashfreeGet(`/subscriptions/${subscriptionId}`)
    const cfStatus     = cfSub.subscription_status ?? 'UNKNOWN'
    const investStatus = mapSubscriptionStatus(cfStatus)

    // Map Cashfree status to our payment_status column value
    const paymentStatus = cfStatus.toUpperCase()

    const nextChargeDate = cfSub.next_charge_time
      ? new Date(cfSub.next_charge_time).toISOString().split('T')[0]
      : null

    // ── Sync to DB if changed ────────────────────────────────────────────────
    const statusChanged =
      tx.payment_status     !== paymentStatus  ||
      tx.investment_status  !== investStatus

    if (statusChanged) {
      await pool.query(
        `UPDATE payment_transactions SET
           payment_status    = $1,
           investment_status = CASE
             -- Never downgrade a terminal status
             WHEN investment_status IN ('SIP_CANCELLED','SIP_COMPLETED','SIP_MANDATE_FAILED','EXPIRED')
               THEN investment_status
             ELSE $2
           END,
           next_charge_date  = COALESCE($3::date, next_charge_date),
           updated_at        = NOW()
         WHERE order_id = $4`,
        [paymentStatus, investStatus, nextChargeDate, subscriptionId]
      )
    }

    return NextResponse.json({
      subscriptionId,
      cfSubscriptionStatus: cfStatus,
      investmentStatus:     statusChanged ? investStatus : tx.investment_status,
      isActive:             investStatus === 'SIP_ACTIVE',
      isMandatePending:     investStatus === 'PENDING_PAYMENT',
      isFailed:             investStatus === 'SIP_MANDATE_FAILED',
      amount:               parseFloat(tx.amount),
      frequency:            tx.frequency,
      nextChargeDate:       nextChargeDate ?? null,
      authorizationDetails: {
        authorizationStatus:
          cfSub.authorisation_details?.authorization_status ?? null,
        authorizationTime:
          cfSub.authorisation_details?.authorization_time ?? null,
      },
    })
  } catch (err: any) {
    console.error('[mobile/services/verify-sip]', err)

    // If Cashfree returns 404, the subscription doesn't exist on their end
    if (err.httpStatus === 404) {
      return NextResponse.json(
        { error: 'Subscription not found on Cashfree' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to verify SIP status', code: err.cfCode ?? 'VERIFY_FAILED' },
      { status: 500 }
    )
  }
}
