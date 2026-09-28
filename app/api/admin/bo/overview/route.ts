// GET /api/admin/bo/overview (staff): headline numbers for the backoffice home. Days are IST calendar days.
// login_events and pms_clients_master live in the main DB (lib/db); app analytics and investor queries in
// pms_clients_tracker (lib/db1). Each block degrades to empty on its own so one failing source never blanks the page.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { userCounts } from '@/lib/adminUsers'
import { query } from '@/lib/db'
import pool from '@/lib/db1'

const IST_TODAY = `(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) { console.error('[admin/bo/overview]', label, e); return fallback }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error

  const [users, logins, daily, appVersions, topScreens, errors7, recentErrors, recentLogins, openQueries] = await Promise.all([
    safe('users', userCounts, { investors: 0, distributors: 0, passwordSet: 0, needsSetup: 0, neverLoggedIn: 0, locked: 0 }),

    safe('logins', async () => {
      const r = (await query(`
        SELECT count(*) FILTER (WHERE occurred_at >= ${IST_TODAY})::int AS today,
               count(*) FILTER (WHERE occurred_at >= ${IST_TODAY} - interval '6 days')::int AS last7,
               count(*)::int AS last30,
               count(*) FILTER (WHERE platform = 'web')::int AS web30,
               count(*) FILTER (WHERE platform = 'app')::int AS app30,
               count(*) FILTER (WHERE platform = 'app' AND os = 'ios')::int AS ios30,
               count(*) FILTER (WHERE platform = 'app' AND os = 'android')::int AS android30
          FROM login_events
         WHERE occurred_at >= ${IST_TODAY} - interval '29 days'`)).rows[0]
      return { today: r.today, last7: r.last7, last30: r.last30, web30: r.web30, app30: r.app30, ios30: r.ios30, android30: r.android30 }
    }, { today: 0, last7: 0, last30: 0, web30: 0, app30: 0, ios30: 0, android30: 0 }),

    safe('daily', async () => (await query(`
      WITH days AS (
        SELECT generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 29, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day')::date AS d
      ), ev AS (
        SELECT (occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS d, platform
          FROM login_events WHERE occurred_at >= ${IST_TODAY} - interval '29 days'
      )
      SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
             count(ev.*) FILTER (WHERE ev.platform = 'web')::int AS web,
             count(ev.*) FILTER (WHERE ev.platform = 'app')::int AS app
        FROM days LEFT JOIN ev ON ev.d = days.d
       GROUP BY days.d ORDER BY days.d`)).rows, [] as any[]),

    safe('appVersions', async () => (await pool.query(`
      SELECT app_version AS version, count(DISTINCT user_id)::int AS users
        FROM pms_clients_tracker.pms_mobile_analytics
       WHERE occurred_at >= now() - interval '30 days' AND app_version IS NOT NULL AND COALESCE(platform, '') <> 'web'
       GROUP BY app_version ORDER BY users DESC LIMIT 15`)).rows, [] as any[]),

    safe('topScreens', async () => (await pool.query(`
      SELECT event_name AS name, count(*)::int AS views
        FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'screen' AND occurred_at >= now() - interval '30 days'
       GROUP BY event_name ORDER BY views DESC LIMIT 10`)).rows, [] as any[]),

    safe('errors7', async () => (await pool.query(`
      SELECT count(*)::int AS n FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'error' AND occurred_at >= now() - interval '7 days'`)).rows[0]?.n ?? 0, 0),

    safe('recentErrors', async () => (await pool.query(`
      SELECT event_name AS name,
             (array_agg(COALESCE(properties->>'message', properties->>'error', properties->>'endpoint') ORDER BY occurred_at DESC)
               FILTER (WHERE COALESCE(properties->>'message', properties->>'error', properties->>'endpoint') IS NOT NULL))[1] AS message,
             count(*)::int AS count, max(occurred_at) AS "lastAt"
        FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'error' AND occurred_at >= now() - interval '7 days'
       GROUP BY event_name ORDER BY "lastAt" DESC LIMIT 10`)).rows, [] as any[]),

    safe('recentLogins', async () => (await query(`
      SELECT e.email, e.platform, e.os, e.occurred_at AS at,
             (SELECT COALESCE(NULLIF(trim(concat_ws(' ', m.salutation, m.firstname, m.middlename, m.lastname)), ''), m.clientname)
                FROM pms_clients_master m
               WHERE lower(trim(m.email)) = lower(trim(e.email))
               ORDER BY m.head_of_family DESC NULLS LAST, m.clientcode ASC NULLS LAST LIMIT 1) AS name
        FROM login_events e
       ORDER BY e.occurred_at DESC LIMIT 20`)).rows.map((r: any) => ({ email: r.email, name: r.name ?? null, platform: r.platform, os: r.os ?? null, at: r.at })), [] as any[]),

    safe('openQueries', async () => (await pool.query(`
      SELECT count(*)::int AS n FROM pms_clients_tracker.qode_microsite_inquiries
       WHERE COALESCE(status, 'pending') NOT IN ('resolved', 'closed')`)).rows[0]?.n ?? 0, 0),
  ])

  return NextResponse.json({ users, logins, daily, appVersions, topScreens, errors7, recentErrors, recentLogins, openQueries })
}
