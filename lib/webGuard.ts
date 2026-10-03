// Access checks for the web portal's API routes (/api/portfolio-*, /api/fetch-transactions, SIP and payment routes,
// …). Identity comes only from the signed session (lib/webSession.ts) or a verified admin (lib/adminAuth.ts) —
// never from the plain qode-* cookies or from request parameters.
//
// Which accounts a signed-in investor may read mirrors /api/auth/client-data, which builds the portal's account
// list: every pms_clients_master row with the session's email (open or closed), plus the whole group for a group the
// user heads; and the group and owner ids of those rows (the portal's family and owner views pass them as
// account codes, sometimes as "65941.0").
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { currentAdmin } from '@/lib/adminAuth'
import { webSession, type WebSession } from '@/lib/webSession'
import { normaliseAccountCode } from '@/lib/utils'

const norm = (v: unknown) => normaliseAccountCode(v == null ? '' : String(v)).toUpperCase()

export const unauthorised = () =>
  NextResponse.json({ success: false, error: 'Please sign in again.', code: 'SIGN_IN_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
const forbidden = () =>
  NextResponse.json({ success: false, error: 'You do not have access to this account.', code: 'FORBIDDEN' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })

/** Every id (client code, client id, group id, owner id) this session may read, normalised. */
export async function allowedIds(s: WebSession): Promise<Set<string>> {
  const out = new Set<string>(s.codes.map(norm))
  const email = String(s.ctx?.email || '').trim().toLowerCase()
  if (!email) return out
  const mine = await query<{ clientcode: string; clientid: string; groupid: string | null; ownerid: string | null; head_of_family: boolean | null }>(
    `SELECT clientcode, clientid, groupid, ownerid, head_of_family FROM pms_clients_master WHERE lower(trim(email)) = $1`, [email])
  const headedGroups = new Set<string>()
  for (const r of mine.rows) {
    for (const v of [r.clientcode, r.clientid, r.groupid, r.ownerid]) if (v) out.add(norm(v))
    if (r.groupid && (s.ctx?.head_of_family === true || r.head_of_family === true)) headedGroups.add(String(r.groupid))
  }
  if (headedGroups.size) {
    const fam = await query<{ clientcode: string; clientid: string; ownerid: string | null }>(
      `SELECT clientcode, clientid, ownerid FROM pms_clients_master WHERE groupid::text = ANY($1::text[])`, [[...headedGroups]])
    for (const r of fam.rows) for (const v of [r.clientcode, r.clientid, r.ownerid]) if (v) out.add(norm(v))
  }
  return out
}

export type Access = { admin: true; session: null } | { admin: false; session: WebSession }

/** Signed-in investor/distributor session or admin; otherwise a 401 response. */
export async function requireWebUser(req: NextRequest): Promise<{ access: Access; error: null } | { access: null; error: NextResponse }> {
  if (await currentAdmin(req)) return { access: { admin: true, session: null }, error: null }
  const session = await webSession()
  if (!session) return { access: null, error: unauthorised() }
  return { access: { admin: false, session }, error: null }
}

/**
 * Guard for routes that read or act on specific accounts. Pass every account identifier the request names
 * (nuvama_code, account_code, a list, …); empty values are ignored. Returns null when allowed, else a 401/403.
 */
export async function guardAccounts(req: NextRequest, ids: unknown[]): Promise<NextResponse | null> {
  const { access, error } = await requireWebUser(req)
  if (error) return error
  if (access.admin) return null
  const wanted = ids.flatMap(v => (Array.isArray(v) ? v : String(v ?? '').split(','))).map(norm).filter(Boolean)
  if (!wanted.length) return null
  const allowed = await allowedIds(access.session)
  return wanted.every(id => allowed.has(id)) ? null : forbidden()
}

/** Account code of a payment / SIP row by order id, Cashfree order id or subscription id (null if none). */
export async function paymentAccount(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const r = await query<{ nuvama_code: string }>(
    `SELECT nuvama_code FROM payment_transactions WHERE order_id = $1 OR cf_order_id = $1 OR cf_subscription_id = $1 LIMIT 1`, [id])
  return r.rows[0]?.nuvama_code ?? null
}

/** Guard for routes keyed by a payment/SIP id: the row must belong to an account the caller may access. */
export async function guardPayment(req: NextRequest, id: string | null | undefined, alsoIds: unknown[] = []): Promise<NextResponse | null> {
  const code = await paymentAccount(id)
  if (id && !code) {
    const { access, error } = await requireWebUser(req)
    if (error) return error
    return access.admin ? null : forbidden()
  }
  return guardAccounts(req, [code, ...alsoIds])
}
