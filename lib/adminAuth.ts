// Backoffice access for /api/admin/* (web backoffice at /admin and the app's admin mode).
//
// ONE source of truth (12 Oct 2026): admin_users.role, managed on the Admins page. Each admin has one role:
//  - 'super'     everything: every investor and partner, settings, admins, audit log
//  - 'investors' the investor side: act on and open any investor's dashboard as them (Investors, documents,
//                payments, notifications, password resets)
//  - 'partners'  the partner side: act on and open any partner's portal as them (Distributors, partner invoices)
//  - 'accounts'  the accounts team: Distributor invoices only (payment status, proofs, receipts); web only
//  - 'viewer'    read-only, no impersonation, no changes
// Sign-in: email + password (admin_users, bcrypt) on the web (httpOnly `qode-admin` cookie) or in the app (Bearer JWT
// from /api/mobile/auth/login), or Microsoft on the web (Redis `admin-session`); all three read the same role.
// Before any role is stored, the old env lists still apply (BACKOFFICE_ADMINS → super, ADMIN_AUTHORIZED_EMAILS →
// viewer), so nothing breaks while the table is being filled.
// Every sensitive action is written to admin_audit_log (who, what, whom, when, from where).
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db'
import { logAuthEvent } from '@/lib/authEvents'

export type AdminLevel = 'staff' | 'super'
export type AdminRole = 'super' | 'investors' | 'partners' | 'accounts' | 'viewer'
export type AdminScope = 'investors' | 'partners' | 'accounts'
export const ADMIN_ROLES: AdminRole[] = ['super', 'investors', 'partners', 'accounts', 'viewer']
/** level: 'super' = may act (within its scope for investors / partners admins), 'staff' = read-only. */
export type Admin = { email: string; name: string; level: AdminLevel; role: AdminRole; via: 'password' | 'app' | 'microsoft' }

export const ADMIN_COOKIE = 'qode-admin'
const ADMIN_TTL = 60 * 60 * 12   // 12 h
export const adminCookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: ADMIN_TTL, secure: process.env.NODE_ENV === 'production' }

const list = (v?: string) => (v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const norm = (email?: string | null) => String(email || '').trim().toLowerCase()

// ── roles (admin_users.role) ───────────────────────────────────────────────────────────────────────────────
let roleCache: { at: number; map: Map<string, { role: AdminRole; name: string | null }> } | null = null
/** Every admin and their role. Cached 30 s; clearAdminRoles() after a change. */
export async function adminRoles(): Promise<Map<string, { role: AdminRole; name: string | null }>> {
  if (roleCache && Date.now() - roleCache.at < 30_000) return roleCache.map
  await ensureAdminTables()
  const r = await query(`SELECT email, name, role FROM admin_users WHERE role IS NOT NULL`)
  const map = new Map<string, { role: AdminRole; name: string | null }>()
  for (const x of r.rows as any[]) if (ADMIN_ROLES.includes(x.role)) map.set(norm(x.email), { role: x.role, name: x.name })
  if (!map.size) {   // nothing stored yet: the old env lists
    for (const e of list(process.env.ADMIN_AUTHORIZED_EMAILS)) map.set(e, { role: 'viewer', name: null })
    for (const e of list(process.env.BACKOFFICE_ADMINS)) map.set(e, { role: 'super', name: null })
  }
  roleCache = { at: Date.now(), map }
  return map
}
export const clearAdminRoles = () => { roleCache = null }
/** The admin role of an email, or null when it is not an admin. */
export async function adminRoleOf(email?: string | null): Promise<AdminRole | null> {
  if (!email) return null
  try { return (await adminRoles()).get(norm(email))?.role ?? null } catch { return null }
}
/** Any admin (any role). */
export const isAdminEmail = async (email?: string | null) => (await adminRoleOf(email)) != null
/** Admins who sign in to the app's admin mode: super, investors and partners admins (accounts and viewers use the web). */
export const isAppAdmin = async (email?: string | null) => { const r = await adminRoleOf(email); return r === 'super' || r === 'investors' || r === 'partners' }
const levelOf = (role: AdminRole): AdminLevel => (role === 'viewer' ? 'staff' : 'super')
/** May this admin act on the investor side ('investors') or the partner side ('partners')? */
export const canAct = (admin: Admin | null | undefined, scope: AdminScope) => !!admin && (admin.role === 'super' || admin.role === scope)

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
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role text;
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role_updated_at timestamptz;
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role_updated_by text;
    `).catch(e => { ready = null; throw e })
  }
  return ready
}

// ── passwords ──────────────────────────────────────────────────────────────────────────────────────────────
/** Checks an admin's email + password. Returns the admin, or an error message safe to show. */
export async function checkAdminPassword(email: string, password: string): Promise<{ admin?: Admin; error?: string }> {
  const e = String(email || '').trim().toLowerCase()
  const role = await adminRoleOf(e)
  if (!role || !password) return { error: 'Invalid credentials' }
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
    if (n >= 5) void logAuthEvent(null, { email: e, event: 'lockout', platform: 'admin', meta: { minutes: 15 } })
    return { error: 'Invalid credentials' }
  }
  await query(`UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE email = $1`, [e])
  return { admin: { email: e, name: row.name || e.split('@')[0], level: levelOf(role), role, via: 'password' } }
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

async function fromJwt(token: string): Promise<Admin | null> {
  let p: any
  try { p = jwt.verify(token, process.env.JWT_SECRET!) } catch { return null }
  // The role is read now, not taken from the token: a changed or removed role applies at once.
  if (p.kind === 'admin') {
    const role = await adminRoleOf(p.email)
    return role ? { email: norm(p.email), name: p.name || p.email, level: levelOf(role), role, via: 'password' } : null
  }
  // The app's admin login: a mobile JWT for an admin (never an impersonation token).
  if (p.isAdmin && !p.isImpersonated) {
    const role = await adminRoleOf(p.email)
    return role && (role === 'super' || role === 'investors' || role === 'partners') ? { email: norm(p.email), name: p.name || p.email, level: levelOf(role), role, via: 'app' } : null
  }
  return null
}

async function fromMicrosoft(req: NextRequest): Promise<Admin | null> {
  const sid = req.cookies.get('admin-session')?.value
  if (!sid || !process.env.REDIS_URL) return null
  try {
    const { getSession } = await import('@/lib/session-store')
    // Redis being down must not hang the request.
    const s: any = await Promise.race([getSession(sid), new Promise(r => setTimeout(() => r(null), 1500))])
    const email = s?.user?.email || s?.user?.preferred_username
    if (!s || !email || (s.expiresAt && Date.now() > s.expiresAt)) return null
    const role = await adminRoleOf(email)
    if (!role) return null
    return { email: norm(email), name: s.user.name || email, level: levelOf(role), role, via: 'microsoft' }
  } catch { return null }
}

/** The signed-in admin for this request, or null. */
export async function currentAdmin(req: NextRequest): Promise<Admin | null> {
  const c = req.cookies.get(ADMIN_COOKIE)?.value
  if (c) { const a = await fromJwt(c); if (a) return a }
  const h = req.headers.get('authorization') || ''
  if (h.startsWith('Bearer ')) { const a = await fromJwt(h.slice(7)); if (a) return a }
  return fromMicrosoft(req)
}

/** Guard for /api/admin/* handlers. `level: 'super'` for anything that changes data or acts as someone else:
 *  then only a super admin passes, unless `scope` names the side it acts on ('investors' / 'partners'), when that
 *  side's admins pass too. 'staff' (read-only) lets every admin in. */
export async function requireAdmin(req: NextRequest, level: AdminLevel = 'super', scope?: AdminScope | AdminScope[]): Promise<{ admin: Admin | null; error: NextResponse | null }> {
  const admin = await currentAdmin(req)
  if (!admin) return { admin: null, error: NextResponse.json({ error: 'Admin sign-in required', code: 'ADMIN_AUTH' }, { status: 401 }) }
  if (level === 'super') {
    const scopes = scope ? (Array.isArray(scope) ? scope : [scope]) : []
    if (!(admin.role === 'super' || scopes.some(x => canAct(admin, x)))) return { admin: null, error: forbidden() }
  }
  return { admin, error: null }
}
export const forbidden = () => NextResponse.json({ error: 'Your admin role does not cover this', code: 'ADMIN_FORBIDDEN' }, { status: 403 })

// ── audit ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function audit(req: NextRequest | null, admin: Admin | { email: string }, action: string, target?: string | null, details?: Record<string, unknown>) {
  try {
    await ensureAdminTables()
    const ip = req ? (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null : null
    await query(`INSERT INTO admin_audit_log (admin_email, action, target, details, ip) VALUES ($1, $2, $3, $4, $5)`,
      [admin.email, action, target || null, details ? JSON.stringify(details) : null, ip])
  } catch (e) { console.error('[admin audit]', e) }
}
