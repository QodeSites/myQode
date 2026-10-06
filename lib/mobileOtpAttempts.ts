// Wrong-code limit for the password-setup OTP (web and mobile verify-setup-otp / complete-otp-setup).
// A 6-digit code lives 10 minutes; without a limit it can be guessed. After MAX_WRONG misses for an email the code is
// expired in the database and the email stays locked until a new code is sent, so every further try is told to
// request a new one. Counts live on globalThis: one map for every route in the server process, kept across dev reloads.
import { query } from '@/lib/db'

const MAX_WRONG = 5
const WINDOW_MS = 15 * 60 * 1000
type Entry = { n: number; at: number; locked: boolean }
const g = globalThis as any
const wrong: Map<string, Entry> = g.__qodeOtpWrong ?? (g.__qodeOtpWrong = new Map())

const live = (email: string) => { const e = wrong.get(email); return e && Date.now() - e.at < WINDOW_MS ? e : undefined }

export const TOO_MANY_OTP = { error: 'Too many incorrect codes. Please request a new code.', code: 'OTP_LOCKED' }
export const OTP_EXPIRED = { error: 'This code has expired. Please request a new code.', code: 'OTP_EXPIRED' }

export function isOtpLocked(email: string) { return !!live(email)?.locked }

/** Call after a wrong code. Returns true when the email is (now) locked out of this code. */
export async function recordWrongOtp(email: string): Promise<boolean> {
  const prev = live(email)
  if (prev?.locked) return true
  const n = (prev?.n ?? 0) + 1
  if (n < MAX_WRONG) { wrong.set(email, { n, at: prev?.at ?? Date.now(), locked: false }); return false }
  wrong.set(email, { n, at: Date.now(), locked: true })
  await query(
    `UPDATE pms_clients_master SET password_setup_expires = NOW() WHERE LOWER(email) = $1 AND password_setup_expires > NOW()`,
    [email]
  ).catch(e => console.error('[mobileOtpAttempts] invalidate failed:', e))
  return true
}

/** A new code was sent, or the code was used: start counting again. */
export function clearWrongOtp(email: string) { wrong.delete(email) }

/**
 * The response for a code that did not match: locked (429), expired or never sent (400, request a new one), or wrong
 * (400, with the attempts left). Only a wrong code against a live code counts towards the limit.
 */
export async function otpMiss(email: string): Promise<{ status: number; body: { error: string; code: string; attemptsLeft?: number } }> {
  if (isOtpLocked(email)) return { status: 429, body: TOO_MANY_OTP }
  const r = await query(
    `SELECT COALESCE(bool_or(password_setup_token IS NOT NULL AND password_setup_expires > NOW()), false) AS live
       FROM pms_clients_master WHERE LOWER(email) = $1`,
    [email]
  )
  if (!r.rows[0]?.live) return { status: 400, body: OTP_EXPIRED }
  if (await recordWrongOtp(email)) return { status: 429, body: TOO_MANY_OTP }
  const left = MAX_WRONG - (live(email)?.n ?? 0)
  return { status: 400, body: { error: `Incorrect code. You have ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`, code: 'OTP_WRONG', attemptsLeft: left } }
}
