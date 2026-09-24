"use client"

import { useEffect } from "react"

import { initAnalytics } from "@/lib/analytics"

/**
 * Starts PostHog. Identification is deliberately NOT wired up yet.
 *
 * MyQode has no endpoint that returns an opaque analytics id, and the
 * identifiers it does hold client-side are the ones the standard forbids
 * sending. Rather than identify people by something unsafe, this stays
 * anonymous until an equivalent of OneView's /api/mobile/identity exists here —
 * pageviews and errors are still attributed to a session, just not to a person.
 */
export function AnalyticsProvider() {
  useEffect(() => {
    initAnalytics()

  }, [])

  return null
}
