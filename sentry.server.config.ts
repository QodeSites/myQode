import * as Sentry from "@sentry/nextjs"

import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  TRACES_SAMPLE_RATE,
  beforeSend,
} from "@/lib/sentry-shared"

/**
 * Server-side Sentry.
 *
 * This runtime sees the most sensitive data in the product — repositories read
 * PAN, demat and bank rows — so `beforeSend` matters more here than anywhere.
 */
if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend,
  })
}
