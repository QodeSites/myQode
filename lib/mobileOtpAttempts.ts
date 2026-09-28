// Wrong-code limit for the mobile password-setup OTP (auth/verify-setup-otp, auth/complete-otp-setup).
// A 6-digit code lives 10 minutes; without a limit it can be guessed. After MAX_WRONG misses for an email the
// code is expired in the database, so the client must request a new one. Counts are per server process.
import { query } from '@/lib/db'

const MAX_WRONG = 5
const wrong = new Map<string, { n: number; at: number }>()
const WINDOW_MS = 15 * 60 * 1000

/** Call after a wrong code. Returns true when the code has just been invalidated. */
export async function recordWrongOtp(email: string): Promise<boolean> {
  const now = Date.now()
  const prev = wrong.get(email)
  const n = prev && now - prev.at < WINDOW_MS ? prev.n + 1 : 1
  if (n < MAX_WRONG) { wrong.set(email, { n, at: prev && now - prev.at < WINDOW_MS ? prev.at : now }); return false }
  wrong.delete(email)
  await query(
    `UPDATE pms_clients_master SET password_setup_expires = NOW() WHERE LOWER(email) = $1 AND password_setup_expires > NOW()`,
    [email]
  ).catch(e => console.error('[mobileOtpAttempts] invalidate failed:', e))
  return true
}

export function clearWrongOtp(email: string) { wrong.delete(email) }

export const TOO_MANY_OTP = { error: 'Too many incorrect codes. Please request a new code.', code: 'OTP_LOCKED' }
