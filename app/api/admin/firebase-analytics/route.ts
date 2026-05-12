// Read aggregated analytics from Google Analytics 4 (Firebase Analytics).
//
// Firebase Analytics writes its data to a GA4 property; this route queries
// the GA4 Data API to surface totals, daily breakdowns, and platform splits
// for the admin dashboard. Same response shape as /api/admin/mobile-analytics
// so the dashboard swap is transparent.
//
// Required env vars:
//   FIREBASE_GA_PROPERTY_ID                 numeric GA4 property id (e.g. 312345678)
//                                           Find in GA4 Admin → Property settings → Property ID
//   FIREBASE_ANALYTICS_SERVICE_ACCOUNT_KEY  full service-account JSON (one line)
//                                           Service account needs the role:
//                                             "Viewer" on the GA4 property
//                                             (Admin → Property Access Management → add SA email)
//
// The service account does NOT need any Firebase project permissions —
// just GA4 property viewer access.

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const GA_BASE = 'https://analyticsdata.googleapis.com/v1beta'

let cachedToken: { token: string; expiresAt: number } | null = null

function loadServiceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.FIREBASE_ANALYTICS_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('FIREBASE_ANALYTICS_SERVICE_ACCOUNT_KEY not set')
  const parsed = JSON.parse(raw)
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account JSON missing client_email or private_key')
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  }
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const sa = loadServiceAccount()
  const now = Math.floor(Date.now() / 1000)
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    sa.private_key,
    { algorithm: 'RS256' }
  )
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  })
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

async function runReport(propertyId: string, body: object, token: string) {
  const res = await fetch(`${GA_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GA4 ${res.status}: ${await res.text()}`)
  return (await res.json()) as {
    rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>
    rowCount?: number
  }
}

export async function GET(request: NextRequest) {
  const propertyId = process.env.FIREBASE_GA_PROPERTY_ID
  if (!propertyId)
    return NextResponse.json({ error: 'FIREBASE_GA_PROPERTY_ID not set' }, { status: 503 })
  if (!process.env.FIREBASE_ANALYTICS_SERVICE_ACCOUNT_KEY)
    return NextResponse.json({ error: 'FIREBASE_ANALYTICS_SERVICE_ACCOUNT_KEY not set' }, { status: 503 })

  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30'), 1), 365)
  const platform = searchParams.get('platform') // 'ios' | 'android' | 'web' | null

  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' }
  const platformFilter = platform
    ? {
        dimensionFilter: {
          filter: {
            fieldName: 'customEvent:app_platform',
            stringFilter: { matchType: 'EXACT', value: platform },
          },
        },
      }
    : {}

  try {
    const token = await getAccessToken()

    // 1. Daily active users + sessions + events
    const dauReport = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'eventCount' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: true }],
      ...platformFilter,
    }, token)

    // 2. Platform split (uses our custom app_platform param)
    const platformReport = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'customEvent:app_platform' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'eventCount' },
      ],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    }, token)

    // 3. App version split
    const versionReport = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'appVersion' }, { name: 'customEvent:app_platform' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 15,
    }, token)

    // 4. Top screens
    const screensReport = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'unifiedScreenName' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 20,
      ...platformFilter,
    }, token)

    // 5. New users per day
    const newUsersReport = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'firstSessionDate' }],
      metrics: [{ name: 'newUsers' }],
      orderBys: [{ dimension: { dimensionName: 'firstSessionDate' }, desc: true }],
      ...platformFilter,
    }, token)

    // 6. Period totals
    const summaryReport = await runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'eventCount' },
      ],
      ...platformFilter,
    }, token)

    // ── Shape the response to match /api/admin/mobile-analytics ──────────────
    const formatDate = (yyyymmdd: string) =>
      `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

    const dau = (dauReport.rows ?? []).map(r => ({
      day: formatDate(r.dimensionValues[0].value),
      active_users: r.metricValues[0].value,
      sessions: r.metricValues[1].value,
      total_events: r.metricValues[2].value,
    }))

    const platformSplit = (platformReport.rows ?? []).map(r => ({
      platform: r.dimensionValues[0].value || 'unknown',
      users: r.metricValues[0].value,
      sessions: r.metricValues[1].value,
      events: r.metricValues[2].value,
    }))

    const appVersionSplit = (versionReport.rows ?? []).map(r => ({
      app_version: r.dimensionValues[0].value || 'unknown',
      platform: r.dimensionValues[1].value || 'unknown',
      users: r.metricValues[0].value,
    }))

    const topScreens = (screensReport.rows ?? []).map(r => ({
      event_name: r.dimensionValues[0].value,
      views: r.metricValues[0].value,
      unique_users: r.metricValues[1].value,
    }))

    const newUsers = (newUsersReport.rows ?? []).map(r => ({
      day: formatDate(r.dimensionValues[0].value),
      new_users: r.metricValues[0].value,
    }))

    const sumRow = summaryReport.rows?.[0]
    const summary = {
      totalUsers: parseInt(sumRow?.metricValues[0].value ?? '0'),
      totalSessions: parseInt(sumRow?.metricValues[1].value ?? '0'),
      totalEvents: parseInt(sumRow?.metricValues[2].value ?? '0'),
      earliestEvent: null,
    }

    return NextResponse.json({
      period: { days, platform: platform ?? 'all' },
      summary,
      dau,
      newUsers,
      topScreens,
      topEvents: [],
      errors: [],
      platformSplit,
      appVersionSplit,
      source: 'firebase-ga4',
    })
  } catch (err: any) {
    console.error('[admin/firebase-analytics]', err)
    return NextResponse.json(
      { error: err?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}
