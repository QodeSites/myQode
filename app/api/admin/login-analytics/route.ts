// Platform-wise login breakdown, sourced from pms_clients_master.
//
// web_login_count / app_login_count / last_web_login_at / last_app_login_at
// are populated by /api/auth/login (web) and /api/mobile/auth/login (mobile)
// respectively — see database/migrations/002_platform_login_tracking.sql.
//
// This answers "how many distinct people have logged in via the app vs the
// web version" (count of clients with count > 0), plus total login volume
// per platform and recent activity within the requested window.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30'), 1), 365)

  try {
    const totals = await query(
      `SELECT
         COUNT(*) FILTER (WHERE web_login_count > 0)              AS web_users,
         COUNT(*) FILTER (WHERE app_login_count > 0)               AS app_users,
         COUNT(*) FILTER (WHERE web_login_count > 0 AND app_login_count > 0) AS both_users,
         COALESCE(SUM(web_login_count), 0)                        AS web_logins_total,
         COALESCE(SUM(app_login_count), 0)                         AS app_logins_total
       FROM pms_clients_master`
    )

    const recentlyActive = await query(
      `SELECT
         COUNT(*) FILTER (WHERE last_web_login_at >= NOW() - INTERVAL '${days} days') AS web_active,
         COUNT(*) FILTER (WHERE last_app_login_at >= NOW() - INTERVAL '${days} days') AS app_active
       FROM pms_clients_master`
    )

    const t = totals.rows[0]
    const r = recentlyActive.rows[0]

    return NextResponse.json({
      period: { days },
      distinctUsers: {
        web:  parseInt(t.web_users ?? '0'),
        app:  parseInt(t.app_users ?? '0'),
        both: parseInt(t.both_users ?? '0'),
      },
      totalLogins: {
        web: parseInt(t.web_logins_total ?? '0'),
        app: parseInt(t.app_logins_total ?? '0'),
      },
      activeInWindow: {
        web: parseInt(r.web_active ?? '0'),
        app: parseInt(r.app_active ?? '0'),
      },
    })
  } catch (err: any) {
    console.error('[admin/login-analytics]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
