// POST /api/mobile/services/pause-resume-sip
// Pause or resume a SIP. Verifies ownership via JWT.
//
// Razorpay rules (verified live): only an `active` subscription — one whose first instalment has been
// charged — can be paused; a subscription that is only `authenticated` (mandate registered, first charge
// still ahead) cannot, and sending it a pause would CANCEL it. Resume needs `paused`. So the live Razorpay
// status is checked before anything is sent, and the client gets a plain-English reason instead of 500.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { fetchRazorpaySubscription, pauseRazorpaySubscription, resumeRazorpaySubscription, razorpayConfig } from '@/lib/razorpay'

// RAZORPAY_SIP_SIMULATE=1 + TEST keys only: pause/resume flip our own record without touching Razorpay,
// so the app's Pause → Paused → Resume → Active flow can be exercised on a mandate that has not charged
// yet (Razorpay itself only pauses after the first instalment). Never active with live keys.
const simulate = () => process.env.RAZORPAY_SIP_SIMULATE === '1' && razorpayConfig().isTest

const istDate = (unix: number | null) => (unix ? new Date(unix * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null)

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { subscription_id, accountId, action } = body
  if (!subscription_id || !accountId || !action) {
    return NextResponse.json({ error: 'Fields required: subscription_id, accountId, action ("pause" | "resume")' }, { status: 400 })
  }
  if (!['pause', 'resume'].includes(action)) return NextResponse.json({ error: 'action must be "pause" or "resume"' }, { status: 400 })
  if (!user!.accountCodes?.includes(accountId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { rows } = await pool.query(
      `SELECT id, order_id, payment_status, investment_status, razorpay_subscription_id, amount, frequency, next_charge_date
       FROM payment_transactions
       WHERE order_id = $1 AND nuvama_code = $2 AND payment_type = 'SIP'`,
      [subscription_id, accountId]
    )
    if (!rows.length) return NextResponse.json({ error: 'SIP not found' }, { status: 404 })
    const sip = rows[0]
    if (!sip.razorpay_subscription_id) return NextResponse.json({ error: 'SIP not properly linked, contact support' }, { status: 400 })

    if (simulate()) {
      const cur = sip.investment_status
      if (action === 'pause' && cur !== 'SIP_ACTIVE') return NextResponse.json({ error: `SIP cannot be paused in '${cur}' status (simulation).` }, { status: 400 })
      if (action === 'resume' && cur !== 'SIP_PAUSED') return NextResponse.json({ error: `SIP cannot be resumed in '${cur}' status (simulation).` }, { status: 400 })
      const newInvest = action === 'pause' ? 'SIP_PAUSED' : 'SIP_ACTIVE'
      await pool.query(`UPDATE payment_transactions SET investment_status = $1, updated_at = NOW() WHERE order_id = $2 AND nuvama_code = $3`, [newInvest, subscription_id, accountId])
      return NextResponse.json({ success: true, simulated: true, message: action === 'pause' ? 'SIP paused (simulated — Razorpay not called).' : 'SIP resumed (simulated — Razorpay not called).', data: { subscription_id, previous_status: cur, new_status: newInvest, action, amount: sip.amount, frequency: sip.frequency, next_charge_date: sip.next_charge_date } })
    }

    // The truth is on Razorpay's side — our row can lag the first charge.
    const live: any = await fetchRazorpaySubscription(sip.razorpay_subscription_id)
    const rz = String(live.status || '').toLowerCase()
    const firstCharge = istDate(live.charge_at)

    if (action === 'pause') {
      if (rz === 'authenticated' || rz === 'created') {
        return NextResponse.json({
          error: `Pause becomes available after the first instalment is charged${firstCharge ? ` (${firstCharge})` : ''}. Until then you can cancel the SIP instead.`,
          code: 'NOT_YET_ACTIVE',
        }, { status: 400 })
      }
      if (rz === 'paused') return NextResponse.json({ error: 'This SIP is already paused.', code: 'ALREADY' }, { status: 400 })
      if (rz !== 'active' && rz !== 'pending') return NextResponse.json({ error: `SIP cannot be paused in '${rz}' status.` }, { status: 400 })
    } else {
      if (rz === 'active') return NextResponse.json({ error: 'This SIP is already running.', code: 'ALREADY' }, { status: 400 })
      if (rz !== 'paused') return NextResponse.json({ error: `SIP cannot be resumed in '${rz}' status.` }, { status: 400 })
    }

    let after: any
    try {
      after = action === 'pause' ? await pauseRazorpaySubscription(sip.razorpay_subscription_id) : await resumeRazorpaySubscription(sip.razorpay_subscription_id)
    } catch (rzErr: any) {
      return NextResponse.json({ error: rzErr?.message || `Could not ${action} the SIP` }, { status: 400 })
    }
    const newRz = String(after?.status || (action === 'pause' ? 'paused' : 'active')).toLowerCase()
    const newInvest = newRz === 'paused' ? 'SIP_PAUSED' : newRz === 'cancelled' ? 'SIP_CANCELLED' : 'SIP_ACTIVE'
    const nextChargeDate = after?.charge_at ? new Date(after.charge_at * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null

    await pool.query(
      `UPDATE payment_transactions
       SET payment_status = $1, investment_status = $2, next_charge_date = COALESCE($3::date, next_charge_date), updated_at = NOW()
       WHERE order_id = $4 AND nuvama_code = $5`,
      [newRz, newInvest, nextChargeDate, subscription_id, accountId]
    )

    return NextResponse.json({
      success: true,
      message: action === 'pause' ? 'SIP paused — no charges until you resume it.' : `SIP resumed${nextChargeDate ? ` — next charge on ${istDate(after.charge_at)}` : ''}.`,
      data: { subscription_id, previous_status: sip.investment_status, new_status: newInvest, razorpay_status: newRz, action, amount: sip.amount, frequency: sip.frequency, next_charge_date: nextChargeDate },
    })
  } catch (err: any) {
    console.error('[mobile/services/pause-resume-sip]', err)
    return NextResponse.json({ error: err?.message || 'SIP operation failed' }, { status: 502 })
  }
}
