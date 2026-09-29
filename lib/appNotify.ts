// myQode app notifications: the in-app inbox (the bell) and device popups (Expo push). No email, ever.
//
// How a notification travels (tables: database/migrations/006_app_notifications.sql):
//   1. notifyEmails() writes one app_notifications row per login FIRST. The inbox is the source of truth: whatever
//      happens to the popup, the client sees it under the bell the next time the app opens.
//      (email, dedupe_key) is unique, so a trigger that fires twice still reaches a login once.
//   2. deliverDue() claims due rows, sends them to every active device of the login through Expo, and keeps
//      Expo's tickets. Network errors, Expo 5xx/429 and rate limits retry with backoff (8 attempts over ~1 day).
//      Rows claimed by a process that died mid-send go back to pending after 10 minutes (at-least-once).
//   3. checkReceipts() asks Expo, 15 minutes later, whether Apple/Google took each message. Dead devices are
//      retired (DeviceNotRegistered); transient receipt errors resend.
//   Popups never go out between 21:00 and 09:00 IST except for money; a popup older than 3 days is not sent
//   (it stays in the inbox).
//
// Who gets what before launch: every client gets the in-app entry (the bell) at once; the popup on the phone goes out
// only once PUSH_LIVE=1 (before that only to PUSH_TEST_EMAILS, default sanket.shinde@qodeinvest.com). Held rows are
// never pushed later.
import { query } from '@/lib/db'

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts'
const MAX_ATTEMPTS = 8
const BACKOFF_MIN = [1, 5, 15, 30, 60, 180, 360, 720]   // minutes before attempt n+1
const STALE_DAYS = 3

export type Category = 'money' | 'portfolio' | 'reading' | 'updates'
export const CATEGORIES: Category[] = ['money', 'portfolio', 'reading', 'updates']
export type Note = { category: Category; title: string; body: string; link?: string | null; data?: Record<string, unknown>; dedupeKey: string; campaignId?: number | null; at?: Date | string | null }

const lower = (e: unknown) => String(e || '').trim().toLowerCase()
export const pushLive = () => process.env.PUSH_LIVE === '1'
export const testEmails = () => (process.env.PUSH_TEST_EMAILS || 'sanket.shinde@qodeinvest.com').split(',').map(lower).filter(Boolean)
export const mayNotify = (email: string) => pushLive() || testEmails().includes(lower(email))

// ── tables ────────────────────────────────────────────────────────────────────────────────────────────────────
let ready = false
/** True once the migration has run. Every entry point checks it, so the code is inert until then. */
export async function tablesReady(): Promise<boolean> {
  if (ready) return true
  try {
    const r = await query(`SELECT to_regclass('public.app_notifications') AS n, to_regclass('public.app_push_devices') AS d,
                                  to_regclass('public.app_notification_state') AS s`)
    ready = !!(r.rows[0]?.n && r.rows[0]?.d && r.rows[0]?.s)
  } catch { ready = false }
  return ready
}

export async function getState(key: string): Promise<string | null> {
  const r = await query(`SELECT value FROM app_notification_state WHERE key = $1`, [key])
  return r.rows[0]?.value ?? null
}
export async function setState(key: string, value: string) {
  await query(`INSERT INTO app_notification_state (key, value, updated_at) VALUES ($1, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, value])
}

// ── recipients ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Logins that can see these accounts, by the same rule sign-in uses (lib/mobileSession.ts): the account's own
 * email, and the head of family of its group. Codes may be strategy accounts (QAW00032) or owner ids as the NAV
 * sheet writes them (70313, i.e. ownerid "70313.0"). Closed accounts are left out.
 */
export async function recipientsForAccounts(codes: string[]): Promise<string[]> {
  const list = [...new Set(codes.map(c => String(c || '').trim()).filter(Boolean))]
  if (!list.length) return []
  const r = await query(
    `SELECT DISTINCT lower(trim(x.email)) AS email
       FROM pms_clients_master m
       JOIN pms_clients_master x
         ON x.clientcode = m.clientcode OR x.email = m.email
         OR (x.head_of_family AND m.groupid IS NOT NULL AND x.groupid = m.groupid)
      WHERE (m.clientcode = ANY($1) OR regexp_replace(m.ownerid, '\\.0$', '') = ANY($1))
        AND (m.maturity_date IS NULL OR m.maturity_date > NOW())
        AND (x.maturity_date IS NULL OR x.maturity_date > NOW())
        AND coalesce(trim(x.email), '') <> ''`, [list])
  return r.rows.map((x: any) => x.email)
}

/** Everyone who uses the app: signed in to it at least once, or has a device registered. */
export async function appAudience(strategy?: string | null): Promise<string[]> {
  const r = strategy
    ? await query(
      `SELECT DISTINCT lower(trim(email)) AS email FROM pms_clients_master
        WHERE first_app_login_at IS NOT NULL AND coalesce(trim(email), '') <> ''
          AND (maturity_date IS NULL OR maturity_date > NOW()) AND schemename = $1`, [strategy])
    : await query(
      `SELECT lower(trim(email)) AS email FROM pms_clients_master
        WHERE first_app_login_at IS NOT NULL AND coalesce(trim(email), '') <> '' AND (maturity_date IS NULL OR maturity_date > NOW())
       UNION SELECT email FROM app_push_devices WHERE is_active`)
  return [...new Set(r.rows.map((x: any) => x.email as string))]
}

// ── enqueue ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Writes the notification to each login's inbox and queues the popup. Returns how many NEW rows were written
 * (a dedupe hit writes nothing). `force` skips the PUSH_LIVE gate (an admin's test send to themselves).
 */
export async function notifyEmails(emails: string[], n: Note, opts: { force?: boolean } = {}): Promise<number> {
  if (!(await tablesReady())) return 0
  // Everyone gets the entry in their in-app panel (the bell). The popup goes out only while PUSH_LIVE=1 (or to the
  // test list, or when forced by an admin action); otherwise the row is 'held': in the inbox, never pushed.
  const to = [...new Set(emails.map(lower).filter(Boolean))]
  if (!to.length) return 0
  const statuses = to.map(e => (opts.force || mayNotify(e) ? 'pending' : 'held'))
  const title = String(n.title).trim().slice(0, 90)
  const body = String(n.body).trim().slice(0, 300)
  const r = await query(
    `INSERT INTO app_notifications (email, category, title, body, link, data, dedupe_key, campaign_id, push_status, created_at)
     SELECT t.e, $2, $3, $4, $5, $6::jsonb, $7, $8, t.st, coalesce($10::timestamptz, NOW()) FROM unnest($1::text[], $9::text[]) AS t(e, st)
     ON CONFLICT (email, dedupe_key) DO NOTHING RETURNING id, push_status`,
    [to, n.category, title, body, n.link || null, JSON.stringify(n.data || {}), n.dedupeKey, n.campaignId || null, statuses, n.at ? new Date(n.at).toISOString() : null])
  if (r.rows.some((x: any) => x.push_status === 'pending')) setImmediate(() => { deliverDue().catch(e => console.error('[appNotify] deliver', e?.message)) })
  return r.rowCount || 0
}

export const notifyAccounts = async (codes: string[], n: Note) => notifyEmails(await recipientsForAccounts(codes), n)

// ── delivery ──────────────────────────────────────────────────────────────────────────────────────────────────
const expoHeaders = () => ({
  'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate',
  ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
})

/** Next 09:00 IST, for popups that would otherwise arrive at night. Null when it is daytime in India now. */
function quietUntil(now = new Date()): Date | null {
  const ist = new Date(now.getTime() + 330 * 60000)
  const h = ist.getUTCHours()
  if (h >= 9 && h < 21) return null
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (h >= 21 ? 1 : 0), 9, 0) - 330 * 60000)
  return next
}

const retryAt = (attempts: number) => new Date(Date.now() + BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)] * 60000)

let delivering = false
/** Sends every due popup. Safe to call from anywhere, any number of times, from any number of processes. */
export async function deliverDue(): Promise<{ sent: number; retried: number; failed: number; skipped: number }> {
  const out = { sent: 0, retried: 0, failed: 0, skipped: 0 }
  if (delivering || !(await tablesReady())) return out
  delivering = true
  try {
    for (let round = 0; round < 20; round++) {
      // Claim a batch atomically: other processes skip locked rows, and the claim is committed before sending.
      const claimed = (await query(
        `UPDATE app_notifications SET push_status = 'sending', push_attempts = push_attempts + 1, push_next_at = NOW()
          WHERE id IN (SELECT id FROM app_notifications WHERE push_status = 'pending' AND push_next_at <= NOW()
                        ORDER BY id LIMIT 300 FOR UPDATE SKIP LOCKED)
          RETURNING id, email, category, title, body, link, created_at, push_attempts`)).rows
      if (!claimed.length) break
      await sendBatch(claimed, out)
      if (claimed.length < 300) break
    }
  } finally { delivering = false }
  return out
}

async function finish(id: number, status: string, extra: { error?: string | null; tickets?: unknown; nextAt?: Date } = {}) {
  await query(
    `UPDATE app_notifications SET push_status = $2, push_error = $3, push_tickets = COALESCE($4::jsonb, push_tickets),
            push_next_at = COALESCE($5, push_next_at), pushed_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE pushed_at END
      WHERE id = $1`,
    [id, status, extra.error ?? null, extra.tickets ? JSON.stringify(extra.tickets) : null, extra.nextAt ?? null])
}

async function sendBatch(rows: any[], out: { sent: number; retried: number; failed: number; skipped: number }) {
  const emails = [...new Set(rows.map(r => r.email as string))]
  const [prefsR, devR, unreadR] = await Promise.all([
    query(`SELECT email, portfolio, reading, updates FROM app_notification_prefs WHERE email = ANY($1)`, [emails]),
    query(`SELECT email, push_token FROM app_push_devices WHERE is_active AND email = ANY($1)`, [emails]),
    query(`SELECT email, count(*)::int AS n FROM app_notifications WHERE read_at IS NULL AND email = ANY($1) GROUP BY email`, [emails]),
  ])
  const prefs = new Map(prefsR.rows.map((p: any) => [p.email, p]))
  const devices = new Map<string, string[]>()
  for (const d of devR.rows) devices.set(d.email, [...(devices.get(d.email) || []), d.push_token])
  const unread = new Map(unreadR.rows.map((u: any) => [u.email, u.n]))
  const quiet = quietUntil()

  // One Expo message per device; remember which row each message belongs to.
  const msgs: { row: any; token: string; msg: any }[] = []
  for (const r of rows) {
    const p: any = prefs.get(r.email)
    if (r.category !== 'money' && p && p[r.category] === false) { await finish(r.id, 'muted'); out.skipped++; continue }
    if (Date.now() - new Date(r.created_at).getTime() > STALE_DAYS * 86400000) { await finish(r.id, 'expired'); out.skipped++; continue }
    if (quiet && r.category !== 'money') {
      await query(`UPDATE app_notifications SET push_status = 'pending', push_attempts = push_attempts - 1, push_next_at = $2 WHERE id = $1`, [r.id, quiet])
      continue
    }
    const tokens = devices.get(r.email) || []
    if (!tokens.length) { await finish(r.id, 'no_device'); out.skipped++; continue }
    for (const token of tokens) {
      msgs.push({ row: r, token, msg: {
        to: token, title: r.title, body: r.body, sound: 'default', priority: 'high', channelId: 'default',
        badge: unread.get(r.email) || 1, data: { notificationId: String(r.id), link: r.link || '', category: r.category },
      } })
    }
  }
  if (!msgs.length) return

  // Per row: tickets that Expo accepted, whether any message hit a retryable error, the last error seen.
  const state = new Map<number, { tickets: { id: string; token: string }[]; retry: boolean; error: string | null; row: any }>()
  const st = (row: any) => { let s = state.get(row.id); if (!s) state.set(row.id, s = { tickets: [], retry: false, error: null, row }); return s }
  const dead: string[] = []

  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100)
    let res: any = null, httpErr: string | null = null
    try {
      const resp = await fetch(EXPO_SEND, { method: 'POST', headers: expoHeaders(), body: JSON.stringify(chunk.map(m => m.msg)), signal: AbortSignal.timeout(30000) })
      if (resp.ok) res = await resp.json()
      else httpErr = `Expo ${resp.status}: ${(await resp.text()).slice(0, 300)}`
    } catch (e: any) { httpErr = `Expo unreachable: ${e?.message || e}` }
    if (!res) {
      for (const m of chunk) { const s = st(m.row); s.retry = true; s.error = httpErr }
      continue
    }
    const tickets: any[] = res.data || []
    chunk.forEach((m, k) => {
      const t = tickets[k], s = st(m.row)
      if (t?.status === 'ok' && t.id) s.tickets.push({ id: t.id, token: m.token })
      else if (t?.details?.error === 'DeviceNotRegistered') { dead.push(m.token); s.error = 'DeviceNotRegistered' }
      else if (t?.details?.error === 'MessageRateExceeded' || !t) { s.retry = true; s.error = t?.message || 'no ticket' }
      else s.error = t?.message || t?.details?.error || 'rejected'
    })
  }

  if (dead.length) await query(`UPDATE app_push_devices SET is_active = FALSE, last_error = 'DeviceNotRegistered', updated_at = NOW() WHERE push_token = ANY($1)`, [dead])

  for (const s of state.values()) {
    if (s.tickets.length) {
      // At least one device took it. Receipts are checked in 15 minutes.
      await finish(s.row.id, 'sent', { tickets: s.tickets, error: s.error, nextAt: new Date(Date.now() + 15 * 60000) }); out.sent++
    } else if (s.retry && s.row.push_attempts < MAX_ATTEMPTS) {
      await query(`UPDATE app_notifications SET push_status = 'pending', push_error = $2, push_next_at = $3 WHERE id = $1`, [s.row.id, s.error, retryAt(s.row.push_attempts)]); out.retried++
    } else if (s.error === 'DeviceNotRegistered') {
      await finish(s.row.id, 'no_device', { error: s.error }); out.skipped++
    } else {
      await finish(s.row.id, 'failed', { error: s.error }); out.failed++
    }
  }
}

/** Confirms with Expo that Apple/Google accepted each sent popup; retires dead devices, resends transient failures. */
export async function checkReceipts(): Promise<{ delivered: number; resent: number; failed: number }> {
  const out = { delivered: 0, resent: 0, failed: 0 }
  if (!(await tablesReady())) return out
  // Crash recovery: a row left 'sending' for 10 minutes was never finished. Send it again.
  await query(`UPDATE app_notifications SET push_status = 'pending' WHERE push_status = 'sending' AND push_next_at < NOW() - interval '10 minutes'`)

  const rows = (await query(
    `SELECT id, push_tickets, push_attempts, pushed_at FROM app_notifications
      WHERE push_status = 'sent' AND push_next_at <= NOW() ORDER BY id LIMIT 900`)).rows
  if (!rows.length) return out
  const ids = rows.flatMap((r: any) => (r.push_tickets || []).map((t: any) => t.id))
  const receipts: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 900) {
    try {
      const resp = await fetch(EXPO_RECEIPTS, { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids: ids.slice(i, i + 900) }), signal: AbortSignal.timeout(30000) })
      if (!resp.ok) return out   // try the whole lot again next round
      Object.assign(receipts, (await resp.json()).data || {})
    } catch { return out }
  }
  const dead: string[] = []
  for (const r of rows) {
    const tickets: { id: string; token: string }[] = r.push_tickets || []
    let ok = 0, missing = 0, retry = false, err: string | null = null
    for (const t of tickets) {
      const rc = receipts[t.id]
      if (!rc) { missing++; continue }
      if (rc.status === 'ok') { ok++; continue }
      err = rc.details?.error || rc.message || 'error'
      if (err === 'DeviceNotRegistered') dead.push(t.token)
      else if (err === 'MessageRateExceeded' || err === 'ProviderError') retry = true
    }
    if (ok) { await finish(r.id, 'delivered'); out.delivered++ }
    else if (missing && Date.now() - new Date(r.pushed_at).getTime() < 6 * 3600000) {
      await query(`UPDATE app_notifications SET push_next_at = NOW() + interval '15 minutes' WHERE id = $1`, [r.id])
    } else if (missing) { await finish(r.id, 'unconfirmed'); out.delivered++ }
    else if (retry && r.push_attempts < MAX_ATTEMPTS) {
      await query(`UPDATE app_notifications SET push_status = 'pending', push_error = $2, push_next_at = $3 WHERE id = $1`, [r.id, err, retryAt(r.push_attempts)]); out.resent++
    } else { await finish(r.id, err === 'DeviceNotRegistered' ? 'no_device' : 'failed', { error: err }); out.failed++ }
  }
  if (dead.length) await query(`UPDATE app_push_devices SET is_active = FALSE, last_error = 'DeviceNotRegistered', updated_at = NOW() WHERE push_token = ANY($1)`, [dead])
  return out
}

// ── devices ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function registerDevice(email: string, token: string, platform: string | null, appVersion: string | null) {
  if (!(await tablesReady())) return
  // A device belongs to whoever signed in on it last: a new login on the same phone takes the token over.
  await query(
    `INSERT INTO app_push_devices (email, push_token, platform, app_version) VALUES ($1, $2, $3, $4)
     ON CONFLICT (push_token) DO UPDATE SET email = EXCLUDED.email, platform = COALESCE(EXCLUDED.platform, app_push_devices.platform),
       app_version = COALESCE(EXCLUDED.app_version, app_push_devices.app_version), is_active = TRUE, last_error = NULL, updated_at = NOW()`,
    [lower(email), token, platform, appVersion])
}
export async function unregisterDevice(token: string) {
  if (!(await tablesReady())) return
  await query(`UPDATE app_push_devices SET is_active = FALSE, updated_at = NOW() WHERE push_token = $1`, [token])
}

