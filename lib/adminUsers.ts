// Backoffice view of portal users (docs/admin-backoffice-api.md, "Users").
//
// A user is one login email (compared lowercased and trimmed). Investors can have several pms_clients_master
// rows sharing an email (one per account); distributors are rows with clientcode IS NULL. As at login, an
// email with any coded row signs in as an investor, so it is a distributor only when every row has no code.
// The "primary" row is the one login picks: head of family first, then the lowest client code.
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import pool from '@/lib/db1'

export type UserType = 'investor' | 'distributor'
export type UserStatusFilter = 'all' | 'needs-setup' | 'locked' | 'never'

export type AdminUserItem = {
  email: string
  name: string
  type: UserType
  clientCodes: string[]
  groupId: string | null
  headOfFamily: boolean
  passwordSet: boolean
  needsSetup: boolean
  locked: boolean
  lastLoginAt: string | null
  lastWebLoginAt: string | null
  lastAppLoginAt: string | null
  loginCount: number
  webLogins: number
  appLogins: number
  intermediary: string | null
  clientCount: number
  referredCount?: number
}

export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()

/** Password rules: 8+ characters, at least one letter and one digit. Returns an error message or null. */
export function passwordError(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain a letter and a digit.'
  return null
}

/** Parses a JSON body, or returns a 400 response. */
export async function readJson(req: NextRequest): Promise<{ body: any; error: NextResponse | null }> {
  try { return { body: (await req.json()) ?? {}, error: null } }
  catch { return { body: null, error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) } }
}

// One row per login email. $n parameters are appended by the callers.
const USERS_CTE = `
  WITH base AS (
    SELECT m.*, lower(trim(m.email)) AS em,
           NULLIF(trim(concat_ws(' ', m.salutation, m.firstname, m.middlename, m.lastname)), '') AS person_name
      FROM pms_clients_master m
     WHERE m.email IS NOT NULL AND trim(m.email) <> ''
  ),
  g AS (
    SELECT em AS email,
           bool_and(clientcode IS NULL) AS is_distributor,
           (array_agg(COALESCE(CASE WHEN clientcode IS NULL THEN clientname END, person_name, clientname, em)
                      ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST))[1] AS name,
           COALESCE(array_agg(DISTINCT clientcode) FILTER (WHERE clientcode IS NOT NULL), '{}') AS client_codes,
           (array_agg(groupid ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST))[1] AS group_id,
           COALESCE(bool_or(head_of_family), false) AS head_of_family,
           (array_agg(password IS NOT NULL AND password <> 'Qode@123'
                      ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST))[1] AS password_set,
           COALESCE(bool_or(locked_until > now()), false) AS locked,
           max(last_login_at) AS last_login_at,
           max(last_web_login_at) AS last_web_login_at,
           max(last_app_login_at) AS last_app_login_at,
           COALESCE(max(login_count), 0)::int AS login_count,
           COALESCE(max(web_login_count), 0)::int AS web_logins,
           COALESCE(max(app_login_count), 0)::int AS app_logins,
           (array_agg(intermediaryname ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST))[1] AS intermediary,
           (array_agg(clientname) FILTER (WHERE clientcode IS NULL))[1] AS distributor_key,
           string_agg(concat_ws(' ', clientname, person_name, clientcode), ' ') AS search_text
      FROM base
     GROUP BY em
  ),
  u AS (
    SELECT g.*,
           CASE WHEN g.is_distributor THEN (
             SELECT count(DISTINCT lower(trim(c.email)))::int FROM pms_clients_master c
              WHERE c.intermediaryname = g.distributor_key AND c.clientcode IS NOT NULL
           ) ELSE 0 END AS client_count
      FROM g
  )`

function toItem(r: any): AdminUserItem {
  const passwordSet = !!r.password_set
  return {
    email: r.email,
    name: r.name,
    type: r.is_distributor ? 'distributor' : 'investor',
    clientCodes: (r.client_codes || []).slice().sort(),
    groupId: r.group_id ?? null,
    headOfFamily: !!r.head_of_family,
    passwordSet,
    needsSetup: !passwordSet,
    locked: !!r.locked,
    lastLoginAt: r.last_login_at ?? null,
    lastWebLoginAt: r.last_web_login_at ?? null,
    lastAppLoginAt: r.last_app_login_at ?? null,
    loginCount: r.login_count ?? 0,
    webLogins: r.web_logins ?? 0,
    appLogins: r.app_logins ?? 0,
    intermediary: r.intermediary ?? null,
    clientCount: r.client_count ?? 0,
  }
}

// Investors per partner, counted as the partner portal counts them: Zoho investors in "First Fund Initiated" or
// "Regular Investor" (money invested). Nuvama's intermediary name lags (Enso Finserve: 0 there, 3 in Zoho), so
// it's only the fallback for a partner with no Zoho record. One cached Zoho read for all partners.
const INVESTED_STAGES = new Set(['First Fund Initiated', 'Regular Investor'])
async function withPortalInvestorCounts(items: AdminUserItem[]): Promise<AdminUserItem[]> {
  if (!items.some(i => i.type === 'distributor')) return items
  try {
    const { getAllDistributorJourneys } = await import('@/lib/zohoDistributorJourney')
    const byEmail = new Map<string, { invested: number; referred: number }>()
    for (const j of (await getAllDistributorJourneys()).values()) {
      const n = { invested: j.clients.filter(c => INVESTED_STAGES.has(String(c.stage))).length, referred: j.clients.length }
      for (const e of j.emails || []) byEmail.set(e, n)
    }
    return items.map(i => {
      const z = i.type === 'distributor' ? byEmail.get(i.email.toLowerCase()) : null
      return z ? { ...i, clientCount: z.invested, referredCount: z.referred } : i
    })
  } catch (e) {
    console.warn('[adminUsers] Zoho investor counts unavailable:', (e as any)?.message)
    return items
  }
}

export async function listUsers(opts: { q?: string; type?: string; status?: string; page?: number; limit?: number }) {
  const page = Math.max(1, Math.floor(Number(opts.page) || 1))
  const limit = Math.min(200, Math.max(1, Math.floor(Number(opts.limit) || 50)))
  const where: string[] = []
  const params: any[] = []

  const q = String(opts.q || '').trim()
  if (q) {
    params.push('%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%')
    where.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.search_text ILIKE $${params.length})`)
  }
  if (opts.type === 'investor') where.push('NOT u.is_distributor')
  if (opts.type === 'distributor') where.push('u.is_distributor')
  if (opts.status === 'needs-setup') where.push('NOT u.password_set')
  if (opts.status === 'locked') where.push('u.locked')
  if (opts.status === 'never') where.push('u.last_login_at IS NULL')

  params.push(limit, (page - 1) * limit)
  const r = await query(
    `${USERS_CTE}
     SELECT u.*, count(*) OVER()::int AS total
       FROM u
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.last_login_at DESC NULLS LAST, u.name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  const total = r.rows[0]?.total ?? (page > 1 ? (await countUsers(where, params.slice(0, -2))) : 0)
  return { items: await withPortalInvestorCounts(r.rows.map(toItem)), total, page, limit }
}

async function countUsers(where: string[], params: any[]): Promise<number> {
  const r = await query(`${USERS_CTE} SELECT count(*)::int AS n FROM u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params)
  return r.rows[0]?.n ?? 0
}

export async function getUser(email: string): Promise<AdminUserItem | null> {
  const r = await query(`${USERS_CTE} SELECT u.* FROM u WHERE u.email = $1`, [normEmail(email)])
  return r.rows[0] ? (await withPortalInvestorCounts([toItem(r.rows[0])]))[0] : null
}

/** Counts for the overview. */
export async function userCounts() {
  const r = await query(`${USERS_CTE}
    SELECT count(*) FILTER (WHERE NOT is_distributor)::int AS investors,
           count(*) FILTER (WHERE is_distributor)::int AS distributors,
           count(*) FILTER (WHERE password_set)::int AS password_set,
           count(*) FILTER (WHERE NOT password_set)::int AS needs_setup,
           count(*) FILTER (WHERE last_login_at IS NULL)::int AS never_logged_in,
           count(*) FILTER (WHERE locked)::int AS locked
      FROM u`)
  const c = r.rows[0] || {}
  return {
    investors: c.investors ?? 0, distributors: c.distributors ?? 0, passwordSet: c.password_set ?? 0,
    needsSetup: c.needs_setup ?? 0, neverLoggedIn: c.never_logged_in ?? 0, locked: c.locked ?? 0,
  }
}

export async function getUserDetail(email: string) {
  const e = normEmail(email)
  const user = await getUser(e)
  if (!user) return null

  const rows = (await query(
    `SELECT clientid, clientcode, clientname, schemename, maturity_date, onboarding_status, head_of_family, groupid, ownerid,
            NULLIF(trim(concat_ws(' ', salutation, firstname, middlename, lastname)), '') AS person_name
       FROM pms_clients_master
      WHERE lower(trim(email)) = $1
      ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST`,
    [e],
  )).rows
  const accounts = rows.map((r: any) => ({
    clientId: r.clientid,
    clientCode: r.clientcode,
    name: r.person_name || r.clientname,
    strategy: r.schemename ?? null,
    status: r.maturity_date && new Date(r.maturity_date) <= new Date() ? 'closed' : (r.onboarding_status || 'active'),
    headOfFamily: !!r.head_of_family,
    groupId: r.groupid ?? null,
    ownerId: r.ownerid ?? null,
    maturityDate: r.maturity_date ?? null,
  }))

  const logins = (await query(
    `SELECT occurred_at AS at, platform, os FROM login_events
      WHERE lower(trim(email)) = $1 ORDER BY occurred_at DESC LIMIT 50`,
    [e],
  ).catch(() => ({ rows: [] as any[] }))).rows

  // The app logs events under the JWT userId: clientid for investors, the email for distributors.
  const ids = [...new Set([e, ...rows.map((r: any) => r.clientid).filter(Boolean).map(String)])]
  let app: { lastVersion: string | null; platform: string | null; lastSeenAt: string } | null = null
  try {
    const a = (await pool.query(
      `SELECT app_version, platform, occurred_at FROM pms_clients_tracker.pms_mobile_analytics
        WHERE user_id = ANY($1::text[]) AND COALESCE(platform, '') <> 'web'
        ORDER BY occurred_at DESC LIMIT 1`,
      [ids],
    )).rows[0]
    if (a) app = { lastVersion: a.app_version ?? null, platform: a.platform ?? null, lastSeenAt: a.occurred_at }
  } catch (err) { console.error('[adminUsers] app lookup', err) }

  let investors: { email: string; name: string; clientCodes: string[] }[] | undefined
  if (user.type === 'distributor') {
    const key = (await query(
      `SELECT clientname FROM pms_clients_master WHERE lower(trim(email)) = $1 AND clientcode IS NULL LIMIT 1`, [e],
    )).rows[0]?.clientname
    investors = key ? (await query(
      `SELECT lower(trim(email)) AS email,
              (array_agg(COALESCE(NULLIF(trim(concat_ws(' ', salutation, firstname, middlename, lastname)), ''), clientname)
                         ORDER BY head_of_family DESC NULLS LAST, clientcode ASC))[1] AS name,
              array_agg(DISTINCT clientcode) FILTER (WHERE clientcode IS NOT NULL) AS codes
         FROM pms_clients_master
        WHERE intermediaryname = $1 AND clientcode IS NOT NULL AND email IS NOT NULL AND trim(email) <> ''
        GROUP BY lower(trim(email))
        ORDER BY 2`,
      [key],
    )).rows.map((r: any) => ({ email: r.email, name: r.name, clientCodes: (r.codes || []).sort() })) : []
  }

  const audit = (await query(
    `SELECT created_at AS at, admin_email AS admin, action, details FROM admin_audit_log
      WHERE lower(target) = $1 ORDER BY created_at DESC LIMIT 50`,
    [e],
  ).catch(() => ({ rows: [] as any[] }))).rows

  return { user, accounts, logins, app, investors, audit }
}

/** Sets a portal password on every row with this email and clears setup token and lockout. Returns rows updated. */
export async function setUserPassword(email: string, password: string): Promise<number> {
  const hash = await bcrypt.hash(password, 12)
  const r = await query(
    `UPDATE pms_clients_master
        SET password = $2, password_set_at = now(),
            password_setup_token = NULL, password_setup_expires = NULL,
            login_attempts = 0, locked_until = NULL
      WHERE lower(trim(email)) = $1`,
    [normEmail(email), hash],
  )
  return r.rowCount ?? 0
}

export async function unlockUser(email: string): Promise<number> {
  const r = await query(
    `UPDATE pms_clients_master SET login_attempts = 0, locked_until = NULL WHERE lower(trim(email)) = $1`,
    [normEmail(email)],
  )
  return r.rowCount ?? 0
}

/** The email exactly as stored on the user's primary row (password_reset_tokens and /api/auth/reset match it exactly). */
export async function storedEmail(email: string): Promise<string | null> {
  const r = await query(
    `SELECT email FROM pms_clients_master WHERE lower(trim(email)) = $1
      ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST LIMIT 1`,
    [normEmail(email)],
  )
  return r.rows[0]?.email ?? null
}
