"use client"

import posthog from "posthog-js"
import * as Sentry from "@sentry/nextjs"

import {
  EVENTS,
  type EventName,
  type EventProperties,
  defaultProperties,
} from "@/lib/analytics-events"
import { scrub } from "@/lib/analytics-scrub"

/**
 * The only module the rest of the client calls for analytics.
 *
 * Everything here is failure-safe by construction: PostHog going down, being
 * blocked by an extension, or never having been configured must not change what
 * the product does. Every export is wrapped, returns void, and swallows.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST
const ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"

/** Local development stays out of the shared project. */
const ENABLED = Boolean(KEY && HOST) && ENVIRONMENT !== "development"

let started = false

/** Idempotent: React strict mode and hot reload both call this twice. */
export function initAnalytics(): void {
  if (!ENABLED || started || typeof window === "undefined") return
  started = true
  try {
    posthog.init(KEY!, {
      api_host: HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      // Autocapture records the TEXT of clicked elements. On a holdings row or
      // a portfolio tile that text IS the number, so it is masked globally —
      // sanitize_properties below cannot help, because the value arrives as an
      // element label rather than a property.
      mask_all_text: true,
      mask_all_element_attributes: true,
      // Replay would record holdings and portfolio values on screen.
      disable_session_recording: true,
      persistence: "localStorage+cookie",
      // Sanitise the URL before it becomes a property; `cust_id` has appeared
      // in query strings before and must never become a PostHog property.
      sanitize_properties: (properties) => scrub(properties),
      loaded: () => {
        // Join the two tools up: an error in Sentry can be traced back to the
        // PostHog person who hit it, without either holding a phone number.
        try {
          const id = posthog.get_distinct_id()
          if (id) Sentry.setTag("posthog_distinct_id", id)
        } catch {
          /* non-fatal */
        }
      },
    })
  } catch {
    /* analytics must never break the app */
  }
}

/**
 * Identify by our opaque analytics id — never a phone, email or `cust_id`.
 * Fetched from /api/mobile/identity, which HMACs it server-side.
 */
export function identify(analyticsId: string | null, traits?: Record<string, unknown>): void {
  if (!ENABLED || !analyticsId) return
  try {
    posthog.identify(analyticsId, traits ? scrub(traits) : undefined)
    Sentry.setUser({ id: analyticsId })
  } catch {
    /* non-fatal */
  }
}

/** On sign-out, so the next person on this browser is not the previous one. */
export function resetAnalytics(): void {
  if (!ENABLED) return
  try {
    posthog.reset()
    Sentry.setUser(null)
  } catch {
    /* non-fatal */
  }
}

/** Typed capture: the event name and its properties must match the standard. */
export function capture<E extends EventName>(
  event: E,
  properties: EventProperties[E] = {} as EventProperties[E],
): void {
  if (!ENABLED) return
  try {
    posthog.capture(event, { ...defaultProperties("web"), ...scrub(properties) })
  } catch {
    /* non-fatal */
  }
}

export { EVENTS }
