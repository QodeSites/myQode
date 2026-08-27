import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import pool from "@/lib/db1";

/**
 * How investors actually use myQode — sessions, screens and platform split.
 *
 * WHY THIS EXISTS RATHER THAN REUSING /api/admin/mobile-analytics
 * That route returns nine separate result sets shaped for the legacy page,
 * including several this dashboard does not draw. This returns exactly the
 * five panels the usage section renders, in one round trip.
 *
 * The table lives in the db1 database (PG_DATABASE1), not the portfolios
 * database the rest of the back office reads — hence the pool import above.
 *
 * `event_name` holds the page path, so the "top screens" panel is really a
 * page-view ranking. It is labelled that way rather than pretending to be
 * app-screen instrumentation.
 */

const TABLE = "pms_clients_tracker.pms_mobile_analytics";

export async function GET(request: NextRequest) {
  const admin = await requireRole(request, "analytics");
  if (!isRoleUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const rawDays = Number(searchParams.get("days") ?? "30");
    // Clamped, and interpolated only after validation — the interval cannot
    // be parameterised, so it must never carry raw input.
    const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;

    const [summaryRes, platformRes, screensRes, dailyRes, versionRes] =
      await Promise.all([
        pool.query(
          `SELECT COUNT(DISTINCT user_id)::int    AS users,
                  COUNT(DISTINCT session_id)::int AS sessions,
                  COUNT(*)::int                   AS events,
                  MIN(occurred_at)                AS since
             FROM ${TABLE}
            WHERE occurred_at >= NOW() - INTERVAL '${days} days'`,
        ),
        pool.query(
          `SELECT COALESCE(platform, 'unknown') AS platform,
                  COUNT(DISTINCT user_id)::int  AS users,
                  COUNT(*)::int                 AS events
             FROM ${TABLE}
            WHERE occurred_at >= NOW() - INTERVAL '${days} days'
            GROUP BY 1 ORDER BY users DESC`,
        ),
        pool.query(
          `SELECT event_name AS screen, COUNT(*)::int AS views,
                  COUNT(DISTINCT user_id)::int AS users
             FROM ${TABLE}
            WHERE occurred_at >= NOW() - INTERVAL '${days} days'
              AND event_name IS NOT NULL
            GROUP BY 1 ORDER BY views DESC LIMIT 10`,
        ),
        pool.query(
          `SELECT to_char(date_trunc('day', occurred_at), 'DD Mon') AS day,
                  COUNT(DISTINCT user_id)::int AS users,
                  date_trunc('day', occurred_at) AS bucket
             FROM ${TABLE}
            WHERE occurred_at >= NOW() - INTERVAL '${days} days'
            GROUP BY bucket ORDER BY bucket`,
        ),
        pool.query(
          `SELECT COALESCE(app_version, 'unknown') AS version,
                  COUNT(DISTINCT user_id)::int     AS users
             FROM ${TABLE}
            WHERE occurred_at >= NOW() - INTERVAL '${days} days'
            GROUP BY 1 ORDER BY users DESC LIMIT 6`,
        ),
      ]);

    const s = summaryRes.rows[0] ?? {};
    const sessions = Number(s.sessions ?? 0);
    const users = Number(s.users ?? 0);

    return NextResponse.json({
      days,
      summary: {
        users,
        sessions,
        events: Number(s.events ?? 0),
        since: s.since ? String(s.since) : null,
        // Two derived figures the panels lead with, computed here so the page
        // does not repeat the arithmetic.
        sessionsPerUser: users ? Number((sessions / users).toFixed(1)) : 0,
      },
      platforms: (platformRes.rows ?? []).map((r: any) => ({
        platform: String(r.platform),
        users: Number(r.users),
        events: Number(r.events),
      })),
      screens: (screensRes.rows ?? []).map((r: any) => ({
        screen: String(r.screen),
        views: Number(r.views),
        users: Number(r.users),
      })),
      daily: (dailyRes.rows ?? []).map((r: any) => ({
        day: String(r.day),
        users: Number(r.users),
      })),
      versions: (versionRes.rows ?? []).map((r: any) => ({
        version: String(r.version),
        users: Number(r.users),
      })),
    });
  } catch (error) {
    console.error("[admin/usage] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
