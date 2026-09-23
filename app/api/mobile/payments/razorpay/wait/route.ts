// GET /api/mobile/payments/razorpay/wait?orderId=order_…   |   ?subId=sub_…
// Long-poll used by the app WHILE Razorpay's browser tab is open: holds the request (≤ 20 s) until the
// return route has recorded the outcome, then answers { status: 'success' | 'failed' | null }.
// Why a long-poll and not timers in the app: with the tab in front the app's activity is paused and React
// Native holds every setTimeout/setInterval — but an in-flight fetch still completes and runs its
// callback. Chaining these requests is therefore the only clock the app has in that state, and it uses it
// to open its own return link the moment the payment/mandate is decided (see autoReturn in pay.js).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

const HOLD_MS = 20000, STEP_MS = 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const q = new URL(request.url).searchParams
  const orderId = q.get('orderId') || '', subId = q.get('subId') || ''
  if (!orderId && !subId) return NextResponse.json({ error: 'orderId or subId is required' }, { status: 400 })

  const sql = subId
    ? `SELECT nuvama_code, investment_status, razorpay_payment_id, payment_message FROM payment_transactions WHERE razorpay_subscription_id = $1 AND gateway = 'razorpay' LIMIT 1`
    : `SELECT nuvama_code, investment_status, razorpay_payment_id, payment_message FROM payment_transactions WHERE razorpay_order_id = $1 AND gateway = 'razorpay' LIMIT 1`
  const id = subId || orderId

  // ?ack=<status>: the app reports that it received a decided answer and opened its own return link — trace only.
  const ack = q.get('ack')
  const trace = async (what: string) => {
    if (process.env.NODE_ENV === 'production') return
    try {
      const { appendFileSync } = await import('fs'); const { tmpdir } = await import('os'); const { join } = await import('path')
      appendFileSync(join(tmpdir(), 'razorpay-return.log'), JSON.stringify({ at: new Date().toISOString(), method: 'WAIT', kind: subId ? 'sip' : 'order', id, ret: null, fields: { what } }) + '\n')
    } catch {}
  }
  if (ack) { await trace('app-openurl:' + ack); return NextResponse.json({ ok: true }) }

  const started = Date.now()
  while (true) {
    const { rows } = await pool.query(sql, [id])
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const tx = rows[0]
    if (!user!.accountCodes?.includes(tx.nuvama_code)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Decided = the return route (or webhook) has written an outcome. Success: a signed payment id is on
    // the row. Failure: Razorpay's error text is on the row while the status is still pending.
    const s = String(tx.investment_status || '')
    const status =
      tx.razorpay_payment_id || ['PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED', 'SIP_AUTHORISED', 'SIP_ACTIVE'].includes(s) ? 'success'
      : ['PAYMENT_FAILED', 'SIP_MANDATE_FAILED', 'EXPIRED', 'CANCELLED', 'SIP_CANCELLED'].includes(s) || (tx.payment_message && s === 'PENDING_PAYMENT') ? 'failed'
      : null
    if (status) await trace('decided:' + status)
    if (status || Date.now() - started > HOLD_MS) return NextResponse.json({ status, investmentStatus: s })
    await sleep(STEP_MS)
  }
}
