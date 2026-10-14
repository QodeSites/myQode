// App analytics data (GET /api/admin/bo/analytics/clients, and the reminders that go to a group of clients):
// one row per client. A client is an owner (pms_clients_master.ownerid, the same "owner" the Admin Dashboard counts)
// with an open account; several accounts count once. A login belongs to an email, and a few family members share
// one: each of them is a client in their own right and carries that login's password, phone and activity.
// Owners on record = clients + owners who closed every account + Qode's test accounts (summary.ownersOnRecord).
//   ?days=7|14|30|90        the period for "used it", pages and notifications (IST days, default 30)
//   ?email=<client email>   one client's activity log instead: what they opened, sign-ins, notifications
//   ?note=<category>|<title> who received one notification in the period
// Sources: main db pms_clients_master (password, first/last sign-ins), app_push_devices (notifications switched on),
// app_notifications, auth_events; db1 pms_clients_tracker.pms_mobile_analytics (what was opened; the new app 1.3+
// and the new web only). Qode admin sessions (user_id 'a:…') and partners ('d:…') are left out.
import { query } from '@/lib/db'
import { query as query1 } from '@/lib/db1'

const A = 'pms_clients_tracker.pms_mobile_analytics'
const CLIENT = `u.user_id NOT LIKE 'a:%' AND u.user_id NOT LIKE 'd:%'`
// Qode's own test accounts (QTEST0001…) are not clients
export const REAL = `clientcode ~* '^Q' AND clientcode !~* '^QTEST'`
/** SQL: this row of pms_clients_master shows a password was set up (the one rule every admin page uses). */
export const HAS_PASSWORD = `(password_set_at IS NOT NULL OR coalesce(password, '') NOT IN ('', 'Qode@123') OR first_login_at IS NOT NULL OR last_login_at IS NOT NULL
  OR first_app_login_at IS NOT NULL OR first_web_login_at IS NOT NULL)`
// The new website signs in through the app's route. Its first such sign-in on record is 4 Oct 2026, 01:26 IST
// (auth_events), six days before it went live for everyone, so an app sign-in without a phone type proves the
// phone app only before that day.
const WEB_LAUNCH = '2026-10-04 00:00+05:30'
// Two kinds of app, nothing in between: the new app is this version or later, anything before it is the old app.
// A fixed version, not "the latest in the stores", so a later release does not turn today's new app into the old one.
export const NEW_APP_VERSION = process.env.APP_NEW_VERSION || '1.3.1'
const older = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false }
const istDay = (t: number) => new Date(t + 330 * 60000).toISOString().slice(0, 10)
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch (e) { console.error('[bo/analytics/clients]', (e as Error).message); return fallback } }

// Plain names for what the app records
const SCREENS: Record<string, string> = {
  home: 'Home', portfolio: 'Portfolio', holdings: 'Holdings', reports: 'Reports', services: 'Services', more: 'More', docs: 'Documents',
  'page:transactions': 'Transactions', 'page:insights': 'Insights', 'page:reports': 'Report downloads', 'page:risk': 'Risk management',
  'page:strategies': 'Strategies', 'page:team': 'Team', 'page:sip': 'SIP', 'page:events': 'Events', '/portfolio/performance': 'Performance',
  '/portfolio/snapshot': 'Portfolio', '/': 'Home',
}
// Old web portal pages arrive as paths ("/experience/investor-portal-guide"): the last part is the page
const screenName = (k: string) => SCREENS[k] ?? (String(k || '').replace(/^page:/, '').replace(/\/+$/, '').split('/').pop() || 'Home').replace(/[_-]+/g, ' ').replace('managment', 'management').replace(/^\w/, c => c.toUpperCase())
const ACTIONS: Record<string, string> = {
  session_start: 'Opened the app', biometric_enabled: 'Turned on Face ID / fingerprint', xlsx_download: 'Downloaded an Excel report',
  pdf_download: 'Downloaded a PDF report', notification_open: 'Opened a notification', notification_permission: 'Allowed notifications',
  payment_started: 'Started adding funds', payment_cancelled: 'Cancelled adding funds', payment_pending: 'Payment pending',
  payment_success: 'Added funds', report_view: 'Viewed a report', request_submitted: 'Submitted a service request', logout: 'Signed out',
}
const AUTH: Record<string, string> = {
  login_success: 'Signed in', lockout: 'Account locked after wrong passwords', otp_sent: 'Setup code sent', otp_verified: 'Setup code verified',
  otp_failed: 'Wrong setup code', password_set: 'Set up a password', password_reset_requested: 'Asked to reset the password',
  password_reset_completed: 'Reset the password', password_changed: 'Changed the password', logout: 'Signed out',
}
const FAIL: Record<string, string> = { wrong_password: 'Wrong password', unknown_user: 'Email not on file', locked: 'Account locked', no_password_set: 'Password not set up yet', rate_limited: 'Too many attempts' }
const DEVICE: Record<string, string> = { ios: 'iPhone', android: 'Android', web: 'Website' }
const NOTE_KIND: Record<string, string> = { money: 'Money', portfolio: 'Portfolio', reading: 'Insights and newsletters' }
// "Money received: (QAW00385)" → "Money received": one line per kind of notification, not per account
const noteTitle = (t: string) => String(t || '').replace(/\s*:?\s*\([A-Z]{2,4}\d+\)\s*$/, '').replace(/\s*crossed ₹.*$/, ' crossed a milestone').replace(/received your ₹.*$/, 'received your money').replace(/^Your ₹.* is going into .*$/, 'Your money is going into a strategy').trim()
// A newsletter or perspective is one message to everyone, and its body starts with the issue ("Sep 2026. Tap to read."):
// each issue is its own line, so "sent" and "clients" are the same number
const NOTE_SUB = `CASE WHEN category = 'reading' THEN nullif(trim(split_part(body, '.', 1)), '') END`
const noteLabel = (title: string, sub: string | null) => (sub ? `${noteTitle(title)}: ${sub}` : noteTitle(title))
// Whether a notification reached the phone: 'no_device' = the client has no phone registered, so it sits in the in-app inbox only
const reach = (s: string | null) => (s === 'delivered' || s === 'unconfirmed' ? 'phone' : s === 'failed' ? 'failed' : s === 'held' ? 'waiting' : 'inbox')

export type Person = { id: string; email: string; name: string; accounts: string[] }

// Staff "Open as": the old web portal recorded an admin's page views under the client's own email, so they looked
// like the client's use. Those are the web page views (paths) in the 4 hours after an audited impersonation of that
// client (admin_audit_log, kept since 27 Sep 2026). The new app and web never record an impersonated session.
const NOT_STAFF = `NOT (u.platform = 'web' AND u.event_name LIKE '/%' AND EXISTS (
  SELECT 1 FROM unnest($1::text[], $2::timestamptz[]) AS imp(uid, at) WHERE imp.uid = lower(u.user_id) AND u.occurred_at BETWEEN imp.at - interval '2 minutes' AND imp.at + interval '4 hours'))`
export async function staffViews(byEmail: Map<string, Person>): Promise<[string[], string[]]> {
  const rows = await safe(async () => (await query(
    `SELECT lower(target) AS email, created_at FROM admin_audit_log WHERE action IN ('user.impersonate', 'impersonate.open', 'managed.impersonate') AND created_at > NOW() - interval '100 days'`)).rows, [] as any[])
  const ids: string[] = [], at: string[] = []
  for (const r of rows) for (const id of [r.email, ...(byEmail.get(r.email)?.accounts ?? []).map(a => a.toLowerCase())]) { ids.push(id); at.push(new Date(r.created_at).toISOString()) }
  return [ids, at]
}

/** Every client (open accounts) by email, and the lookup from an analytics user_id (account code or email) to that email. */
export async function people() {
  const rows = (await query(
    `SELECT lower(trim(email)) AS email, clientcode, trim(regexp_replace(clientname, '\\s+', ' ', 'g')) AS name, ownerid::text AS owner,
            (maturity_date IS NULL OR maturity_date > NOW()) AS open
       FROM pms_clients_master WHERE ${REAL} AND coalesce(trim(email), '') <> '' ORDER BY head_of_family DESC NULLS LAST, clientcode`)).rows
  // byEmail: the login (every open account under that email). owners: the clients behind it, usually one.
  const byEmail = new Map<string, Person>(), idToEmail = new Map<string, string>(), byOwner = new Map<string, Person>()
  for (const r of rows) {
    idToEmail.set(String(r.clientcode).toLowerCase(), r.email)
    if (!r.open) continue
    const p: Person = byEmail.get(r.email) ?? { id: r.email, email: r.email, name: r.name, accounts: [] }
    p.accounts.push(r.clientcode); byEmail.set(r.email, p)
    const id = r.owner || r.email   // an owner counts once, under the first email found for them
    const o: Person = byOwner.get(id) ?? { id, email: r.email, name: r.name, accounts: [] }
    if (o.email === r.email) { o.accounts.push(r.clientcode); byOwner.set(id, o) }
  }
  const owners = new Map<string, Person[]>()
  for (const o of byOwner.values()) { o.accounts.sort(); owners.set(o.email, [...(owners.get(o.email) ?? []), o]) }
  for (const p of byEmail.values()) p.accounts.sort()
  const emailOf = (userId: string) => { const k = String(userId || '').toLowerCase(); return idToEmail.get(k) ?? (k.includes('@') ? k : null) }
  return { byEmail, emailOf, owners }
}

export const sinceSql = (days: number) => `(('${istDay(Date.now() - (days - 1) * 86400000)}')::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`

export type ClientStatus = 'no_password' | 'never_signed_in' | 'website_only' | 'old_app' | 'app_not_used' | 'using_app' | 'family_covered'

/** Everything the page shows for the last `days` days (7, 14, 30 or 90). */
export async function clientUsage(daysIn: number) {
  const days = [7, 14, 30, 90].includes(Number(daysIn)) ? Number(daysIn) : 30
  const today = istDay(Date.now()), from = istDay(Date.now() - (days - 1) * 86400000)
  const since = sinceSql(days)
  const { byEmail, emailOf, owners } = await people()
  // How many clients a login email stands for (1, or more where family members share it)
  const w = (email: string) => owners.get(email)?.length || 1
  const weigh = (emails: Iterable<string>) => { let n = 0; for (const e of emails) n += w(e); return n }
  const staff = await staffViews(byEmail)
  const [master, push, notes, use, last, pages, heads, record] = await Promise.all([
    query(
      `SELECT lower(trim(email)) AS email,
              bool_or(${HAS_PASSWORD}) AS pw,
              min(password_set_at) AS pw_at,
              bool_or(first_login_at IS NOT NULL OR last_login_at IS NOT NULL OR first_app_login_at IS NOT NULL OR last_app_login_at IS NOT NULL
                      OR first_web_login_at IS NOT NULL OR last_web_login_at IS NOT NULL) AS signed_in,
              -- "Has the phone app": a sign-in from an iPhone or Android, or an app sign-in before the new website
              -- existed (the website signs in through the app's route too, so an app sign-in alone proves nothing
              -- from ${WEB_LAUNCH} on; older app builds did not say which phone they were).
              bool_or(last_ios_login_at IS NOT NULL OR last_android_login_at IS NOT NULL OR first_app_login_at < '${WEB_LAUNCH}') AS app,
              bool_or(last_ios_login_at IS NOT NULL) AS ios, bool_or(last_android_login_at IS NOT NULL) AS android,
              min(first_app_login_at) FILTER (WHERE last_ios_login_at IS NOT NULL OR last_android_login_at IS NOT NULL OR first_app_login_at < '${WEB_LAUNCH}') AS app_since,
              max(greatest(last_ios_login_at, last_android_login_at, CASE WHEN last_app_login_at < '${WEB_LAUNCH}' THEN last_app_login_at END)) AS app_last,
              max(greatest(last_web_login_at, last_app_login_at)) AS web_last,
              bool_or(locked_until > NOW()) AS locked
         FROM pms_clients_master
        WHERE ${REAL} AND coalesce(trim(email), '') <> '' AND (maturity_date IS NULL OR maturity_date > NOW())
        GROUP BY 1`),
    safe(async () => (await query(`SELECT lower(email) AS email, string_agg(DISTINCT platform, ',') AS platforms FROM app_push_devices WHERE is_active GROUP BY 1`)).rows, [] as any[]),
    safe(async () => (await query(
      `SELECT lower(email) AS email, category, title, ${NOTE_SUB} AS sub, push_status, (read_at IS NOT NULL) AS read, count(*)::int AS n, max(created_at) AS last
         FROM app_notifications WHERE created_at >= ${since} GROUP BY 1, 2, 3, 4, 5, 6`)).rows, [] as any[]),
    safe(async () => (await query1(
      `SELECT u.user_id, u.platform, to_char(u.occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS d, count(DISTINCT u.session_id)::int AS opens
         FROM ${A} u WHERE ${CLIENT} AND ${NOT_STAFF} AND u.occurred_at >= ${since} GROUP BY 1, 2, 3`, staff)).rows, [] as any[]),
    safe(async () => (await query1(
      `SELECT u.user_id, max(u.occurred_at) AS last, max(u.occurred_at) FILTER (WHERE u.platform IN ('ios', 'android')) AS last_app,
              (array_agg(u.app_version ORDER BY u.occurred_at DESC) FILTER (WHERE u.platform IN ('ios', 'android') AND coalesce(u.app_version, '') <> ''))[1] AS version,
              bool_or(u.platform = 'ios') AS ios, bool_or(u.platform = 'android') AS android
         FROM ${A} u WHERE ${CLIENT} AND ${NOT_STAFF} GROUP BY 1`, staff)).rows, [] as any[]),
    safe(async () => (await query1(
      `SELECT u.user_id, u.event_name, count(*)::int AS n FROM ${A} u
        WHERE ${CLIENT} AND ${NOT_STAFF} AND u.event_type = 'screen' AND u.occurred_at >= ${since} GROUP BY 1, 2`, staff)).rows, [] as any[]),
    // Families: each member's family (groupid) and that family's head. A head's login shows every account in the
    // family, so a member without a password of their own is not someone to chase once the head has signed up.
    safe(async () => (await query(
      `SELECT lower(trim(m.email)) AS email, lower(trim(h.email)) AS head
         FROM pms_clients_master m JOIN pms_clients_master h ON h.groupid = m.groupid AND h.head_of_family
        WHERE m.clientcode ~* '^Q' AND m.groupid IS NOT NULL AND coalesce(trim(m.email), '') <> '' AND coalesce(trim(h.email), '') <> ''
          AND (m.maturity_date IS NULL OR m.maturity_date > NOW()) AND (h.maturity_date IS NULL OR h.maturity_date > NOW())
          AND lower(trim(h.email)) <> lower(trim(m.email))
        GROUP BY 1, 2`)).rows, [] as any[]),
    // Owners on record, the Admin Dashboard's "Total Owners": everyone with an owner id, closed and test accounts included
    safe(async () => (await query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE test)::int AS test, count(*) FILTER (WHERE NOT test AND NOT open)::int AS closed,
              sum(n)::int AS accounts, sum(n_test)::int AS accounts_test, sum(n_closed)::int AS accounts_closed
         FROM (SELECT ownerid, bool_or(clientcode ~* '^QTEST') AS test,
                      bool_or(${REAL} AND coalesce(trim(email), '') <> '' AND (maturity_date IS NULL OR maturity_date > NOW())) AS open,
                      count(*) AS n, count(*) FILTER (WHERE clientcode ~* '^QTEST') AS n_test,
                      count(*) FILTER (WHERE clientcode !~* '^QTEST' AND maturity_date <= NOW()) AS n_closed
                 FROM pms_clients_master WHERE ownerid IS NOT NULL GROUP BY 1) o`)).rows[0], null as any),
  ])

  type Row = {
    id: string; email: string; name: string; accounts: string[]; status: ClientStatus | ''; passwordSet: boolean; passwordSetAt: string | null; signedIn: boolean
    hasApp: boolean; newApp: boolean; devices: string[]; appVersion: string | null; appSince: string | null; lastUsed: string | null; lastUsedApp: string | null
    daysUsed: number; opens: number; usedToday: boolean; used7: boolean; usedTodayApp: boolean; used7App: boolean; topPages: string[]; notificationsOn: boolean
    notesSent: number; notesOnPhone: number; notesRead: number; locked: boolean; familyHead: string | null
  }
  const rows = new Map<string, Row>()
  for (const m of master.rows) {
    const p = byEmail.get(m.email); if (!p) continue
    rows.set(m.email, {
      id: m.email, email: m.email, name: p.name, accounts: p.accounts, status: '', passwordSet: !!m.pw, passwordSetAt: m.pw_at ? new Date(m.pw_at).toISOString() : null,
      signedIn: !!m.signed_in, hasApp: !!m.app, newApp: false, devices: [m.ios && 'iPhone', m.android && 'Android'].filter(Boolean) as string[], appVersion: null,
      appSince: m.app_since ? new Date(m.app_since).toISOString() : null,
      lastUsed: [m.app_last, m.web_last].filter(Boolean).map((x: any) => new Date(x).toISOString()).sort().pop() ?? null,
      lastUsedApp: m.app_last ? new Date(m.app_last).toISOString() : null,
      daysUsed: 0, opens: 0, usedToday: false, used7: false, usedTodayApp: false, used7App: false, topPages: [], notificationsOn: false, notesSent: 0, notesOnPhone: 0, notesRead: 0, locked: !!m.locked, familyHead: null,
    })
  }
  // A client with no password and no sign-in on record cannot have opened anything: whatever the old portal holds
  // under their name is staff viewing as them from before the audit log (only a phone-app event proves otherwise).
  const cannot = new Set(master.rows.filter((m: any) => !m.pw && !m.signed_in).map((m: any) => m.email as string))
  const later = (a: string | null, b: unknown) => { const x = b ? new Date(b as any).toISOString() : null; return x && (!a || x > a) ? x : a }
  for (const l of last) {
    const r = rows.get(emailOf(l.user_id) || ''); if (!r) continue
    if (l.last_app) { r.hasApp = true; r.signedIn = true; r.passwordSet = true; cannot.delete(r.email) }
    if (cannot.has(r.email)) continue
    r.lastUsed = later(r.lastUsed, l.last); r.lastUsedApp = later(r.lastUsedApp, l.last_app)
    if (l.version && (!r.appVersion || l.version > r.appVersion)) r.appVersion = l.version
    for (const [flag, label] of [[l.ios, 'iPhone'], [l.android, 'Android']] as const) if (flag && !r.devices.includes(label)) r.devices.push(label)
  }
  // Days used and the daily chart: a person counts once a day, as "app" if they used the phone app that day, else "website"
  const d7 = istDay(Date.now() - 6 * 86400000)
  const dayPeople = new Map<string, Map<string, boolean>>(), personDays = new Map<string, Set<string>>()
  for (const u of use) {
    const e = emailOf(u.user_id), r = rows.get(e || ''); if (!r || cannot.has(r.email)) continue
    r.opens += u.opens
    const set = personDays.get(r.email) ?? new Set<string>(); set.add(u.d); personDays.set(r.email, set)
    const m = dayPeople.get(u.d) ?? new Map<string, boolean>(); m.set(r.email, m.get(r.email) || u.platform !== 'web'); dayPeople.set(u.d, m)
    const onApp = u.platform !== 'web'
    if (u.d === today) { r.usedToday = true; if (onApp) r.usedTodayApp = true }
    if (u.d >= d7) { r.used7 = true; if (onApp) r.used7App = true }
  }
  for (const [e, set] of personDays) rows.get(e)!.daysUsed = set.size
  const daily = Array.from({ length: days }, (_, i) => {
    const d = istDay(Date.now() - (days - 1 - i) * 86400000), m = dayPeople.get(d)
    const app = m ? weigh([...m].filter(x => x[1]).map(x => x[0])) : 0
    return { date: d, app, website: m ? weigh(m.keys()) - app : 0 }
  })
  // Pages: people per page, and each person's three most opened
  const pagePeople = new Map<string, Set<string>>(), pageViews = new Map<string, number>(), personPages = new Map<string, Map<string, number>>()
  for (const s of pages) {
    const r = rows.get(emailOf(s.user_id) || ''); if (!r || cannot.has(r.email)) continue
    const name = screenName(s.event_name)
    const set = pagePeople.get(name) ?? new Set<string>(); set.add(r.email); pagePeople.set(name, set)
    pageViews.set(name, (pageViews.get(name) || 0) + s.n)
    const pm = personPages.get(r.email) ?? new Map<string, number>(); pm.set(name, (pm.get(name) || 0) + s.n); personPages.set(r.email, pm)
  }
  for (const [e, pm] of personPages) rows.get(e)!.topPages = [...pm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0])
  for (const p of push) { const r = rows.get(p.email); if (r) { r.notificationsOn = true; r.hasApp = true } }
  // Notifications: per person, and per kind of notification
  const kinds = new Map<string, { key: string; kind: string; title: string; sent: number; last: string; people: Set<string>; phone: Set<string>; read: Set<string> }>()
  for (const x of notes) {
    const r = rows.get(x.email); if (!r) continue
    const onPhone = reach(x.push_status) === 'phone'
    r.notesSent += x.n; if (onPhone) r.notesOnPhone += x.n; if (x.read) r.notesRead += x.n
    const title = noteLabel(x.title, x.sub), key = `${x.category}|${title}`, at = new Date(x.last).toISOString()
    const k = kinds.get(key) ?? { key, kind: NOTE_KIND[x.category] ?? x.category, title, sent: 0, last: at, people: new Set<string>(), phone: new Set<string>(), read: new Set<string>() }
    k.sent += x.n; if (at > k.last) k.last = at
    k.people.add(r.email); if (onPhone) k.phone.add(r.email); if (x.read) k.read.add(r.email)
    kinds.set(key, k)
  }
  // One plain status per client, in the order someone would chase them
  const cut = Date.now() - 30 * 86400000
  for (const r of rows.values()) {
    r.devices.sort()
    // The old app: any version before NEW_APP_VERSION, and the apps that do not report a version at all
    r.newApp = r.hasApp && !!r.appVersion && !older(r.appVersion, NEW_APP_VERSION)
    r.status = !r.passwordSet ? 'no_password' : !r.signedIn ? 'never_signed_in' : !r.hasApp ? 'website_only' : !r.newApp ? 'old_app'
      : r.lastUsedApp && Date.parse(r.lastUsedApp) >= cut ? 'using_app' : 'app_not_used'
  }
  // A family member with no password whose family head has a login: seen through the head, kept apart from "No password yet"
  for (const h of heads) {
    const r = rows.get(h.email), head = rows.get(h.head)
    if (r && head && r.status === 'no_password' && head.passwordSet) { r.status = 'family_covered'; r.familyHead = head.name }
  }
  // One row per client: each owner behind a login carries that login's figures
  const seen = new Set<string>()
  const list = [...rows.values()].flatMap(r => (owners.get(r.email) ?? [byEmail.get(r.email)!]).filter(o => !seen.has(o.id) && !!seen.add(o.id))
    .map(o => ({ ...r, id: o.id, name: o.name, accounts: o.accounts }))).sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || '') || a.name.localeCompare(b.name))
  const count = (f: (r: Row) => boolean) => list.filter(f).length
  const isNew = (r: Row) => r.newApp
  return {
    days, from, to: today, generatedAt: new Date().toISOString(),
    summary: {
      clients: list.length,
      // The bridge from the Admin Dashboard's owners to the clients counted here
      ownersOnRecord: record?.total ?? list.length, ownersClosed: record?.closed ?? 0, ownersTest: record?.test ?? 0,
      passwordSet: count(r => r.passwordSet), neverSignedInAll: count(r => !r.signedIn),
      // Accounts on record (the Admin Dashboard's "Total Accounts") = open + closed + test
      accountsOnRecord: record?.accounts ?? 0, accountsClosed: record?.accounts_closed ?? 0, accountsTest: record?.accounts_test ?? 0,
      accountsOpen: (record?.accounts ?? 0) - (record?.accounts_closed ?? 0) - (record?.accounts_test ?? 0),
      // Logins: one per email. A few family members share one, so there are fewer logins than clients.
      logins: rows.size, sharingLogin: list.length - rows.size,
      // Everyone whose phone is registered for alerts, on the new app or the old one
      phoneAlerts: count(r => r.notificationsOn),
      noPassword: count(r => r.status === 'no_password'), neverSignedIn: count(r => r.status === 'never_signed_in'),
      websiteOnly: count(r => r.status === 'website_only'), oldApp: count(r => r.status === 'old_app'), appNotUsed: count(r => r.status === 'app_not_used'), usingApp: count(r => r.status === 'using_app'), familyCovered: count(r => r.status === 'family_covered'),
      hasApp: count(r => r.hasApp), noApp: count(r => !r.hasApp),
      // Which phone: the four add up to hasApp (the old app did not always say which phone it was)
      iphoneOnly: count(r => r.hasApp && r.devices.length === 1 && r.devices[0] === 'iPhone'), androidOnly: count(r => r.hasApp && r.devices.length === 1 && r.devices[0] === 'Android'),
      bothPhones: count(r => r.hasApp && r.devices.length === 2), phoneUnknown: count(r => r.hasApp && !r.devices.length),
      usedToday: count(r => r.usedToday), usedTodayApp: count(r => r.usedTodayApp), used7: count(r => r.used7), used7App: count(r => r.used7App), usedPeriod: count(r => r.daysUsed > 0),
      // Phone alerts are counted for the new app: on + off = newApp
      newApp: count(isNew), alertsOn: count(r => isNew(r) && r.notificationsOn), alertsOff: count(r => isNew(r) && !r.notificationsOn), locked: count(r => r.locked),
    },
    newAppVersion: NEW_APP_VERSION,
    daily, clients: list,
    pages: [...pagePeople.entries()].map(([page, set]) => ({ page, clients: weigh(set), views: pageViews.get(page) || 0 })).sort((a, b) => b.clients - a.clients || b.views - a.views).slice(0, 20),
    // Every figure is a number of clients, so a row reads across: sent to → reached the phone → read
    notifications: [...kinds.values()].map(k => ({ key: k.key, kind: k.kind, title: k.title, sent: k.sent, lastSent: k.last, clients: weigh(k.people), reachedPhone: weigh(k.phone), inboxOnly: weigh(k.people) - weigh(k.phone), read: weigh(k.read) }))
      .sort((a, b) => b.clients - a.clients || b.sent - a.sent),
  }
}

/** One client's log, newest first: what they opened and did, sign-ins, and the notifications sent to them (last 60 days, 400 entries). */
export async function clientLog(email: string, person: Person | null, staff: [string[], string[]]) {
  if (!person) return { client: null, log: [] }
  const ids = [email, ...person.accounts.map(a => a.toLowerCase())]
  const [events, auth, notes] = await Promise.all([
    safe(async () => (await query1(
      `SELECT u.occurred_at AS at, u.event_type, u.event_name, u.platform, u.app_version, u.properties->>'title' AS title FROM ${A} u
        WHERE lower(u.user_id) = ANY($3::text[]) AND ${NOT_STAFF} AND u.occurred_at > NOW() - interval '60 days' AND u.event_name NOT IN ('app_background', 'app_foreground')
        ORDER BY u.occurred_at DESC LIMIT 400`, [...staff, ids])).rows, [] as any[]),
    safe(async () => (await query(
      `SELECT occurred_at AS at, event, reason, platform, os FROM auth_events WHERE lower(email) = $1 AND occurred_at > NOW() - interval '60 days'
        ORDER BY occurred_at DESC LIMIT 200`, [email])).rows, [] as any[]),
    safe(async () => (await query(
      `SELECT created_at AS at, category, title, body, push_status, read_at FROM app_notifications WHERE lower(email) = $1 AND created_at > NOW() - interval '60 days'
        ORDER BY created_at DESC LIMIT 200`, [email])).rows, [] as any[]),
  ])
  const log: { at: string; kind: 'opened' | 'did' | 'signin' | 'problem' | 'notification'; text: string; detail: string }[] = []
  for (const e of events) {
    const where = [DEVICE[e.platform] ?? e.platform, e.app_version && e.platform !== 'web' ? `v${e.app_version}` : ''].filter(Boolean).join(' ')
    if (e.event_type === 'screen') log.push({ at: e.at, kind: 'opened', text: `Looked at ${screenName(e.event_name)}`, detail: where })
    else if (e.event_type === 'error') log.push({ at: e.at, kind: 'problem', text: 'The app showed an error', detail: where })
    else log.push({ at: e.at, kind: 'did', text: ACTIONS[e.event_name] ?? screenName(e.event_name), detail: where })
  }
  for (const a of auth) {
    const where = DEVICE[a.os] ?? 'Website'
    if (a.event === 'login_failed') log.push({ at: a.at, kind: 'problem', text: `Could not sign in: ${FAIL[a.reason] ?? 'sign-in failed'}`, detail: where })
    else if (a.event === 'login_success') log.push({ at: a.at, kind: 'signin', text: 'Signed in', detail: where })
    else if (a.event !== 'logout') log.push({ at: a.at, kind: a.event === 'lockout' || a.event === 'otp_failed' ? 'problem' : 'signin', text: AUTH[a.event] ?? a.event, detail: where })
  }
  const R = { phone: 'reached the phone', inbox: 'in-app inbox only (no phone registered)', failed: 'could not be delivered', waiting: 'waiting to be sent' }
  for (const x of notes) log.push({ at: x.at, kind: 'notification', text: `Notification: ${x.title}`, detail: `${R[reach(x.push_status)]}${x.read_at ? ' · read' : ' · not read yet'}` })
  log.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return { client: person, log: log.slice(0, 400).map(l => ({ ...l, at: new Date(l.at).toISOString() })) }
}

/** Who got one kind of notification in the period, and whether it reached their phone and was read. */
export async function noteRecipients(key: string, since: string, byEmail: Map<string, Person>) {
  const [category, ...rest] = key.split('|'); const title = rest.join('|')
  const rows = (await query(
    `SELECT lower(email) AS email, title, ${NOTE_SUB} AS sub, created_at, push_status, read_at FROM app_notifications WHERE category = $1 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 5000`, [category])).rows
  return {
    recipients: rows.filter((r: any) => noteLabel(r.title, r.sub) === title && byEmail.has(r.email)).map((r: any) => ({
      email: r.email, name: byEmail.get(r.email)!.name, title: r.title, at: new Date(r.created_at).toISOString(), reached: reach(r.push_status), read: !!r.read_at,
    })),
  }
}

/** When each client was last sent a reminder (the 'reminder.send' rows of the admin audit log), by email. */
export async function remindedAt(): Promise<Map<string, string>> {
  const rows = await safe(async () => (await query(
    `SELECT lower(target) AS email, max(created_at) AS at FROM admin_audit_log WHERE action = 'reminder.send' GROUP BY 1`)).rows, [] as any[])
  return new Map(rows.map((r: any) => [r.email, new Date(r.at).toISOString()]))
}
