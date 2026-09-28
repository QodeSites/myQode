// Backoffice access for /api/admin/* (web backoffice at /admin and the app's admin mode).
//
// Two levels:
//  - 'super': backoffice admins — BACKOFFICE_ADMINS (comma-separated emails). Sign in with email + password
//    (admin_users table, bcrypt), on the web (httpOnly `qode-admin` cookie) or in the app (Bearer JWT from
//    /api/mobile/auth/login). May impersonate, set passwords, create / delete distributors, send emails.
//  - 'staff': read-only analytics and investor queries — the Microsoft-login admins (ADMIN_AUTHORIZED_EMAILS,
//    Redis `admin-session`), as before. Super admins are staff too.
// Every sensitive action is written to admin_audit_log (who, what, whom, when, from where).
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db'

export type AdminLevel = 'staff' | 'super'
export type Admin = { email: string; name: string; level: AdminLevel; via: 'password' | 'app' | 'microsoft' }

export const ADMIN_COOKIE = 'qode-admin'
const ADMIN_TTL = 60 * 60 * 12   // 12 h
export const adminCookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: ADMIN_TTL, secure: process.env.NODE_ENV === 'production' }

const list = (v?: string) => (v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
/** BACKOFFICE_ADMINS, lowercased. */
export const backofficeAdminEmails = () => list(process.env.BACKOFFICE_ADMINS)
export const isBackofficeAdmin = (email?: string | null) => !!email && list(process.env.BACKOFFICE_ADMINS).includes(email.trim().toLowerCase())
/** Backoffice admins the app signs in to its admin mode (APP_ADMIN_EMAILS, a subset of BACKOFFICE_ADMINS). */
export const isAppAdmin = (email?: string | null) => isBackofficeAdmin(email) && list(process.env.APP_ADMIN_EMAILS).includes(String(email).trim().toLowerCase())
const isStaffEmail = (email?: string | null) => !!email && (isBackofficeAdmin(email) || list(process.env.ADMIN_AUTHORIZED_EMAILS).includes(email.trim().toLowerCase()))

// ── tables ─────────────────────────────────────────────────────────────────────────────────────────────────
let ready: Promise<unknown> | null = null
export function ensureAdminTables() {
  if (!ready) {
    ready = query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        email text PRIMARY KEY,
        name text,
        password text,
        password_set_at timestamptz,
        last_login_at timestamptz,
        failed_attempts int NOT NULL DEFAULT 0,
        locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id bigserial PRIMARY KEY,
        admin_email text NOT NULL,
        action text NOT NULL,
        target text,
        details jsonb,
        ip text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC);
    `).catch(e => { ready = null; throw e })
  }
  return ready
}

// ── passwords ──────────────────────────────────────────────────────────────────────────────────────────────
/** Checks an admin's email + password. Returns the admin, or an error message safe to show. */
export async function checkAdminPassword(email: string, password: string): Promise<{ admin?: Admin; error?: string }> {
  const e = String(email || '').trim().toLowerCase()
  if (!isBackofficeAdmin(e) || !password) return { error: 'Invalid credentials' }
  await ensureAdminTables()
  const row = (await query(`SELECT email, name, password, failed_attempts, locked_until FROM admin_users WHERE email = $1`, [e])).rows[0]
  if (!row || !row.password) return { error: 'Invalid credentials' }
  if (row.locked_until && new Date(row.locked_until) > new Date()) return { error: 'Too many attempts. Try again in 15 minutes.' }
  const ok = await bcrypt.compare(password, row.password)
  if (!ok) {
    const n = (row.failed_attempts || 0) + 1
    // Five wrong passwords lock the account for 15 minutes.
    await query(`UPDATE admin_users SET failed_attempts = CASE WHEN $2 >= 5 THEN 0 ELSE $2 END,
                   locked_until = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE NULL END WHERE email = $1`, [e, n])
    return { error: 'Invalid credentials' }
  }
  await query(`UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE email = $1`, [e])
  return { admin: { email: e, name: row.name || e.split('@')[0], level: 'super', via: 'password' } }
}

export async function setAdminPassword(email: string, password: string, name?: string) {
  const e = String(email).trim().toLowerCase()
  await ensureAdminTables()
  const hash = await bcrypt.hash(password, 12)
  await query(
    `INSERT INTO admin_users (email, name, password, password_set_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, password_set_at = now(), failed_attempts = 0, locked_until = NULL,
       name = COALESCE(EXCLUDED.name, admin_users.name)`, [e, name || null, hash])
}

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────────────────
export function signAdminToken(a: Admin): string {
  return jwt.sign({ kind: 'admin', email: a.email, name: a.name }, process.env.JWT_SECRET!, { expiresIn: ADMIN_TTL })
}

function fromJwt(token: string): Admin | null {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET!) as any
    if (p.kind === 'admin' && isBackofficeAdmin(p.email)) return { email: p.email, name: p.name || p.email, level: 'super', via: 'password' }
    // The app's admin login: a mobile JWT for a backoffice admin (never an impersonation token).
    if (p.isSuperAdmin && p.isAdmin && !p.isImpersonated && isAppAdmin(p.email)) return { email: p.email, name: p.name || p.email, level: 'super', via: 'app' }
    return null
  } catch { return null }
}

async function fromMicrosoft(req: NextRequest): Promise<Admin | null> {
  const sid = req.cookies.get('admin-session')?.value
  if (!sid || !process.env.REDIS_URL) return null
  try {
    const { getSession } = await import('@/lib/session-store')
    // Redis being down must not hang the request.
    const s: any = await Promise.race([getSession(sid), new Promise(r => setTimeout(() => r(null), 1500))])
    const email = s?.user?.email || s?.user?.preferred_username
    if (!s || !email || (s.expiresAt && Date.now() > s.expiresAt) || !isStaffEmail(email)) return null
    return { email: String(email).toLowerCase(), name: s.user.name || email, level: isBackofficeAdmin(email) ? 'super' : 'staff', via: 'microsoft' }
  } catch { return null }
}

/** The signed-in admin for this request, or null. */
export async function currentAdmin(req: NextRequest): Promise<Admin | null> {
  const c = req.cookies.get(ADMIN_COOKIE)?.value
  if (c) { const a = fromJwt(c); if (a) return a }
  const h = req.headers.get('authorization') || ''
  if (h.startsWith('Bearer ')) { const a = fromJwt(h.slice(7)); if (a) return a }
  return fromMicrosoft(req)
}

/** Guard for /api/admin/* handlers. `level: 'super'` for anything that changes data or acts as someone else. */
export async function requireAdmin(req: NextRequest, level: AdminLevel = 'super'): Promise<{ admin: Admin | null; error: NextResponse | null }> {
  const admin = await currentAdmin(req)
  if (!admin) return { admin: null, error: NextResponse.json({ error: 'Admin sign-in required', code: 'ADMIN_AUTH' }, { status: 401 }) }
  if (level === 'super' && admin.level !== 'super') return { admin: null, error: NextResponse.json({ error: 'This needs backoffice access', code: 'ADMIN_FORBIDDEN' }, { status: 403 }) }
  return { admin, error: null }
}

// ── audit ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function audit(req: NextRequest | null, admin: Admin | { email: string }, action: string, target?: string | null, details?: Record<string, unknown>) {
  try {
    await ensureAdminTables()
    const ip = req ? (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null : null
    await query(`INSERT INTO admin_audit_log (admin_email, action, target, details, ip) VALUES ($1, $2, $3, $4, $5)`,
      [admin.email, action, target || null, details ? JSON.stringify(details) : null, ip])
  } catch (e) { console.error('[admin audit]', e) }
}
