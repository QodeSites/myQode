// Weekly active investors (by platform) + Day-7 retention, computed from the
// login_events log (see database/migrations/003_login_events_and_first_login.sql).
//
// login_events only has data from its rollout date forward — there is no
// historical backfill. Both charts will be sparse/empty until real usage
// accumulates; that's expected, not a bug.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const weeks = Math.min(Math.max(parseInt(searchParams.get('weeks') ?? '12'), 1), 52)

  try {
    const weeklyActive = await query(
      `SELECT
         DATE_TRUNC('week', occurred_at)::date AS week,
         platform,
         COUNT(DISTINCT email) AS active_investors
       FROM login_events
       WHERE occurred_at >= NOW() - INTERVAL '${weeks} weeks'
       GROUP BY 1, 2
       ORDER BY 1 ASC`
    )

    // Day-7 retention: for each email, first-ever login_events row is their
    // cohort start; retained if they have another row >= 7 days later.
    const retention = await query(
      `WITH first_login AS (
         SELECT email, MIN(occurred_at) AS first_at
         FROM login_events
         GROUP BY email
       ),
       retained AS (
         SELECT fl.email, fl.first_at,
                EXISTS (
                  SELECT 1 FROM login_events le
                  WHERE le.email = fl.email
                    AND le.occurred_at >= fl.first_at + INTERVAL '7 days'
                ) AS retained_d7
         FROM first_login fl
         WHERE fl.first_at <= NOW() - INTERVAL '7 days'
       )
       SELECT
         DATE_TRUNC('week', first_at)::date AS cohort_week,
         COUNT(*) AS cohort_size,
         COUNT(*) FILTER (WHERE retained_d7) AS retained_d7
       FROM retained
       GROUP BY 1
       ORDER BY 1 ASC`
    )

    // Reshape weekly active into { week, web, app }[]
    const weekMap = new Map<string, { week: string; web: number; app: number }>()
    for (const row of weeklyActive.rows) {
      const key = row.week
      if (!weekMap.has(key)) weekMap.set(key, { week: key, web: 0, app: 0 })
      const entry = weekMap.get(key)!
      if (row.platform === 'web') entry.web = parseInt(row.active_investors)
      if (row.platform === 'app') entry.app = parseInt(row.active_investors)
    }

    return NextResponse.json({
      weeklyActive: Array.from(weekMap.values()),
      retentionD7: retention.rows.map((r: any) => ({
        cohortWeek: r.cohort_week,
        cohortSize: parseInt(r.cohort_size),
        retained: parseInt(r.retained_d7),
        retentionRate: r.cohort_size > 0 ? Math.round((r.retained_d7 / r.cohort_size) * 1000) / 10 : 0,
      })),
    })
  } catch (err: any) {
    console.error('[admin/retention-trend]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
