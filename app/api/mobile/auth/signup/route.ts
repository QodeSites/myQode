// POST /api/mobile/auth/signup — someone new to Qode signs up (name, email, mobile) to preview a sample portfolio
// in the app or on the web (decided 13 Oct 2026; this replaces the open "Explore a demo" link).
//   - an email that belongs to an investor → { existing: true } and the app sends them to sign in
//   - a mobile number not yet in Zoho CRM Leads → a new Lead (lib/zohoLeads.ts); one already there → no new lead
//   - every sign-up is recorded in app_signups (qode_portfolios) with the lead id, so the preview works even when
//     Zoho is slow or refuses (the lead is then missing and logged, never a blocker for the person signing up)
//   - the mobile number must be verified first: the 6-digit code from /signup/send-otp comes in the body as otp
//     (lib/smsOtp.ts), or the number was verified in the last 30 minutes
// Public (no sign-in), so inputs are validated and the body is small. Rate limiting is the proxy's.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { normalisePhone, findLeadByPhone, createSignupLead } from '@/lib/zohoLeads'
import { requestChannel } from '@/lib/requestChannel'
import { verifyPhoneOtp, phoneVerifiedRecently } from '@/lib/smsOtp'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = String(body?.name || '').trim().replace(/\s+/g, ' ')
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = normalisePhone(String(body?.phone || ''))
  if (name.replace(/[^A-Za-z]/g, '').length < 2 || name.length > 80) return NextResponse.json({ error: 'Please enter your full name.' }, { status: 400 })
  if (!EMAIL.test(email) || email.length > 120) return NextResponse.json({ error: 'That email address doesn’t look right.' }, { status: 400 })
  if (!phone || phone.cc !== '91') return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number.' }, { status: 400 })
  const channel = requestChannel(request)

  try {
    // the number is verified by SMS code (lib/smsOtp.ts)
    const otp = String(body?.otp || '').trim()
    if (otp) {
      const v = await verifyPhoneOtp(phone.e164, otp)
      if (!v.ok) return NextResponse.json({ error: v.error, code: v.code }, { status: 400 })
    } else if (!(await phoneVerifiedRecently(phone.e164))) {
      return NextResponse.json({ error: 'Please verify your mobile number with the code we sent.', code: 'OTP_REQUIRED' }, { status: 400 })
    }
    await query(`CREATE TABLE IF NOT EXISTS app_signups (
      id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL, phone text NOT NULL, channel text,
      lead_id text, lead_status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
    // an existing investor: sign in instead (no lead for someone who is already a client)
    const inv = await query(`SELECT 1 FROM pms_clients_master WHERE clientcode IS NOT NULL AND lower(email) = $1 LIMIT 1`, [email])
    if (inv.rows.length) {
      await query(`INSERT INTO app_signups (name, email, phone, channel, lead_status) VALUES ($1, $2, $3, $4, 'investor')`, [name, email, phone.e164, channel])
      return NextResponse.json({ existing: true, message: 'This email already has a myQode account. Please sign in.' })
    }
    let leadId: string | null = null, leadStatus = 'created'
    try {
      leadId = await findLeadByPhone(phone.e164, phone.number)
      if (leadId) leadStatus = 'existing'
      else leadId = await createSignupLead({ name, email, phone, channel })
    } catch (e: any) {
      leadStatus = 'failed'
      console.error('[mobile/auth/signup] lead not created for', email, '-', e?.message)
    }
    await query(`INSERT INTO app_signups (name, email, phone, channel, lead_id, lead_status) VALUES ($1, $2, $3, $4, $5, $6)`, [name, email, phone.e164, channel, leadId, leadStatus])
    return NextResponse.json({ ok: true, lead: leadStatus })
  } catch (err) {
    console.error('[mobile/auth/signup]', err)
    return NextResponse.json({ error: 'Could not complete the sign-up. Please try again.' }, { status: 500 })
  }
}
