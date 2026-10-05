// GET /api/admin/bo/analytics?from=yyyy-mm-dd&to=yyyy-mm-dd (staff): everything the App analytics page shows, for
// one period (IST days, both inclusive; default the last 30 days). Sources:
//   main db  pms_clients_master (accounts, password setups, first logins), login_events (successful sign-ins),
//            auth_events (every sign-in attempt, OTP, password step — from its rollout), app_notifications,
//            app_push_devices
//   db1      pms_clients_tracker.pms_mobile_analytics (screens, sessions, device info, key actions, errors)
// Every section degrades to null/empty on its own, so one missing table never blanks the page.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { query } from '@/lib/db'
import { query as query1 } from '@/lib/db1'

export const dynamic = 'force-dynamic'

const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const shift = (d: string, days: number) => new Date(Date.parse(d + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
const n = (v: unknown) => Number(v) || 0
const exists = async (q: typeof query, rel: string) => { try { return !!(await q(`SELECT to_regclass($1) AS t`, [rel])).rows[0]?.t } catch { return false } }
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch (e) { console.error('[bo/analytics]', (e as Error).message); return fallback } }
// IST day of a timestamptz column, and the period filter on it
const DAY = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`
const IN = (col: string) => `${col} >= ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`
const A = 'pms_clients_tracker.pms_mobile_analytics'   // admin sessions (user_id 'a:…') are left out of every usage figure

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  const sp = req.nextUrl.searchParams
  const to = isDate(sp.get('to')) || istToday()
  const from = isDate(sp.get('from')) || shift(to, -29)
  const P = [from, to]

  const [hasAuth, hasNotes, hasDevices] = await Promise.all([exists(query, 'public.auth_events'), exists(query, 'public.app_notifications'), exists(query, 'public.app_push_devices')])

  // ── accounts and the activation funnel (lifetime) ─────────────────────────────────────────────────────────────
  const accounts = await safe(async () => (await query(
    `WITH p AS (
       -- Funnel steps are nested: a password exists for anyone who has ever signed in (password_set_at is only
       -- recorded by the newer setup flow, so older passwords count from the password column itself), and every
       -- app user has signed in.
       SELECT lower(trim(email)) AS email,
              bool_or(password_set_at IS NOT NULL OR coalesce(password, '') NOT IN ('', 'Qode@123')
                      OR first_login_at IS NOT NULL OR last_login_at IS NOT NULL OR first_app_login_at IS NOT NULL OR first_web_login_at IS NOT NULL) AS pw,
              bool_or(first_login_at IS NOT NULL OR last_login_at IS NOT NULL OR first_app_login_at IS NOT NULL OR last_app_login_at IS NOT NULL
                      OR first_web_login_at IS NOT NULL OR last_web_login_at IS NOT NULL) AS any_login,
              bool_or(first_app_login_at IS NOT NULL OR last_app_login_at IS NOT NULL) AS app, bool_or(first_web_login_at IS NOT NULL OR last_web_login_at IS NOT NULL) AS web,
              bool_or(last_app_login_at > NOW() - interval '30 days') AS app_30d,
              bool_or(last_ios_login_at IS NOT NULL) AS ios, bool_or(last_android_login_at IS NOT NULL) AS android,
              max(greatest(coalesce(last_app_login_at, 'epoch'), coalesce(last_web_login_at, 'epoch'), coalesce(last_login_at::timestamptz, 'epoch'))) AS last_seen,
              bool_or(locked_until > NOW()) AS locked,
              min(password_set_at) AS pw_at, min(first_app_login_at) AS app_at
         FROM pms_clients_master
        WHERE clientcode IS NOT NULL AND coalesce(trim(email), '') <> '' AND (maturity_date IS NULL OR maturity_date > NOW())
        GROUP BY 1)
     SELECT count(*)::int AS investors, count(*) FILTER (WHERE pw)::int AS password_set, count(*) FILTER (WHERE any_login)::int AS ever_signed_in,
            count(*) FILTER (WHERE app)::int AS app_users, count(*) FILTER (WHERE web)::int AS web_users,
            count(*) FILTER (WHERE ios)::int AS ios_users, count(*) FILTER (WHERE android)::int AS android_users,
            count(*) FILTER (WHERE last_seen > NOW() - interval '30 days')::int AS active_30d, count(*) FILTER (WHERE app_30d)::int AS app_active_30d,
            count(*) FILTER (WHERE locked)::int AS locked_now,
            count(*) FILTER (WHERE ${IN('pw_at')})::int AS new_password_setups, count(*) FILTER (WHERE ${IN('app_at')})::int AS new_app_users
       FROM p`, P)).rows[0], null)

  // ── sign-ins (login_events: successful, since 21 Jul 2026) ─────────────────────────────────────────────────────
  const logins = await safe(async () => {
    const chan = `CASE WHEN platform = 'web' THEN 'web' WHEN os = 'ios' THEN 'ios' WHEN os = 'android' THEN 'android' ELSE 'app' END`
    const [daily, totals, rolling, hours] = await Promise.all([
      query(`SELECT ${DAY('occurred_at')} AS d, ${chan} AS c, count(DISTINCT lower(email))::int AS users, count(*)::int AS logins
               FROM login_events WHERE ${IN('occurred_at')} GROUP BY 1, 2 ORDER BY 1`, P),
      query(`SELECT count(*)::int AS logins, count(DISTINCT lower(email))::int AS users,
                    count(DISTINCT lower(email)) FILTER (WHERE platform = 'web')::int AS web_users,
                    count(DISTINCT lower(email)) FILTER (WHERE platform = 'app')::int AS app_users
               FROM login_events WHERE ${IN('occurred_at')}`, P),
      query(`SELECT count(DISTINCT lower(email)) FILTER (WHERE occurred_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata')::int AS dau,
                    count(DISTINCT lower(email)) FILTER (WHERE occurred_at >= ($1::date - 6)::timestamp AT TIME ZONE 'Asia/Kolkata')::int AS wau,
                    count(DISTINCT lower(email)) FILTER (WHERE occurred_at >= ($1::date - 29)::timestamp AT TIME ZONE 'Asia/Kolkata')::int AS mau
               FROM login_events WHERE occurred_at < ($1::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`, [to]),
      query(`SELECT extract(hour FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS h, count(*)::int AS logins
               FROM login_events WHERE ${IN('occurred_at')} GROUP BY 1 ORDER BY 1`, P),
    ])
    const byDay = new Map<string, any>()
    for (let d = from; d <= to; d = shift(d, 1)) byDay.set(d, { date: d, web: 0, ios: 0, android: 0, app: 0, users: 0, logins: 0 })
    for (const r of daily.rows) { const o = byDay.get(r.d); if (o) { o[r.c] += r.users; o.logins += r.logins } }
    const uniq = await query(`SELECT ${DAY('occurred_at')} AS d, count(DISTINCT lower(email))::int AS u FROM login_events WHERE ${IN('occurred_at')} GROUP BY 1`, P)
    for (const r of uniq.rows) { const o = byDay.get(r.d); if (o) o.users = r.u }
    const days = [...byDay.values()]
    return { ...totals.rows[0], ...rolling.rows[0], avgDailyUsers: days.length ? Math.round((days.reduce((t, x) => t + x.users, 0) / days.length) * 10) / 10 : 0,
      daily: days, byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, logins: n(hours.rows.find((x: any) => x.h === h)?.logins) })) }
  }, null)

  // ── retention: weekly cohorts by first sign-in in login_events ────────────────────────────────────────────────
  const retention = await safe(async () => (await query(
    `WITH ev AS (SELECT lower(email) AS e, (occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS d FROM login_events),
          first AS (SELECT e, min(d) AS f FROM ev GROUP BY e),
          c AS (SELECT f.e, date_trunc('week', f.f)::date AS cohort, f.f FROM first f WHERE f.f > (CURRENT_DATE - 70))
     SELECT to_char(c.cohort, 'YYYY-MM-DD') AS cohort, count(DISTINCT c.e)::int AS users,
            count(DISTINCT c.e) FILTER (WHERE EXISTS (SELECT 1 FROM ev WHERE ev.e = c.e AND ev.d BETWEEN c.f + 1 AND c.f + 7))::int AS w1,
            count(DISTINCT c.e) FILTER (WHERE EXISTS (SELECT 1 FROM ev WHERE ev.e = c.e AND ev.d BETWEEN c.f + 8 AND c.f + 14))::int AS w2,
            count(DISTINCT c.e) FILTER (WHERE EXISTS (SELECT 1 FROM ev WHERE ev.e = c.e AND ev.d BETWEEN c.f + 15 AND c.f + 30))::int AS m1,
            (CURRENT_DATE - max(c.f))::int AS age
       FROM c GROUP BY c.cohort ORDER BY c.cohort`)).rows, [])

  // ── auth health (auth_events, from its rollout) ────────────────────────────────────────────────────────────────
  const auth = !hasAuth ? null : await safe(async () => {
    const [byEvent, byReason, daily, since] = await Promise.all([
      query(`SELECT event, count(*)::int AS n, count(DISTINCT email)::int AS people FROM auth_events WHERE ${IN('occurred_at')} GROUP BY 1 ORDER BY 2 DESC`, P),
      query(`SELECT platform, coalesce(reason, 'other') AS reason, count(*)::int AS n FROM auth_events WHERE event = 'login_failed' AND ${IN('occurred_at')} GROUP BY 1, 2 ORDER BY 3 DESC`, P),
      query(`SELECT ${DAY('occurred_at')} AS d, count(*) FILTER (WHERE event = 'login_success')::int AS ok, count(*) FILTER (WHERE event = 'login_failed')::int AS failed,
                    count(*) FILTER (WHERE event = 'lockout')::int AS lockouts FROM auth_events WHERE ${IN('occurred_at')} GROUP BY 1 ORDER BY 1`, P),
      query(`SELECT to_char(min(occurred_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS since FROM auth_events`),
    ])
    const resets = await query(`SELECT count(*)::int AS requested, count(*) FILTER (WHERE used)::int AS completed,
                                       count(*) FILTER (WHERE NOT used AND expires_at < NOW())::int AS expired
                                  FROM password_reset_tokens WHERE ${IN('created_at')}`, P).then(r => r.rows[0]).catch(() => null)
    const ev = Object.fromEntries(byEvent.rows.map((r: any) => [r.event, r]))
    const ok = n(ev.login_success?.n), failed = n(ev.login_failed?.n)
    return { since: since.rows[0]?.since || null, byEvent: byEvent.rows, failedByReason: byReason.rows, daily: daily.rows,
      successRate: ok + failed ? Math.round((ok / (ok + failed)) * 1000) / 10 : null,
      otp: { sent: n(ev.otp_sent?.n), verified: n(ev.otp_verified?.n), failed: n(ev.otp_failed?.n) },
      // resets: from password_reset_tokens (a used link = a completed reset), not from auth_events, which only logs
      // requests since 29 Sep 2026 and never sees resets finished on the old site
      passwords: { set: n(ev.password_set?.n), resetRequested: resets ? n(resets.requested) : n(ev.password_reset_requested?.n),
                   resetCompleted: resets ? n(resets.completed) : n(ev.password_reset_completed?.n), resetExpired: resets ? n(resets.expired) : null,
                   changed: n(ev.password_changed?.n) } }
  }, null)

  // ── app usage (db1 analytics events) ───────────────────────────────────────────────────────────────────────────
  const usage = await safe(async () => {
    const [sessions, sessionDaily, screens, screenTime, features, errors, dailyUsers] = await Promise.all([
      // Length is only measurable when a session has 2+ events: a one-screen visit (common on the web portal, which
      // records page views only) has no end time, so it is counted separately instead of as "0 seconds".
      query1(`WITH s AS (SELECT session_id, min(platform) AS platform, count(*) FILTER (WHERE event_type = 'screen')::int AS screens, count(*)::int AS events,
                                least(extract(epoch FROM max(occurred_at) - min(occurred_at)), 7200) AS secs
                           FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND ${IN('occurred_at')} AND session_id IS NOT NULL GROUP BY session_id)
              SELECT platform, count(*)::int AS sessions,
                     count(*) FILTER (WHERE events = 1)::int AS single_event,
                     round(avg(secs) FILTER (WHERE events > 1))::int AS avg_secs,
                     round(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE events > 1))::int AS median_secs,
                     round(avg(screens), 1)::float AS screens_per_session
                FROM s GROUP BY platform ORDER BY 2 DESC`, P),
      query1(`SELECT ${DAY('occurred_at')} AS d, platform, count(DISTINCT user_id)::int AS users, count(DISTINCT session_id)::int AS sessions
                FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND ${IN('occurred_at')} GROUP BY 1, 2 ORDER BY 1`, P),
      query1(`SELECT event_name AS screen, count(*)::int AS views, count(DISTINCT user_id)::int AS users,
                     count(*) FILTER (WHERE platform = 'web')::int AS web, count(*) FILTER (WHERE platform = 'ios')::int AS ios,
                     count(*) FILTER (WHERE platform = 'android')::int AS android
                FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND event_type = 'screen' AND ${IN('occurred_at')} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, P),
      query1(`SELECT properties->>'prev' AS screen, round(avg(least((properties->>'prev_seconds')::numeric, 1800)))::int AS avg_secs
                FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND event_type = 'screen' AND properties ? 'prev_seconds' AND ${IN('occurred_at')} GROUP BY 1`, P),
      query1(`SELECT event_name AS name, count(*)::int AS n, count(DISTINCT user_id)::int AS users
                FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND event_type = 'event' AND event_name NOT IN ('session_start', 'app_background', 'app_foreground') AND ${IN('occurred_at')}
               GROUP BY 1 ORDER BY 2 DESC LIMIT 30`, P),
      query1(`SELECT event_name AS name, platform, count(*)::int AS n, max(occurred_at) AS last FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND event_type = 'error' AND ${IN('occurred_at')}
               GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`, P),
      query1(`SELECT count(DISTINCT user_id)::int AS users, count(DISTINCT session_id)::int AS sessions, count(*) FILTER (WHERE event_type = 'screen')::int AS views
                FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND ${IN('occurred_at')}`, P),
    ])
    const t = new Map(screenTime.rows.map((r: any) => [r.screen, r.avg_secs]))
    const byDay = new Map<string, any>()
    for (let d = from; d <= to; d = shift(d, 1)) byDay.set(d, { date: d, web: 0, ios: 0, android: 0, sessions: 0 })
    for (const r of sessionDaily.rows) { const o = byDay.get(r.d); if (o && (r.platform in o)) { o[r.platform] += r.users; o.sessions += r.sessions } }
    return { totals: dailyUsers.rows[0], sessions: sessions.rows, daily: [...byDay.values()],
      screens: screens.rows.map((r: any) => ({ ...r, avg_secs: t.get(r.screen) ?? null })), features: features.rows, errors: errors.rows }
  }, null)

  // ── devices (session_start events from the new app builds; registered phones) ─────────────────────────────────
  const devices = await safe(async () => {
    const pick = (field: string) => query1(
      `SELECT coalesce(nullif(properties->>'${field}', ''), 'Unknown') AS k, count(DISTINCT user_id)::int AS users, count(*)::int AS sessions
         FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND event_type = 'event' AND event_name = 'session_start' AND ${IN('occurred_at')} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, P)
    const osVer = query1(
      `SELECT platform || ' ' || coalesce(properties->>'osVersion', '?') AS k, count(DISTINCT user_id)::int AS users
         FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND event_type = 'event' AND event_name = 'session_start' AND ${IN('occurred_at')} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, P)
    const appVer = query1(
      `SELECT platform || ' ' || coalesce(app_version, '?') AS k, count(DISTINCT user_id)::int AS users
         FROM ${A} WHERE coalesce(user_id, '') NOT LIKE 'a:%' AND platform IN ('ios', 'android') AND ${IN('occurred_at')} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, P)
    const [models, types, modes, os, apps] = await Promise.all([pick('deviceModel'), pick('deviceType'), pick('mode'), osVer, appVer])
    const push = hasDevices ? (await query(`SELECT platform, count(*) FILTER (WHERE is_active)::int AS active FROM app_push_devices GROUP BY 1`)).rows : []
    return { models: models.rows, types: types.rows, modes: modes.rows, osVersions: os.rows, appVersions: apps.rows, pushRegistered: push }
  }, null)

  // ── notifications ──────────────────────────────────────────────────────────────────────────────────────────────
  const notifications = !hasNotes ? null : await safe(async () => (await query(
    `SELECT category, count(*)::int AS sent, count(*) FILTER (WHERE push_status IN ('delivered', 'unconfirmed'))::int AS delivered,
            count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read, count(*) FILTER (WHERE push_status = 'no_device')::int AS inbox_only,
            count(*) FILTER (WHERE push_status = 'failed')::int AS failed
       FROM app_notifications WHERE ${IN('created_at')} GROUP BY 1 ORDER BY 2 DESC`, P)).rows, null)

  // ── downloads: store connections (the existing App Store / Play endpoints need these settings) ─────────────────
  const need = (keys: string[]) => keys.filter(k => !process.env[k])
  const downloads = {
    appStore: { endpoint: '/api/admin/app-store-analytics', missing: need(['APP_STORE_ISSUER_ID', 'APP_STORE_KEY_ID', 'APP_STORE_PRIVATE_KEY', 'APP_STORE_VENDOR_NUMBER']) },
    playStore: { endpoint: '/api/admin/play-store-analytics', missing: need(['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_REPORT_BUCKET', 'GOOGLE_PLAY_SERVICE_ACCOUNT_KEY']) },
  }

  return NextResponse.json({
    period: { from, to }, generatedAt: new Date().toISOString(),
    sources: { loginEventsSince: '2026-07-21', authEventsSince: auth?.since ?? null, screenTrackingSince: { web: '2026-07-21', ios: '2026-09-22', android: '2026-09-21' } },
    accounts, logins, retention, auth, usage, devices, notifications, downloads,
  })
}
