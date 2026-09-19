import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { PostHog } from "posthog-node"

import { APP_NAME, defaultProperties } from "@/lib/analytics-events"

export const dynamic = "force-dynamic"

/**
 * Deliberate test event and test error, for confirming the pipeline end to end.
 *
 * Guarded by CRON_SECRET so it cannot be used to spam the projects:
 *   curl -H "Authorization: Bearer $CRON_SECRET" .../api/analytics/test
 *
 * Documented in docs/analytics.md. This is the "documented way to send a test
 * event" that replaces throwaway test code.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 })
  }

  const results: Record<string, string> = {}

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
  if (key && host) {
    try {
      const client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 })
      client.capture({
        distinctId: "telemetry-test",
        event: "telemetry_test_sent",
        properties: { ...defaultProperties("backend"), source: "api/analytics/test" },
      })
      await client.shutdown()
      results.posthog = "sent telemetry_test_sent"
    } catch (error) {
      results.posthog = `failed: ${(error as Error).message}`
    }
  } else {
    results.posthog = "skipped: NEXT_PUBLIC_POSTHOG_KEY/HOST unset"
  }

  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      const id = Sentry.captureException(
        new Error(`[test] deliberate test error from ${APP_NAME}`),
      )
      await Sentry.flush(5000)
      results.sentry = `sent event ${id}`
    } catch (error) {
      results.sentry = `failed: ${(error as Error).message}`
    }
  } else {
    results.sentry = "skipped: NEXT_PUBLIC_SENTRY_DSN unset"
  }

  return NextResponse.json({ ok: true, app: APP_NAME, results })
}
