// App Store Connect API — two separate APIs:
//
// 1. Sales Reports (/v1/salesReports) — IMMEDIATE data, next-day availability
//    Returns downloads/installs as TSV. Yesterday's data is available today.
//    Requires: vendorNumber, reportType, reportSubType, frequency
//
// 2. Analytics Reports (/v1/analyticsReportRequests) — 24-48h first-time delay
//    Richer metrics (sessions, active devices, crashes) but needs a request created first.

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import zlib from 'zlib'
import { promisify } from 'util'

const gunzip = promisify(zlib.gunzip)
const ASC_BASE = 'https://api.appstoreconnect.apple.com/v1'

function makeJwt(): string {
  const keyId = process.env.APP_STORE_KEY_ID!
  const issuerId = process.env.APP_STORE_ISSUER_ID!
  const privateKey = (process.env.APP_STORE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  return jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '19m',
    issuer: issuerId,
    audience: 'appstoreconnect-v1',
    keyid: keyId,
  })
}

async function ascFetch(path: string, token: string, opts: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${ASC_BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ASC ${res.status}: ${text}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json()
  // gzip-compressed TSV (sales reports)
  if (ct.includes('gzip') || ct.includes('application/a-gzip')) {
    const buf = Buffer.from(await res.arrayBuffer())
    const decompressed = await gunzip(buf)
    return decompressed.toString('utf-8')
  }
  return res.text()
}

function parseTsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split('\t').map(h => h.trim())
  const rows = lines.slice(1).map(line => {
    const vals = line.split('\t')
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']))
  })
  return { headers, rows }
}

// Generate an array of YYYY-MM-DD strings going back N days from today
function pastDates(days: number): string[] {
  const dates: string[] = []
  for (let i = 1; i <= days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

export async function GET(request: NextRequest) {
  const missingVars = ['APP_STORE_KEY_ID', 'APP_STORE_ISSUER_ID', 'APP_STORE_PRIVATE_KEY'].filter(
    k => !process.env[k]
  )
  if (missingVars.length) {
    return NextResponse.json({ error: `Missing env vars: ${missingVars.join(', ')}` }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'apps'

  try {
    const token = makeJwt()

    // ── List apps ────────────────────────────────────────────────────────────
    if (action === 'apps') {
      const data = await ascFetch('/apps?fields[apps]=name,bundleId&limit=50', token)
      return NextResponse.json({ apps: (data as any).data ?? [] })
    }

    // ── Sales Reports: fetch last N days of downloads/installs immediately ───
    // This uses /v1/salesReports which has NEXT-DAY availability.
    // Yesterday's data is always available. No request creation needed.
    if (action === 'sales') {
      const vendorNumber = searchParams.get('vendorNumber') ?? process.env.APP_STORE_VENDOR_NUMBER
      if (!vendorNumber) {
        return NextResponse.json(
          { error: 'vendorNumber required. Find it in App Store Connect → Payments and Financial Reports (top-left corner).' },
          { status: 400 }
        )
      }
      const days = Math.min(parseInt(searchParams.get('days') ?? '7'), 30)
      const debug = searchParams.get('debug') === '1'
      const dates = pastDates(days)

      const results: { date: string; rows: Record<string, string>[] }[] = []
      const fetchLog: Array<{ date: string; status: 'ok' | '404' | 'error'; rowCount?: number; error?: string }> = []

      for (const date of dates) {
        try {
          const qs = new URLSearchParams({
            'filter[vendorNumber]': vendorNumber,
            'filter[reportType]': 'SALES',
            'filter[reportSubType]': 'SUMMARY',
            'filter[frequency]': 'DAILY',
            'filter[reportDate]': date,
            'filter[version]': '1_0',
          })
          const raw = await ascFetch(`/salesReports?${qs}`, token)
          const { rows } = parseTsv(raw as string)
          fetchLog.push({ date, status: 'ok', rowCount: rows.length })
          if (rows.length > 0) results.push({ date, rows })
        } catch (e: any) {
          if (e.message?.includes('404')) {
            fetchLog.push({ date, status: '404' })
          } else {
            fetchLog.push({ date, status: 'error', error: e.message })
            throw e
          }
        }
      }

      // Count installs as any product type that is NOT an update.
      // Apple update types start with "7" (e.g. 7, 7F, 7T, 7E, 7EP, 7EU).
      // Everything else with units (1, 1F, 1T, 1E, 1EP, 1EU, F1, IA1, FI1, ...)
      // counts as a download/install/in-app purchase. We exclude in-app types
      // (IA1, FI1) from the "install" tally to keep semantics clean.
      const isInstallType = (t: string) => {
        if (!t) return false
        if (t.startsWith('7')) return false   // updates
        if (t.startsWith('IA') || t.startsWith('FI')) return false // in-app purchases
        return true
      }

      const summary = results.map(({ date, rows }) => {
        let installs = 0
        let updates = 0
        let inApp = 0
        const typeBreakdown: Record<string, number> = {}
        for (const r of rows) {
          const units = parseInt(r['Units'] ?? r['units'] ?? '0') || 0
          const type = (r['Product Type Identifier'] ?? r['product_type_identifier'] ?? '').trim()
          typeBreakdown[type] = (typeBreakdown[type] ?? 0) + units
          if (isInstallType(type)) installs += units
          else if (type.startsWith('7')) updates += units
          else if (type.startsWith('IA') || type.startsWith('FI')) inApp += units
        }
        const totalUnits = rows.reduce((sum, r) => sum + (parseInt(r['Units'] ?? '0') || 0), 0)
        return {
          date,
          installs,
          updates,
          inApp,
          totalUnits,
          rowCount: rows.length,
          ...(debug ? { typeBreakdown } : {}),
        }
      })

      return NextResponse.json({
        vendorNumber,
        days,
        summary,
        latestDate: results[0]?.date ?? null,
        latestRows: results[0]?.rows ?? [],
        latestHeaders: results[0] ? Object.keys(results[0].rows[0] ?? {}) : [],
        diagnostics: {
          fetchLog,
          datesAttempted: dates.length,
          datesWithData: results.length,
        },
      })
    }

    // ── Analytics Reports: create ONGOING request ────────────────────────────
    if (action === 'request') {
      const appId = searchParams.get('appId')
      if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 })
      const body = {
        data: {
          type: 'analyticsReportRequests',
          attributes: { accessType: 'ONGOING' },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      }
      const data = await ascFetch('/analyticsReportRequests', token, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const req = (data as any).data
      return NextResponse.json({ requestId: req?.id, attributes: req?.attributes })
    }

    // ── List analytics reports for a request ─────────────────────────────────
    if (action === 'reports') {
      const requestId = searchParams.get('requestId')
      if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })
      const data = await ascFetch(`/analyticsReportRequests/${requestId}/reports?limit=50`, token)
      return NextResponse.json({ reports: (data as any).data ?? [] })
    }

    // ── List instances for a report ───────────────────────────────────────────
    if (action === 'instances') {
      const reportId = searchParams.get('reportId')
      if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 })
      const data = await ascFetch(`/analyticsReports/${reportId}/instances?limit=200`, token)
      return NextResponse.json({ instances: (data as any).data ?? [] })
    }

    // ── List segments for an instance ─────────────────────────────────────────
    if (action === 'segments') {
      const instanceId = searchParams.get('instanceId')
      if (!instanceId) return NextResponse.json({ error: 'instanceId required' }, { status: 400 })
      const data = await ascFetch(`/analyticsReportInstances/${instanceId}/segments?limit=50`, token)
      return NextResponse.json({ segments: (data as any).data ?? [] })
    }

    // ── Download a segment CSV ────────────────────────────────────────────────
    if (action === 'download') {
      const segmentId = searchParams.get('segmentId')
      if (!segmentId) return NextResponse.json({ error: 'segmentId required' }, { status: 400 })
      const segData = await ascFetch(`/analyticsReportSegments/${segmentId}`, token)
      const downloadUrl = (segData as any).data?.attributes?.url
      if (!downloadUrl) return NextResponse.json({ error: 'No download URL on segment' }, { status: 404 })
      const csvRes = await fetch(downloadUrl)
      const csv = await csvRes.text()
      const { headers, rows } = parseTsv(csv)
      return NextResponse.json({ headers, rows, total: rows.length })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[app-store-analytics]', err)
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 })
  }
}
