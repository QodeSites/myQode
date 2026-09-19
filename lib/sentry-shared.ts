import type { ErrorEvent, EventHint } from "@sentry/nextjs"

import { scrub, scrubUrl } from "@/lib/analytics-scrub"

/**
 * Settings every Sentry runtime (browser, node, edge) shares.
 *
 * Kept in one module so the three config files cannot drift — a scrubbing rule
 * that applies on the server but not in the browser is worse than none, because
 * it reads as covered.
 */

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"
export const SENTRY_RELEASE = process.env.NEXT_PUBLIC_SENTRY_RELEASE

/**
 * Only production reports. A developer's console is the right place for a local
 * error, and dev noise in a shared project makes real alerts unreadable.
 */
export const SENTRY_ENABLED = Boolean(SENTRY_DSN) && SENTRY_ENVIRONMENT !== "development"

/** 10% of transactions. Enough to see a trend, cheap enough to leave on. */
export const TRACES_SAMPLE_RATE = 0.1

/**
 * Last line of defence before anything leaves the process.
 *
 * Sentry's own `sendDefaultPii: false` covers the fields it knows about; this
 * covers ours — request bodies, breadcrumb data, extra context and the query
 * strings that carry `cust_id`.
 */
export function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request) {
    delete event.request.cookies
    if (event.request.headers) {
      for (const h of ["cookie", "authorization", "x-forwarded-for", "set-cookie"]) {
        delete event.request.headers[h]
      }
    }
    event.request.url = scrubUrl(event.request.url)
    if (event.request.data) event.request.data = scrub(event.request.data)
    delete event.request.query_string
  }

  // Identity is the opaque analytics id and nothing else.
  if (event.user) {
    event.user = { id: event.user.id }
  }

  if (event.extra) event.extra = scrub(event.extra)
  if (event.contexts) event.contexts = scrub(event.contexts)

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: b.data ? scrub(b.data) : b.data,
      message: b.message?.includes("@finvu") ? "[redacted]" : b.message,
    }))
  }

  return event
}
