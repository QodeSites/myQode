// Sign-in and account events for app analytics (table auth_events, database/migrations/007_app_analytics.sql).
// Call as `void logAuthEvent(req, {...})`: it never throws and never delays the response, and it does nothing
// until the migration has run. Never pass passwords, OTPs or tokens in `meta`.
//
// The app sends 'x-app-version' and 'x-device' headers (e.g. "1.3.0", "iPhone 15 · iOS 18.2"); web requests
// simply leave them empty.
import type { NextRequest } from 'next/server'
import { query } from '@/lib/db'

export type AuthEvent =
  | 'login_success' | 'login_failed' | 'lockout'
  | 'otp_sent' | 'otp_verified' | 'otp_failed'
  | 'password_set' | 'password_reset_requested' | 'password_reset_completed' | 'password_changed'
  | 'logout'

export type LoginFailReason =
  | 'wrong_password' | 'unknown_user' | 'locked' | 'account_closed' | 'role_mismatch'
  | 'no_password_set' | 'rate_limited' | 'other'
export type OtpFailReason = 'wrong_code' | 'expired' | 'too_many'

let ready = false
async function tableReady(): Promise<boolean> {
  if (ready) return true
  try {
    const r = await query(`SELECT to_regclass('public.auth_events') AS t`)
    ready = !!r.rows[0]?.t
  } catch { ready = false }
  return ready
}

const clip = (v: unknown, n: number) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, n) : null
}

export async function logAuthEvent(
  req: NextRequest | Request | null,
  e: { email?: string | null; event: AuthEvent; reason?: string | null; platform: 'web' | 'app' | 'admin'; os?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    if (!(await tableReady())) return
    const h = req?.headers
    const os = e.os === 'ios' || e.os === 'android' ? e.os : null
    await query(
      `INSERT INTO auth_events (email, event, reason, platform, os, app_version, device, ip, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        e.email ? String(e.email).trim().toLowerCase().slice(0, 254) : null,
        e.event,
        e.reason ? String(e.reason).slice(0, 40) : null,
        e.platform,
        os,
        clip(h?.get('x-app-version'), 20),
        clip(h?.get('x-device'), 120),
        clip((h?.get('x-forwarded-for') || '').split(',')[0], 64),
        JSON.stringify(e.meta || {}),
      ],
    )
  } catch (err: any) {
    console.error('[authEvents]', err?.message || err)
  }
}

/** The phone's OS from a request body ({ os } or { platform }, as the app sends them): 'ios' | 'android' | null. */
export const osFrom = (body: any): 'ios' | 'android' | null => {
  const v = String(body?.os ?? body?.platform ?? '').toLowerCase()
  return v === 'ios' || v === 'android' ? v : null
}
