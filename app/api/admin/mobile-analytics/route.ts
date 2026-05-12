import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db1'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30'), 1), 365)
  const platform = searchParams.get('platform') // 'ios' | 'android' | null

  const platformClause = platform ? `AND platform = $1` : ''
  const platformParams = platform ? [platform] : []

  try {
    // Daily active users
    const dauResult = await pool.query(
      `SELECT
         DATE_TRUNC('day', occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COUNT(DISTINCT user_id) AS active_users,
         COUNT(*) AS total_events,
         COUNT(DISTINCT session_id) AS sessions
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
         ${platformClause}
       GROUP BY 1
       ORDER BY 1 DESC`,
      platformParams
    )

    // Platform split
    const platformResult = await pool.query(
      `SELECT platform,
         COUNT(DISTINCT user_id) AS users,
         COUNT(DISTINCT session_id) AS sessions,
         COUNT(*) AS events
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
       GROUP BY 1
       ORDER BY 2 DESC`
    )

    // App version split
    const versionResult = await pool.query(
      `SELECT app_version, platform, COUNT(DISTINCT user_id) AS users
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
       GROUP BY 1, 2
       ORDER BY 3 DESC
       LIMIT 15`
    )

    // Top screens
    const screensResult = await pool.query(
      `SELECT event_name, COUNT(*) AS views, COUNT(DISTINCT user_id) AS unique_users
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'screen'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
         ${platformClause}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 20`,
      platformParams
    )

    // Top events
    const eventsResult = await pool.query(
      `SELECT event_name, COUNT(*) AS occurrences, COUNT(DISTINCT user_id) AS unique_users
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'event'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
         ${platformClause}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 20`,
      platformParams
    )

    // Errors
    const errorsResult = await pool.query(
      `SELECT event_name, COUNT(*) AS occurrences, COUNT(DISTINCT user_id) AS affected_users,
              MAX(occurred_at) AS last_seen
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'error'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
         ${platformClause}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 20`,
      platformParams
    )

    // Summary totals
    const summaryResult = await pool.query(
      `SELECT
         COUNT(DISTINCT user_id)    AS total_users,
         COUNT(DISTINCT session_id) AS total_sessions,
         COUNT(*)                   AS total_events,
         MIN(occurred_at)           AS earliest_event
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE occurred_at >= NOW() - INTERVAL '${days} days'
         ${platformClause}`,
      platformParams
    )

    // New users per day (first event ever for that user_id within the period)
    const newUsersResult = await pool.query(
      `SELECT
         DATE_TRUNC('day', first_seen AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COUNT(*) AS new_users
       FROM (
         SELECT user_id, MIN(occurred_at) AS first_seen
         FROM pms_clients_tracker.pms_mobile_analytics
         GROUP BY user_id
         HAVING MIN(occurred_at) >= NOW() - INTERVAL '${days} days'
       ) sub
       GROUP BY 1
       ORDER BY 1 DESC`
    )

    const summary = summaryResult.rows[0]

    return NextResponse.json({
      period: { days, platform: platform ?? 'all' },
      summary: {
        totalUsers:    parseInt(summary.total_users ?? '0'),
        totalSessions: parseInt(summary.total_sessions ?? '0'),
        totalEvents:   parseInt(summary.total_events ?? '0'),
        earliestEvent: summary.earliest_event ?? null,
      },
      dau:             dauResult.rows,
      newUsers:        newUsersResult.rows,
      topScreens:      screensResult.rows,
      topEvents:       eventsResult.rows,
      errors:          errorsResult.rows,
      platformSplit:   platformResult.rows,
      appVersionSplit: versionResult.rows,
    })
  } catch (err) {
    console.error('[admin/mobile-analytics]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
