// Wrong-password lockout shared by the web (/api/auth/login) and mobile (/api/mobile/auth/login) logins.
// 5 wrong passwords lock the account for 10 minutes.
// Keyed on lower(email) because one person can hold several pms_clients_master rows (family / schemes).
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const MAX_WRONG_PASSWORDS = 5
export const LOCK_MINUTES = 10

const minutesLeft = (until: Date | string | null | undefined) =>
  until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 60000)) : 0

/** Minutes the account is still locked for (0 = not locked). */
export async function lockedMinutes(email: string | null | undefined): Promise<number> {
  if (!email) return 0
  const { rows } = await query(
    `SELECT MAX(locked_until) AS until FROM pms_clients_master WHERE lower(email) = lower($1)`,
    [email]
  )
  return minutesLeft(rows[0]?.until)
}

/** Count a wrong password and return the reply: "N attempts left", or the lock once the 5th is reached.
 *  A lock that has run out starts the count again. */
export async function recordWrongPassword(email: string | null | undefined): Promise<NextResponse> {
  if (!email) return invalidCredentials()
  const next = `CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1 ELSE COALESCE(login_attempts, 0) + 1 END`
  const { rows } = await query(
    `UPDATE pms_clients_master
        SET login_attempts = ${next},
            locked_until   = CASE WHEN ${next} >= ${MAX_WRONG_PASSWORDS} THEN NOW() + INTERVAL '${LOCK_MINUTES} minutes' ELSE NULL END
      WHERE lower(email) = lower($1)
      RETURNING login_attempts, locked_until`,
    [email]
  )
  const locked = minutesLeft(rows.find((r: any) => r.locked_until)?.locked_until)
  if (locked) return lockedResponse(locked)
  return invalidCredentials(MAX_WRONG_PASSWORDS - Math.max(0, ...rows.map((r: any) => Number(r.login_attempts) || 0)))
}

/** Successful sign-in: forget earlier wrong passwords. */
export async function clearWrongPasswords(email: string | null | undefined): Promise<void> {
  if (!email) return
  await query(
    `UPDATE pms_clients_master SET login_attempts = 0, locked_until = NULL
      WHERE lower(email) = lower($1) AND (COALESCE(login_attempts, 0) <> 0 OR locked_until IS NOT NULL)`,
    [email]
  )
}

// ── Unknown emails / codes ─────────────────────────────────────────────────────────────────────────────────
// They lock after the same 5 tries, so "Too many wrong attempts" can't be used to tell a real account from a
// made-up one. Kept in memory: there is no row to store it on (resets on restart, which only shortens a lock).
const unknownTries = new Map<string, { count: number; until: number }>()
const unknownKey = (identifier: string) => String(identifier).trim().toLowerCase()

export function unknownLockedMinutes(identifier: string): number {
  const t = unknownTries.get(unknownKey(identifier))
  return t && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 60000) : 0
}

function recordUnknownIdentifier(identifier: string): NextResponse {
  const now = Date.now()
  if (unknownTries.size > 10000) for (const [k, v] of unknownTries) if (!v.until || v.until <= now) unknownTries.delete(k)
  const key = unknownKey(identifier)
  const prev = unknownTries.get(key)
  const count = prev && !(prev.until && prev.until <= now) ? prev.count + 1 : 1
  const until = count >= MAX_WRONG_PASSWORDS ? now + LOCK_MINUTES * 60000 : 0
  unknownTries.set(key, { count, until })
  return until ? lockedResponse(LOCK_MINUTES) : invalidCredentials(MAX_WRONG_PASSWORDS - count)
}

/** Reply for a login whose email / code matches nobody: identical to a real account's wrong password or lock. */
export function unknownIdentifierResponse(identifier: string) {
  const locked = unknownLockedMinutes(identifier)
  return locked ? lockedResponse(locked) : recordUnknownIdentifier(identifier)
}

export const lockedResponse = (minutes: number) =>
  NextResponse.json(
    { error: `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, code: 'ACCOUNT_LOCKED' },
    { status: 423 }
  )

/** One reply for an unknown account and a wrong password, so the login can't be used to find out who is a client.
 *  attemptsLeft: tries before the 30-minute lock (counted the same way for real and unknown accounts). */
export const invalidCredentials = (attemptsLeft?: number) =>
  NextResponse.json(
    {
      error: attemptsLeft != null && attemptsLeft > 0
        ? `Invalid email/ID or password. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left before your account is locked for ${LOCK_MINUTES} minutes.`
        : 'Invalid email/ID or password.',
      code: 'INVALID_CREDENTIALS',
      attemptsLeft,
    },
    { status: 401 }
  )
