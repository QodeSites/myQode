// Mobile-number verification for the sign-up (13 Oct 2026): a 6-digit code by SMS, checked before the sign-up is
// recorded and the Zoho Lead created. Codes live in phone_otps (qode_portfolios) for 10 minutes; 3 sends per number
// per 15 minutes, 60 seconds between sends, 12 sends per IP per hour, 5 wrong tries per code.
//
// The SMS goes through 2Factor.in, the same provider OneView (qode-oneview/src/lib/otp.ts) and authServices use, so
// there is one SMS vendor across Qode. As there, 2Factor generates the code itself (AUTOGEN) and we keep only its
// session id, then ask it to VERIFY the code the person typed. Indian numbers go as the 10 digits, others in full
// with their country code.
//   TWO_FACTOR_API_KEY   the 2Factor key
//   OTP_TEST_NUMBERS     comma-separated numbers that get no SMS and sign up with OTP_TEST_CODE (default 123456);
//                        plus the store-review number 9999999999, always. Same allow-list as OneView, so a tester or
//                        a store reviewer never depends on SMS delivery. Unlisted numbers have no such code.
// Without the key: off production the code is logged on the server and returned to the app as devOtp so the flow can
// be tested without an SMS account; production refuses to send.
import { createHash, randomInt } from 'crypto'
import { query } from '@/lib/db'

const TTL_MIN = 10, SEND_WINDOW_MS = 15 * 60_000, SENDS_PER_WINDOW = 3, RESEND_GAP_MS = 60_000, MAX_TRIES = 5
const IP_WINDOW_MS = 60 * 60_000, SENDS_PER_IP = 12
const IS_PROD = process.env.NODE_ENV === 'production'
const hash = (phone: string, code: string) => createHash('sha256').update(`${phone}|${code}|${process.env.JWT_SECRET || ''}`).digest('hex')

export type SmsProvider = '2factor' | 'console'
export const smsProvider = (): SmsProvider => (process.env.TWO_FACTOR_API_KEY ? '2factor' : 'console')

// ── test numbers (OneView's rule) ───────────────────────────────────────────────────────────────────────────────
const REVIEW_PHONE = '9999999999', REVIEW_CODE = '123456'
const last10 = (phone: string) => String(phone).replace(/\D/g, '').slice(-10)
const testNumbers = () => (process.env.OTP_TEST_NUMBERS || '').split(',').map(last10).filter(n => n.length === 10)
/** A number that signs up with the fixed code and gets no SMS: the store-review number or one in OTP_TEST_NUMBERS. */
export const isTestPhone = (phone: string) => { const p = last10(phone); return p.length === 10 && (p === REVIEW_PHONE || testNumbers().includes(p)) }
const testCode = (phone: string) => (last10(phone) === REVIEW_PHONE ? REVIEW_CODE : process.env.OTP_TEST_CODE || '123456')

// ── 2Factor ─────────────────────────────────────────────────────────────────────────────────────────────────────
const twoFactorNumber = (e164: string) => (e164.startsWith('+91') ? e164.slice(3) : e164)
async function twoFactor(path: string): Promise<{ Status?: string; Details?: string }> {
  const res = await fetch(`https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/${path}`, { signal: AbortSignal.timeout(10_000) })
  return (await res.json().catch(() => ({}))) as { Status?: string; Details?: string }
}
/** 2Factor sends its own code; the session id is what verifies it later. */
async function sendViaTwoFactor(e164: string): Promise<string> {
  const data = await twoFactor(`${twoFactorNumber(e164)}/AUTOGEN`)
  if (data.Status !== 'Success' || !data.Details) throw new Error('2Factor refused the SMS: ' + (data.Details || 'no details'))
  return data.Details
}

async function ensureTable() {
  await query(`CREATE TABLE IF NOT EXISTS phone_otps (
    id serial PRIMARY KEY, phone text NOT NULL, code_hash text NOT NULL, expires_at timestamptz NOT NULL,
    tries int NOT NULL DEFAULT 0, verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`)
  await query(`ALTER TABLE phone_otps ADD COLUMN IF NOT EXISTS session_id text, ADD COLUMN IF NOT EXISTS ip text`)
  await query(`CREATE INDEX IF NOT EXISTS phone_otps_phone_idx ON phone_otps (phone, created_at DESC)`)
}

export type IssueResult = { ok: true; devOtp?: string; resendAfterSec: number } | { ok: false; error: string; code: 'TOO_SOON' | 'TOO_MANY' | 'SEND_FAILED'; retryAfterSec?: number }

/** Send a fresh code to this number (E.164). ip: the caller's, for the per-IP limit. */
export async function issuePhoneOtp(phoneE164: string, ip: string | null = null): Promise<IssueResult> {
  await ensureTable()
  const recent = (await query(`SELECT created_at, expires_at, tries, verified_at FROM phone_otps WHERE phone = $1 AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC`, [phoneE164])).rows
  // the 60-second gap only guards a code that can still be used; a locked or expired one may be replaced at once
  const live = recent[0] && !recent[0].verified_at && recent[0].tries < MAX_TRIES && new Date(recent[0].expires_at).getTime() > Date.now()
  if (live) {
    const since = Date.now() - new Date(recent[0].created_at).getTime()
    if (since < RESEND_GAP_MS) return { ok: false, error: 'A code was just sent. Please wait a minute before asking for another.', code: 'TOO_SOON', retryAfterSec: Math.ceil((RESEND_GAP_MS - since) / 1000) }
  }
  if (recent.length >= SENDS_PER_WINDOW) {
    const oldest = new Date(recent[recent.length - 1].created_at).getTime()
    return { ok: false, error: 'Too many codes requested for this number. Please try again in a few minutes.', code: 'TOO_MANY', retryAfterSec: Math.ceil((oldest + SEND_WINDOW_MS - Date.now()) / 1000) }
  }
  // one caller walking through many numbers is the SMS bill's real risk
  if (ip) {
    const byIp = (await query(`SELECT created_at FROM phone_otps WHERE ip = $1 AND created_at > now() - interval '1 hour' ORDER BY created_at ASC`, [ip])).rows
    if (byIp.length >= SENDS_PER_IP) return { ok: false, error: 'Too many codes requested. Please try again later.', code: 'TOO_MANY', retryAfterSec: Math.ceil((new Date(byIp[0].created_at).getTime() + IP_WINDOW_MS - Date.now()) / 1000) }
  }

  let codeHash = '', sessionId: string | null = null, devOtp: string | undefined
  if (isTestPhone(phoneE164)) {
    codeHash = hash(phoneE164, testCode(phoneE164))   // no SMS: the fixed code, checked locally
  } else if (smsProvider() === '2factor') {
    try { sessionId = await sendViaTwoFactor(phoneE164) } catch (e: any) {
      console.error('[smsOtp] send failed for', phoneE164, '-', e?.message)
      return { ok: false, error: 'We could not send the code right now. Please try again shortly.', code: 'SEND_FAILED' }
    }
  } else {
    if (IS_PROD) { console.error('[smsOtp] TWO_FACTOR_API_KEY is not configured'); return { ok: false, error: 'We could not send the code right now. Please try again shortly.', code: 'SEND_FAILED' } }
    const code = randomInt(100000, 1000000).toString()
    console.log(`[smsOtp] no SMS provider on this server — the code for ${phoneE164} is ${code}`)
    codeHash = hash(phoneE164, code); devOtp = code
  }
  await query(`UPDATE phone_otps SET expires_at = now() WHERE phone = $1 AND verified_at IS NULL AND expires_at > now()`, [phoneE164])   // one live code at a time
  await query(`INSERT INTO phone_otps (phone, code_hash, session_id, ip, expires_at) VALUES ($1, $2, $3, $4, now() + interval '${TTL_MIN} minutes')`, [phoneE164, codeHash, sessionId, ip])
  return { ok: true, resendAfterSec: RESEND_GAP_MS / 1000, ...(devOtp ? { devOtp } : {}) }
}

export type VerifyResult = { ok: true } | { ok: false; error: string; code: 'OTP_WRONG' | 'OTP_EXPIRED' | 'OTP_LOCKED' }

/** Check a code; a verified number stays usable by the sign-up for 30 minutes. */
export async function verifyPhoneOtp(phoneE164: string, code: string): Promise<VerifyResult> {
  await ensureTable()
  const row = (await query(`SELECT id, code_hash, session_id, tries, expires_at FROM phone_otps WHERE phone = $1 AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1`, [phoneE164])).rows[0]
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: 'This code has expired. Please request a new one.', code: 'OTP_EXPIRED' }
  if (row.tries >= MAX_TRIES) return { ok: false, error: 'Too many incorrect codes. Please request a new one.', code: 'OTP_LOCKED' }
  const typed = String(code || '').trim()
  // the wrong length can never match: say so without spending a try (OneView learnt this the hard way)
  if (!/^\d{6}$/.test(typed)) return { ok: false, error: 'The code is six digits.', code: 'OTP_WRONG' }

  let good: boolean, expired = false
  if (row.session_id) {
    // 2Factor holds the code; the same shape comes back for a wrong code and an expired session
    try {
      const data = await twoFactor(`VERIFY/${row.session_id}/${typed}`)
      good = data.Status === 'Success'
      expired = !good && String(data.Details || '').toLowerCase().includes('expire')
    } catch (e: any) {
      console.error('[smsOtp] verify error for', phoneE164, '-', e?.message)
      return { ok: false, error: 'We could not check that code. Please try again.', code: 'OTP_WRONG' }
    }
  } else good = row.code_hash === hash(phoneE164, typed)
  if (isTestPhone(phoneE164) && good) console.warn(`[smsOtp] TEST CODE ACCEPTED for ${phoneE164.slice(-4).padStart(10, '*')} — only possible because OTP_TEST_NUMBERS lists it`)

  if (!good) {
    if (expired) { await query(`UPDATE phone_otps SET expires_at = now() WHERE id = $1`, [row.id]); return { ok: false, error: 'This code has expired. Please request a new one.', code: 'OTP_EXPIRED' } }
    const tries = row.tries + 1
    await query(`UPDATE phone_otps SET tries = $2 WHERE id = $1`, [row.id, tries])
    if (tries >= MAX_TRIES) await query(`UPDATE phone_otps SET expires_at = now() WHERE id = $1`, [row.id])   // spent
    return tries >= MAX_TRIES ? { ok: false, error: 'Too many incorrect codes. Please request a new one.', code: 'OTP_LOCKED' }
      : { ok: false, error: `That code is not right. ${MAX_TRIES - tries} ${MAX_TRIES - tries === 1 ? 'try' : 'tries'} left.`, code: 'OTP_WRONG' }
  }
  await query(`UPDATE phone_otps SET verified_at = now() WHERE id = $1`, [row.id])
  return { ok: true }
}

/** True when this number was verified in the last 30 minutes (the sign-up's own check). */
export async function phoneVerifiedRecently(phoneE164: string): Promise<boolean> {
  await ensureTable()
  const r = await query(`SELECT 1 FROM phone_otps WHERE phone = $1 AND verified_at > now() - interval '30 minutes' LIMIT 1`, [phoneE164])
  return r.rows.length > 0
}
