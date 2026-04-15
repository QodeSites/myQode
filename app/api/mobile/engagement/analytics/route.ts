// POST /api/mobile/engagement/analytics
// Receives batched analytics events from the mobile app.
// Stores in pms_mobile_analytics for dashboard review.
// Always returns 200 — the client must never wait for analytics.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

interface AnalyticsEvent {
  type: 'screen' | 'event' | 'error'
  name: string
  properties?: Record<string, unknown>
  userId: string | null
  sessionId: string
  timestamp: string
  platform: 'ios' | 'android' | 'web'
  appVersion: string
}

// Maximum events per batch — prevents abuse
const MAX_BATCH_SIZE = 100

export async function POST(request: NextRequest) {
  // Auth is required but errors still return 200 (analytics must never block)
  const { user } = await verifyMobileAuth(request)

  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: true }) // malformed body — silently drop
    }

    const events: AnalyticsEvent[] = Array.isArray(body?.events)
      ? body.events.slice(0, MAX_BATCH_SIZE)
      : []

    if (events.length === 0) {
      return NextResponse.json({ ok: true })
    }

    // Ensure the table exists (idempotent — only runs once per cold start in dev)
    // In production, run this migration once during deployment.
    await ensureTableExists()

    // Insert all events in a single query using unnested arrays (fast)
    const types      = events.map((e) => e.type ?? 'event')
    const names      = events.map((e) => String(e.name ?? '').slice(0, 100))
    const properties = events.map((e) => JSON.stringify(e.properties ?? {}))
    const userIds    = events.map((e) => e.userId ?? user?.userId ?? null)
    const sessionIds = events.map((e) => String(e.sessionId ?? '').slice(0, 64))
    const timestamps = events.map((e) => {
      try { return new Date(e.timestamp).toISOString() } catch { return new Date().toISOString() }
    })
    const platforms  = events.map((e) => String(e.platform ?? 'unknown').slice(0, 16))
    const versions   = events.map((e) => String(e.appVersion ?? '').slice(0, 20))

    await pool.query(
      `INSERT INTO pms_mobile_analytics
         (event_type, event_name, properties, user_id, session_id, occurred_at, platform, app_version)
       SELECT
         UNNEST($1::text[]),
         UNNEST($2::text[]),
         UNNEST($3::jsonb[]),
         UNNEST($4::text[]),
         UNNEST($5::text[]),
         UNNEST($6::timestamptz[]),
         UNNEST($7::text[]),
         UNNEST($8::text[])`,
      [types, names, properties, userIds, sessionIds, timestamps, platforms, versions]
    )
  } catch (err) {
    // Log server-side but always return success — analytics must not break the app
    console.error('[mobile/engagement/analytics] insert error:', err)
  }

  return NextResponse.json({ ok: true })
}

// ── DB Setup ─────────────────────────────────────────────────────────────────

let _tableChecked = false

async function ensureTableExists() {
  if (_tableChecked) return
  _tableChecked = true
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pms_mobile_analytics (
      id            BIGSERIAL PRIMARY KEY,
      event_type    TEXT         NOT NULL,
      event_name    TEXT         NOT NULL,
      properties    JSONB        NOT NULL DEFAULT '{}',
      user_id       TEXT,
      session_id    TEXT         NOT NULL,
      occurred_at   TIMESTAMPTZ  NOT NULL,
      platform      TEXT,
      app_version   TEXT,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_user      ON pms_mobile_analytics (user_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_name      ON pms_mobile_analytics (event_name);
    CREATE INDEX IF NOT EXISTS idx_analytics_occurred  ON pms_mobile_analytics (occurred_at DESC);
  `)
}
