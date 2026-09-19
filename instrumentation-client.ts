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
 * Browser-side Sentry. Next 15 runs this file before anything else on the
 * client, which is why it is here rather than in a provider component.
 */
if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // No session replay: it would record holdings and portfolio values.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
