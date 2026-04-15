// GET /api/mobile/admin/analytics?days=30&event=&platform=
// Returns analytics summary for the admin dashboard.
// Super-admin only.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth, requireSuperAdmin } from '@/lib/mobileAuth'
import pool from '@/lib/db'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const adminError = requireSuperAdmin(user!)
  if (adminError) return adminError

  const { searchParams } = new URL(request.url)
  const days     = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30'), 1), 365)
  const platform = searchParams.get('platform') // 'ios' | 'android' | null (all)
  const eventFilter = searchParams.get('event')  // specific event name filter

  try {
    // ── 1. Daily active users (unique user_ids per day) ───────────────────────
    const dauResult = await pool.query(
      `SELECT
         DATE_TRUNC('day', occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COUNT(DISTINCT user_id) AS active_users,
         COUNT(*) AS total_events
       FROM pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
         ${platform ? `AND platform = $1` : ''}
       GROUP BY 1
       ORDER BY 1 DESC`,
      platform ? [platform] : []
    )

    // ── 2. Top screens (last N days) ─────────────────────────────────────────
    const screensResult = await pool.query(
      `SELECT event_name, COUNT(*) AS views, COUNT(DISTINCT user_id) AS unique_users
       FROM pms_mobile_analytics
       WHERE event_type = 'screen'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
         ${platform ? `AND platform = $1` : ''}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 20`,
      platform ? [platform] : []
    )

    // ── 3. Top events ────────────────────────────────────────────────────────
    const eventsResult = await pool.query(
      `SELECT event_name, COUNT(*) AS occurrences, COUNT(DISTINCT user_id) AS unique_users
       FROM pms_mobile_analytics
       WHERE event_type = 'event'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
         ${platform ? `AND platform = $1` : ''}
         ${eventFilter ? `AND event_name = $2` : ''}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 30`,
      [
        ...(platform ? [platform] : []),
        ...(eventFilter ? [eventFilter] : []),
      ]
    )

    // ── 4. Errors (last N days) ──────────────────────────────────────────────
    const errorsResult = await pool.query(
      `SELECT event_name, COUNT(*) AS occurrences, COUNT(DISTINCT user_id) AS affected_users,
              MAX(occurred_at) AS last_seen
       FROM pms_mobile_analytics
       WHERE event_type = 'error'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
         ${platform ? `AND platform = $1` : ''}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 20`,
      platform ? [platform] : []
    )

    // ── 5. Platform split ────────────────────────────────────────────────────
    const platformResult = await pool.query(
      `SELECT platform, COUNT(DISTINCT user_id) AS users, COUNT(DISTINCT session_id) AS sessions
       FROM pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
       GROUP BY 1
       ORDER BY 2 DESC`
    )

    // ── 6. App version split ─────────────────────────────────────────────────
    const versionResult = await pool.query(
      `SELECT app_version, COUNT(DISTINCT user_id) AS users
       FROM pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 10`
    )

    // ── 7. Summary totals ────────────────────────────────────────────────────
    const summaryResult = await pool.query(
      `SELECT
         COUNT(DISTINCT user_id)    AS total_users,
         COUNT(DISTINCT session_id) AS total_sessions,
         COUNT(*)                   AS total_events,
         MIN(occurred_at)           AS earliest_event
       FROM pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
         ${platform ? `AND platform = $1` : ''}`,
      platform ? [platform] : []
    )

    const summary = summaryResult.rows[0]

    return NextResponse.json({
      period: { days, platform: platform ?? 'all' },
      summary: {
        totalUsers:    parseInt(summary.total_users ?? 0),
        totalSessions: parseInt(summary.total_sessions ?? 0),
        totalEvents:   parseInt(summary.total_events ?? 0),
        earliestEvent: summary.earliest_event ?? null,
      },
      dau:             dauResult.rows,
      topScreens:      screensResult.rows,
      topEvents:       eventsResult.rows,
      errors:          errorsResult.rows,
      platformSplit:   platformResult.rows,
      appVersionSplit: versionResult.rows,
    })
  } catch (err) {
    console.error('[mobile/admin/analytics]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
