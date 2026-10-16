// Zoho Desk tickets for requests raised in the myQode app and web (decided 12 Oct 2026):
//   Ask About a Strategy, Raise Any Query, Raise Family Request, Raise Account Request, Referral Program.
//   (Strategy switches go to Zoho CRM Switch Plans: lib/switchPlan.ts. Add Funds is not ticketed: decided 13 Oct 2026.)
//
// One ticket per request, in the Desk department set below, with the client as the ticket's contact (Desk finds the
// contact by email, or creates it). The Investor Relations email and the client's acknowledgement still go out as
// before; the acknowledgement quotes the ticket number. A Desk failure never fails the request: it is logged and the
// request carries on by email alone.
//
// Setup (once): node scripts/zoho-desk-token.js <Self Client grant code> (steps in the script), or, on a server whose
// address is the registered Zoho redirect, /api/auth/zoho/authorize?desk=1&secret=<ADMIN_SETUP_SECRET> signed in as
// a Desk agent with ticket-create rights; either gives ZOHO_DESK_REFRESH_TOKEN in .env. Then
// /api/auth/zoho/desk-status?secret=… lists the Desk organisations and departments, to set:
//   ZOHO_DESK_ORG_ID          the Desk organisation (default: the first one this login sees)
//   ZOHO_DESK_DEPARTMENT_ID   the department tickets land in (or ZOHO_DESK_DEPARTMENT = its name; default: the first)
// Tickets are created in production, and on another server only with ZOHO_DESK_LIVE=1.
// The OAuth client: ZOHO_DESK_CLIENT_ID / ZOHO_DESK_CLIENT_SECRET when the Desk token was issued to its own client,
// otherwise the CRM one (ZOHO_CRM_CLIENT_ID / SECRET, same Zoho account and data centre).

const DC = process.env.ZOHO_DESK_DATA_CENTER || process.env.ZOHO_CRM_DATA_CENTER || process.env.ZOHO_DATA_CENTER || 'in'
const DESK = `https://desk.zoho.${DC}/api/v1`
export const DESK_SCOPES = ['Desk.tickets.CREATE', 'Desk.tickets.READ', 'Desk.contacts.READ', 'Desk.contacts.CREATE', 'Desk.basic.READ']

// The refresh token: ZOHO_REFRESH_TOKEN (16 Oct 2026: the Desk token that can also read custom modules, for the request
// types) when set, else ZOHO_DESK_REFRESH_TOKEN. Both belong to the Desk client below.
const refreshToken = () => String(process.env.ZOHO_REFRESH_TOKEN || process.env.ZOHO_DESK_REFRESH_TOKEN || '').trim()
export const deskConfigured = () => !!refreshToken()
export const deskLive = () => deskConfigured() && (process.env.NODE_ENV === 'production' || process.env.ZOHO_DESK_LIVE === '1')

type Tok = { token: string; expiresAt: number }
const store: { tok: Tok | null; refresh: Promise<string> | null; org: string | null; dept: string | null } =
  ((globalThis as any).__qodeZohoDesk ??= { tok: null, refresh: null, org: null, dept: null })

async function accessToken(): Promise<string> {
  if (store.tok && store.tok.expiresAt > Date.now() + 60_000) return store.tok.token
  store.refresh ??= (async () => {
    const params = new URLSearchParams({
      refresh_token: refreshToken(),
      // the Desk token's own OAuth client when it has one, else the CRM client (same Zoho account)
      client_id: String(process.env.ZOHO_DESK_CLIENT_ID || process.env.ZOHO_CRM_CLIENT_ID || ''),
      client_secret: String(process.env.ZOHO_CLIENT_SECRET || process.env.ZOHO_DESK_CLIENT_SECRET || process.env.ZOHO_CRM_CLIENT_SECRET || ''),   // ZOHO_CLIENT_SECRET pairs with ZOHO_REFRESH_TOKEN
      grant_type: 'refresh_token',
    })
    const res = await fetch(`https://accounts.zoho.${DC}/oauth/v2/token?${params}`, { method: 'POST', cache: 'no-store' })
    const j: any = await res.json().catch(() => ({}))
    if (!j.access_token) throw new Error('Zoho Desk token refresh failed: ' + (j.error || res.status))
    store.tok = { token: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
    return j.access_token as string
  })().finally(() => { store.refresh = null })
  return store.refresh
}

async function desk(path: string, init: RequestInit = {}, withOrg = true): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${await accessToken()}`, 'Content-Type': 'application/json' }
  if (withOrg) headers.orgId = await orgId()
  const res = await fetch(`${DESK}${path}`, { ...init, cache: 'no-store', headers: { ...headers, ...((init.headers as any) || {}) } })
  if (res.status === 204) return null
  const body: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Zoho Desk ${path} refused (${res.status}): ${body?.message || body?.errorCode || ''}${body?.errors ? ' ' + JSON.stringify(body.errors).slice(0, 300) : ''}`)
  return body
}

// ── Request types (Desk custom module cm_request_types, 16 Oct 2026) ─────────────────────────────────────────────
// The types a client can choose when raising a request: active ones that are not staff-only, as
// { id, code, name, category }. The request is ?limit=100&fields=name,cf_type_code,cf_category,cf_active,cf_staff_only;
// Desk still returns at most 50 records a call, so a full page is followed by the next (&from=51, …) until a short one.
// Cached 10 minutes (per process): the app's form costs at most one listing in that time.
export type RequestType = { id: string; code: string; name: string; category: string }
const typesStore: { at: number; list: RequestType[] | null; p: Promise<RequestType[]> | null } =
  ((globalThis as any).__qodeDeskTypes ??= { at: 0, list: null, p: null })
export async function listRequestTypes(): Promise<RequestType[]> {
  if (typesStore.list && Date.now() - typesStore.at < 10 * 60_000) return typesStore.list
  typesStore.p ??= (async () => {
    const all: any[] = []
    const DESK_PAGE = 50   // Desk's own cap per call, whatever limit asks for
    for (let from = 1; from < 1000; from += DESK_PAGE) {
      const page = (await desk(`/cm_request_types?limit=100&fields=name,cf_type_code,cf_category,cf_active,cf_staff_only${from > 1 ? `&from=${from}` : ''}`))?.data || []
      all.push(...page)
      if (page.length < DESK_PAGE) break
    }
    const list: RequestType[] = all
      .filter((r: any) => String(r.cf?.cf_active) === 'true' && String(r.cf?.cf_staff_only) !== 'true')
      .map((r: any) => ({ id: String(r.id), code: String(r.cf?.cf_type_code || ''), name: String(r.name || ''), category: String(r.cf?.cf_category || '') }))
    typesStore.list = list; typesStore.at = Date.now()
    return list
  })().finally(() => { typesStore.p = null })
  return typesStore.p
}
/** The type with this code, or null (unknown code, or Desk unreachable). */
export async function requestTypeByCode(code: string): Promise<RequestType | null> {
  try { return (await listRequestTypes()).find(t => t.code === String(code).trim()) || null }
  catch (e: any) { console.warn('[zohoDesk] request types not read -', e?.message); return null }
}

/** The Desk organisations and departments this token sees (for setup: /api/auth/zoho/desk-status). */
export async function deskDirectory() {
  const orgs = (await desk('/organizations', {}, false))?.data || []
  const org = await orgId()
  const depts = (await desk('/departments?isEnabled=true&limit=100'))?.data || []
  return {
    organisations: orgs.map((o: any) => ({ id: String(o.id), name: o.companyName, portal: o.portalName, chosen: String(o.id) === org })),
    departments: depts.map((d: any) => ({ id: String(d.id), name: d.name, chosen: String(d.id) === store.dept })),
  }
}

async function orgId(): Promise<string> {
  if (process.env.ZOHO_DESK_ORG_ID) return String(process.env.ZOHO_DESK_ORG_ID)
  if (store.org) return store.org
  const orgs = (await desk('/organizations', {}, false))?.data || []
  if (!orgs.length) throw new Error('This Zoho Desk login sees no organisation')
  return (store.org = String(orgs[0].id))
}

async function departmentId(): Promise<string> {
  if (process.env.ZOHO_DESK_DEPARTMENT_ID) return String(process.env.ZOHO_DESK_DEPARTMENT_ID)
  if (store.dept) return store.dept
  const depts = (await desk('/departments?isEnabled=true&limit=100'))?.data || []
  const want = String(process.env.ZOHO_DESK_DEPARTMENT || '').trim().toLowerCase()
  const d = (want && depts.find((x: any) => String(x.name || '').toLowerCase() === want)) || depts[0]
  if (!d) throw new Error('No enabled Zoho Desk department found')
  return (store.dept = String(d.id))
}

export type DeskTicketStatus = { ticketNumber: string; status: string; statusType: 'Open' | 'On Hold' | 'Closed' | string; modifiedTime: string | null; closedTime: string | null; webUrl: string | null
  deleted?: boolean   // deleted in Desk: in its trash (isTrashed) or gone altogether (404) — the app no longer lists it
}
const ticketCache = new Map<string, { at: number; t: DeskTicketStatus | null }>()
const TICKET_TTL_MS = 20_000   // near real time (16 Oct 2026; was 2 minutes); still one Desk read per ticket per 20 s at most
let readBlockedUntil = 0   // the token has no Desk.tickets.READ: stop asking for a while, say so once
/**
 * A ticket's current status, for the app's request tracking (lib/requestTracking.ts); cached 20 seconds. A ticket
 * deleted in Desk comes back with deleted: true — Desk keeps a trashed ticket readable, still "Open", with
 * isTrashed — so it can be left out. Null when Desk is not set up or the token cannot read tickets (logged once an
 * hour; regenerate it with Desk.tickets.READ, scripts/zoho-desk-token.js).
 */
export async function getDeskTicketStatus(id: string): Promise<DeskTicketStatus | null> {
  if (!deskConfigured() || !id || Date.now() < readBlockedUntil) return null
  const hit = ticketCache.get(id)
  if (hit && Date.now() - hit.at < TICKET_TTL_MS) return hit.t
  let t: DeskTicketStatus | null = null
  try {
    const d = await desk(`/tickets/${id}?include=`)
    if (d) t = { ticketNumber: String(d.ticketNumber), status: String(d.status || ''), statusType: String(d.statusType || ''), modifiedTime: d.modifiedTime || null, closedTime: d.closedTime || null, webUrl: d.webUrl || null, deleted: d.isTrashed === true }
  } catch (e: any) {
    if (/\(404\)/.test(String(e?.message))) {
      t = { ticketNumber: '', status: '', statusType: '', modifiedTime: null, closedTime: null, webUrl: null, deleted: true }   // deleted for good
    } else if (/SCOPE_MISMATCH|\(403\)/.test(String(e?.message))) {
      readBlockedUntil = Date.now() + 3600_000
      console.error('[zohoDesk] the Desk token cannot read tickets (add Desk.tickets.READ, scripts/zoho-desk-token.js); statuses show as Submitted for the next hour')
    } else console.warn('[zohoDesk] ticket', id, 'not read -', e?.message)
  }
  ticketCache.set(id, { at: Date.now(), t })
  return t
}

export type DeskRequest = {
  kind: 'strategy' | 'discussion' | 'family_request' | 'account_request' | 'referral' | 'link_family' | 'topup' | 'update_details' | 'switch_query'
  subject: string
  email: string                  // the client: the ticket's contact
  name?: string | null
  phone?: string | null
  accountId?: string | null
  fields: [string, string | number | null | undefined][]   // label / value rows for the description
  priority?: 'High' | 'Medium' | 'Low'
  channel?: 'Web' | 'App' | null   // where it was raised (lib/requestChannel.ts); unknown → "myQode"
  label?: string                   // the request's name in the subject and description, instead of the kind's
  typeCode?: string | null         // a request type's code (cm_request_types, e.g. 'C1'): set on the ticket as cf_request_type
}
export type DeskTicket = { id: string; ticketNumber: string; webUrl: string | null }

const KIND_LABEL: Record<DeskRequest['kind'], string> = {
  strategy: 'Ask About a Strategy', discussion: 'Raise Any Query',
  family_request: 'Family Request', account_request: 'Account Request', referral: 'Referral',
  // "What do you need help with?" on Account Services (15 Oct 2026; app/api/mobile/services/help-request)
  link_family: 'Link Family Accounts', topup: 'Investment Related Query', update_details: 'Update Details', switch_query: 'Switch Strategy (query)',
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/**
 * Raise a Desk ticket for an app request. Returns the ticket, or null when Desk is not set up on this server or
 * refused (logged): the caller carries on either way.
 */
export async function raiseDeskTicket(r: DeskRequest): Promise<DeskTicket | null> {
  if (!deskLive()) return null
  try {
    const name = String(r.name || '').trim()
    const parts = name.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').split(/\s+/).filter(Boolean)
    const label = r.label || KIND_LABEL[r.kind]
    const type = r.typeCode ? await requestTypeByCode(r.typeCode) : null
    const rows = [['Request', label], ['Request type', type ? `${type.name} (${type.code})` : null], ['Raised from', r.channel || 'myQode'], ['Account', r.accountId], ['Client email', r.email], ...r.fields]
      .filter(([, v]) => v != null && String(v).trim() !== '')
      // investor ids are stored float-formatted ("14410854.0"); show them as the plain id
      .map(([k, v]) => [k, k === 'Investor ID' ? String(v).replace(/\.0+$/, '') : v])
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:4px 0">${esc(v).replace(/\n/g, '<br/>')}</td></tr>`).join('')
    const body = {
      subject: `${label}: ${r.subject}`.slice(0, 250),
      departmentId: await departmentId(),
      contact: { email: r.email, lastName: parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] || r.email), ...(parts.length > 1 ? { firstName: parts[0] } : {}), ...(r.phone ? { phone: r.phone } : {}) },
      email: r.email,
      ...(r.phone ? { phone: r.phone } : {}),
      channel: 'Web',
      priority: r.priority || 'Medium',
      description: `<table>${rows}</table>`,
      // the request type the client chose: the Request Type lookup, who set it, and its id (none chosen → no cf)
      ...(type ? { cf: { cf_request_type: type.id, cf_type_set_by: 'App', cf_applied_type_id: type.id } } : {}),
    }
    const t = await desk('/tickets', { method: 'POST', body: JSON.stringify(body) })
    return { id: String(t.id), ticketNumber: String(t.ticketNumber), webUrl: t.webUrl || null }
  } catch (e: any) {
    console.error('[zohoDesk] ticket not raised for', r.kind, '-', e?.message)
    return null
  }
}
