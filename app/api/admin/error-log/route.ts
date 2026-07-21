// Top errors from pms_mobile_analytics (event_type = 'error'), covering both
// platforms — the mobile app has logged Analytics.error() calls for a while;
// the web app started sending events (platform: 'web') via the same
// /api/mobile/engagement/analytics endpoint once web-analytics-provider was
// wired in. Sparse until more error call-sites exist and enough time passes.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db1'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30'), 1), 365)

  try {
    const result = await pool.query(
      `SELECT event_name, platform,
              COUNT(*) AS occurrences,
              COUNT(DISTINCT user_id) AS affected_users,
              MAX(occurred_at) AS last_seen
       FROM pms_clients_tracker.pms_mobile_analytics
       WHERE event_type = 'error'
         AND occurred_at >= NOW() - INTERVAL '${days} days'
       GROUP BY event_name, platform
       ORDER BY occurrences DESC
       LIMIT 50`
    )

    return NextResponse.json({
      period: { days },
      errors: result.rows.map((r: any) => ({
        eventName: r.event_name,
        platform: r.platform ?? 'unknown',
        occurrences: parseInt(r.occurrences),
        affectedUsers: parseInt(r.affected_users),
        lastSeen: r.last_seen,
      })),
    })
  } catch (err: any) {
    console.error('[admin/error-log]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
