// POST /api/razorpay/subscriptions/manage — pause, resume, or cancel a SIP.
//
// Every action is authorised against the session's own account list first: the
// subscription id alone must never be sufficient to modify someone's mandate.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import pool from '@/lib/db'
import { getRazorpayClient, normaliseRazorpayError, RazorpayError } from '@/lib/razorpay'
import { notifyClientById } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

type Action = 'pause' | 'resume' | 'cancel'

interface ManageBody {
  subscription_id: string
  action: Action
  /** cancel only: cancel at the end of the current cycle instead of immediately. */
  cancel_at_cycle_end?: boolean
}

interface SessionClient { clientid: string; clientcode: string }

async function getSessionClients(): Promise<SessionClient[] | null> {
  const cookieStore = await cookies()
  if (cookieStore.get('qode-auth')?.value !== '1') return null
  const raw = cookieStore.get('qode-clients')?.value
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionClients = await getSessionClients()
    if (sessionClients === null) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated', error_code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    let body: ManageBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', error_code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const { subscription_id, action, cancel_at_cycle_end = false } = body

    if (!subscription_id || !['pause', 'resume', 'cancel'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'subscription_id and a valid action are required', error_code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    // ── Authorise: the session must own the account this SIP belongs to ──────
    const { rows } = await pool.query(
      `SELECT order_id, client_id, nuvama_code, amount, frequency, investment_status
         FROM payment_transactions
        WHERE razorpay_subscription_id = $1 AND gateway = 'razorpay'
        LIMIT 1`,
      [subscription_id],
    )

    if (!rows.length) {
      return NextResponse.json(
        { success: false, error: 'SIP not found', error_code: 'SUBSCRIPTION_NOT_FOUND' },
        { status: 404 },
      )
    }

    const tx = rows[0]
    const owns = sessionClients.some(
      (c) => c.clientcode === tx.nuvama_code || c.clientid === String(tx.client_id),
    )
    if (!owns) {
      console.warn(
        `[razorpay/subscriptions/manage] ownership check failed for subscription=${subscription_id}`,
      )
      return NextResponse.json(
        { success: false, error: 'This SIP is not linked to your login.', error_code: 'NOT_OWNED' },
        { status: 403 },
      )
    }

    // Guard against acting on an already-terminal SIP.
    if (['SIP_CANCELLED', 'SIP_COMPLETED', 'EXPIRED'].includes(tx.investment_status)) {
      return NextResponse.json(
        {
          success: false,
          error: `This SIP is already ${tx.investment_status === 'SIP_CANCELLED' ? 'cancelled' : 'closed'}.`,
          error_code: 'SUBSCRIPTION_TERMINAL',
        },
        { status: 409 },
      )
    }

    const razorpay = getRazorpayClient()
    let updated: any

    try {
      if (action === 'pause') {
        updated = await (razorpay.subscriptions as any).pause(subscription_id, { pause_at: 'now' })
      } else if (action === 'resume') {
        updated = await (razorpay.subscriptions as any).resume(subscription_id, { resume_at: 'now' })
      } else {
        // cancel_at_cycle_end=true lets an already-paid current cycle run out.
        updated = await razorpay.subscriptions.cancel(subscription_id, cancel_at_cycle_end as any)
      }
    } catch (err) {
      throw normaliseRazorpayError(err)
    }

    // Mirror the gateway state locally. The webhook will also fire and is
    // idempotent, so a double-apply here is harmless.
    const localStatus =
      action === 'pause'  ? 'SIP_PAUSED'
    : action === 'resume' ? 'SIP_ACTIVE'
    :                       'SIP_CANCELLED'

    await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = $1,
         investment_status = $2,
         canceled_at       = CASE WHEN $3::boolean THEN COALESCE(canceled_at, NOW()) ELSE canceled_at END,
         updated_at        = NOW()
       WHERE razorpay_subscription_id = $4`,
      [updated?.status ?? action, localStatus, action === 'cancel', subscription_id],
    )

    if (action === 'cancel') {
      notifyClientById(tx.client_id, 'SIP_CANCELLED', {
        amount:         parseFloat(tx.amount),
        subscriptionId: subscription_id,
        frequency:      tx.frequency ?? undefined,
      }).catch(() => {})
    }

    console.log(`[razorpay/subscriptions/manage] ${action} subscription=${subscription_id} → ${updated?.status}`)

    return NextResponse.json({
      success: true,
      action,
      subscription_id,
      subscription_status: updated?.status ?? null,
      investment_status:   localStatus,
      message:
        action === 'pause'  ? 'Your SIP has been paused.'
      : action === 'resume' ? 'Your SIP has been resumed.'
      : cancel_at_cycle_end ? 'Your SIP will stop at the end of the current cycle.'
      :                       'Your SIP has been cancelled.',
    })
  } catch (error: any) {
    if (error instanceof RazorpayError) {
      console.error(`[razorpay/subscriptions/manage] ${error.code}: ${error.message}`)
      return NextResponse.json(
        { success: false, error: error.message, error_code: error.code },
        { status: error.statusCode },
      )
    }
    console.error('[razorpay/subscriptions/manage] unhandled:', error)
    return NextResponse.json(
      { success: false, error: 'Could not update the SIP. Please try again.', error_code: 'SUBSCRIPTION_MANAGE_FAILED' },
      { status: 500 },
    )
  }
}
