// POST /api/mobile/services/setup-sip
// Body: { accountId, amount, frequency, startDate, endDate?, totalInstallments? }
// Creates a Razorpay Plan + Subscription and returns a hosted checkout URL — the app opens it in the
// system browser exactly like the one-time Add Funds flow, the client authorises UPI Autopay / eNACH /
// card, and Razorpay auto-debits on schedule from then on with no further app interaction.
//
// Flow: app submits this form → this route creates the plan+subscription → app opens checkoutPath in the
// system browser → client authorises → browser returns via the same deep link as one-time payments →
// app calls verify-sip to confirm. Recurring charges after that are handled entirely by the webhook.
//
// Replaces the earlier Cashfree-backed version (that flow needed Cashfree's native SDK, which was never
// wired into the app, so no SIP could ever actually be set up from mobile). Same request/response shape.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { createRazorpayPlan, createRazorpaySubscription, checkoutToken } from '@/lib/razorpay'
import { registeredBankFor } from '@/lib/registeredBank'

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
const MIN_AMOUNT = 100
const MAX_AMOUNT = 500000

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ error: 'Not available for the reviewer account' }, { status: 403 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { accountId, amount, frequency, startDate, endDate, totalInstallments } = body

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!accountId || !amount || !frequency || !startDate) {
    return NextResponse.json({ error: 'Fields required: accountId, amount, frequency, startDate' }, { status: 400 })
  }
  if (!FREQUENCIES.includes(frequency)) {
    return NextResponse.json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` }, { status: 400 })
  }
  if (typeof amount !== 'number' || isNaN(amount) || amount < MIN_AMOUNT) {
    return NextResponse.json({ error: `Minimum SIP amount is ₹${MIN_AMOUNT}` }, { status: 400 })
  }
  if (amount > MAX_AMOUNT) {
    return NextResponse.json({ error: `Maximum SIP amount is ₹${MAX_AMOUNT.toLocaleString('en-IN')} per cycle.` }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 400 })
  }
  const startDateObj = new Date(`${startDate}T00:00:00+05:30`)
  if (isNaN(startDateObj.getTime())) return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })

  // Today = "start now": no start_at is sent, so Razorpay collects the first instalment as part of the
  // authorisation itself and the subscription is `active` immediately (later charges on this day of the
  // month). Any later date = mandate registered now, first charge on that date (`authenticated` until then).
  const todayIst = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00+05:30')
  const startsNow = startDateObj.getTime() === todayIst.getTime()
  if (startDateObj < todayIst) {
    return NextResponse.json({ error: 'startDate cannot be in the past' }, { status: 400 })
  }
  let endDateObj: Date | null = null
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return NextResponse.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 400 })
    endDateObj = new Date(`${endDate}T23:59:59+05:30`)
    if (isNaN(endDateObj.getTime()) || endDateObj <= startDateObj) {
      return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 })
    }
  }
  if (!user!.accountCodes?.includes(accountId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const clientRes = await pool.query(
      `SELECT clientid, clientcode, firstname, middlename, lastname, email, mobile
       FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`,
      [accountId]
    )
    if (!clientRes.rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const client = clientRes.rows[0]
    const customerName = [client.firstname, client.middlename, client.lastname].filter(Boolean).join(' ').trim() || 'Investor'

    // Razorpay needs a total_count (finite cycles) even for an "indefinite" SIP, and caps it per period
    // (e.g. yearly > 100 is rejected). Default = 10 years of cycles for the chosen frequency — the web's
    // Cashfree default is a flat 120 (10 years monthly), which Razorpay would reject for yearly.
    const TEN_YEARS: Record<string, number> = { daily: 3650, weekly: 520, monthly: 120, quarterly: 40, yearly: 10 }
    // With an end date, the cycle count is the number of charge dates from start to end inclusive.
    const cyclesUntil = (end: Date) => {
      const months = (end.getFullYear() - startDateObj.getFullYear()) * 12 + (end.getMonth() - startDateObj.getMonth()) - (end.getDate() < startDateObj.getDate() ? 1 : 0)
      const days = Math.floor((end.getTime() - startDateObj.getTime()) / 86400000)
      const n = frequency === 'monthly' ? months + 1 : frequency === 'quarterly' ? Math.floor(months / 3) + 1
        : frequency === 'yearly' ? Math.floor(months / 12) + 1 : frequency === 'weekly' ? Math.floor(days / 7) + 1 : days + 1
      return Math.max(1, Math.min(n, TEN_YEARS[frequency] || 120))
    }
    const totalCount = totalInstallments || (endDateObj ? cyclesUntil(endDateObj) : TEN_YEARS[frequency] || 120)
    const planName = `SIP_${accountId}_${Date.now()}`
    const plan: any = await createRazorpayPlan(amount, frequency, planName)

    // Charge at 10:00 IST on the chosen day (midnight IST is 18:30 UTC the day before, which made the
    // date read as the previous day in UTC-based displays).
    const startAtSeconds = startsNow ? undefined : Math.floor(new Date(`${startDate}T10:00:00+05:30`).getTime() / 1000)
    const subscription: any = await createRazorpaySubscription(plan.id, totalCount, {
      nuvama_code: accountId, client_id: String(client.clientid), source: 'qode_mobile_app', frequency,
    }, startAtSeconds)

    // The client's registered bank account (third-party validation): stored on the row so the checkout
    // page can prefill the mandate form with it. None on file → the client fills the form on Razorpay's page.
    const bank = await registeredBankFor(accountId).catch(() => null)

    await pool.query(
      `INSERT INTO payment_transactions (
         order_id, client_id, nuvama_code, client_name, amount, currency,
         payment_type, payment_status, investment_status,
         gateway, razorpay_subscription_id, frequency,
         start_date, end_date, total_installments, next_charge_date,
         account_number, ifsc_code,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'INR','SIP',$6,'PENDING_PAYMENT',
                 'razorpay',$7,$8,$9,$10,$11,$9,$12,$13,NOW(),NOW())`,
      [
        subscription.id, client.clientid, accountId, customerName, amount,
        subscription.status || 'created',
        subscription.id, frequency, startDate, endDate || null, totalInstallments || null,
        bank?.accountNumber || null, bank?.ifsc || null,
      ]
    )

    const exp = Date.now() + 30 * 60 * 1000
    const base = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, '') || new URL(request.url).origin
    const q = new URLSearchParams({ subId: subscription.id, exp: String(exp), t: checkoutToken(subscription.id, exp), kind: 'sip' })

    return NextResponse.json({
      subscriptionId: subscription.id,
      status: subscription.status,            // 'created' — authorise via checkout to reach 'active'
      amount, frequency, startDate,
      endDate: endDate || null,
      totalInstallments: totalInstallments || null,
      totalCount,
      startsNow,                              // first instalment collected at authorisation
      environment: process.env.RAZORPAY_ENVIRONMENT === 'live' ? 'live' : 'test',
      registeredBank: bank ? { last4: bank.accountNumber.slice(-4), ifsc: bank.ifsc, bankCode: bank.ifsc.slice(0, 4), holderName: bank.holderName } : null,
      checkoutPath: '/api/mobile/payments/razorpay/checkout?' + q.toString(),
      checkoutUrl: base + '/api/mobile/payments/razorpay/checkout?' + q.toString(),
    })
  } catch (err: any) {
    console.error('[mobile/services/setup-sip]', err)
    return NextResponse.json({ error: err?.message || 'Failed to set up SIP. Please try again.' }, { status: 502 })
  }
}
