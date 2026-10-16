// POST /api/mobile/auth/signup/send-otp — { phone } → a 6-digit code by SMS to verify the number before signing up
// (lib/smsOtp.ts, 2Factor). Public; rate-limited per number and per IP. Off production with no SMS provider, the code
// comes back as devOtp.
import { NextRequest, NextResponse } from 'next/server'
import { normalisePhone } from '@/lib/zohoLeads'
import { issuePhoneOtp } from '@/lib/smsOtp'

export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const phone = normalisePhone(String(body?.phone || ''))
  // Indian mobile numbers only (13 Oct 2026): the app takes 10 digits, and 2Factor sends to Indian numbers
  if (!phone || phone.cc !== '91') return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number.' }, { status: 400 })
  try {
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
    const r = await issuePhoneOtp(phone.e164, ip)
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code, retryAfterSec: r.retryAfterSec ?? null }, { status: r.code === 'SEND_FAILED' ? 502 : 429 })
    return NextResponse.json({ ok: true, phone: phone.e164, resendAfterSec: r.resendAfterSec, ...(r.devOtp ? { devOtp: r.devOtp } : {}) })
  } catch (err) {
    console.error('[mobile/auth/signup/send-otp]', err)
    return NextResponse.json({ error: 'Could not send the code. Please try again.' }, { status: 500 })
  }
}
