// POST /api/mobile/services/cancel-sip
// Cancel an active SIP subscription. Verifies ownership via JWT.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { cancelRazorpaySubscription } from '@/lib/razorpay'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const body = await request.json()
    const { subscription_id, accountId } = body

    if (!subscription_id || !accountId) {
      return NextResponse.json({ error: 'Fields required: subscription_id, accountId' }, { status: 400 })
    }
    if (!user!.accountCodes?.includes(accountId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { rows } = await pool.query(
      `SELECT id, order_id, payment_status, investment_status, razorpay_subscription_id, amount, frequency
       FROM payment_transactions
       WHERE order_id = $1 AND nuvama_code = $2 AND payment_type = 'SIP'`,
      [subscription_id, accountId]
    )
    if (!rows.length) return NextResponse.json({ error: 'SIP not found' }, { status: 404 })
    const sip = rows[0]
    if (!sip.razorpay_subscription_id) return NextResponse.json({ error: 'SIP not properly linked, contact support' }, { status: 400 })

    const cancellable = ['PENDING_PAYMENT', 'SIP_AUTHORISED', 'SIP_ACTIVE', 'SIP_PAUSED']
    if (!cancellable.includes(sip.investment_status)) {
      return NextResponse.json({ error: `SIP cannot be cancelled in '${sip.investment_status}' status` }, { status: 400 })
    }

    try {
      await cancelRazorpaySubscription(sip.razorpay_subscription_id)
    } catch (rzErr: any) {
      // Razorpay already has it cancelled/completed/expired → just bring our row in line (idempotent)
      const already = /already cancelled|no longer active|not cancellable in (cancelled|completed|expired) status/i.test(rzErr?.message || '')
      if (!already) throw rzErr
    }

    const { rows: updated } = await pool.query(
      `UPDATE payment_transactions
       SET investment_status = 'SIP_CANCELLED', canceled_at = NOW(), updated_at = NOW()
       WHERE order_id = $1 AND nuvama_code = $2
       RETURNING canceled_at`,
      [subscription_id, accountId]
    )

    return NextResponse.json({
      success: true,
      message: 'SIP cancelled successfully',
      data: {
        subscription_id, previous_status: sip.investment_status, new_status: 'SIP_CANCELLED',
        cancelled_at: updated[0]?.canceled_at, amount: sip.amount, frequency: sip.frequency,
      },
    })
  } catch (err: any) {
    console.error('[mobile/services/cancel-sip]', err)
    return NextResponse.json({ error: err?.message || 'SIP cancellation failed' }, { status: 502 })
  }
}
