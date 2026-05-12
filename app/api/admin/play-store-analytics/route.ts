// Google Play install statistics via Cloud Storage report bucket.
// Docs: https://support.google.com/googleplay/android-developer/answer/6135870
//
// Each Play Console account has a private GCS bucket where Google drops
// monthly CSV reports. Path:
//   gs://<bucket>/stats/installs/installs_<package>_<YYYYMM>_overview.csv
//
// CSVs are UTF-16 LE encoded with a BOM. The "overview" report has daily
// totals (no dimension breakdown). We parse it and filter to the date range.
//
// Required env vars:
//   GOOGLE_PLAY_PACKAGE_NAME           e.g. com.qodeinvest.myqode
//   GOOGLE_PLAY_REPORT_BUCKET          e.g. pubsite_prod_1234567890123456789
//                                      (find in Play Console → Download reports →
//                                       Statistics → "Copy Cloud Storage URI",
//                                       value between "gs://" and the next "/")
//   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY    full service-account JSON (one line, single-quoted)
//
// Service-account permissions:
//   - Grant the service account "Storage Object Viewer" role on the bucket
//     (Play Console may have done this automatically when you linked the GCP project).
//   - In Play Console → Users and permissions, invite the service account email
//     with at least "View app information" permission.

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only'
const GCS_BASE = 'https://storage.googleapis.com/storage/v1'

let cachedToken: { token: string; expiresAt: number } | null = null

function loadServiceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_KEY not set')
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
    {
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
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
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google OAuth ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  return json.access_token
}

// Decode UTF-16 buffer (with optional BOM) to UTF-8 string.
function decodeUtf16(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le')
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE — swap bytes then decode as LE
    const swapped = Buffer.alloc(buf.length - 2)
    for (let i = 2; i < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1]
      swapped[i - 1] = buf[i]
    }
    return swapped.toString('utf16le')
  }
  // No BOM — most Play CSVs are LE
  return buf.toString('utf16le')
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).map(line => {
    const vals: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        inQuote = !inQuote
      } else if (c === ',' && !inQuote) {
        vals.push(cur)
        cur = ''
      } else {
        cur += c
      }
    }
    vals.push(cur)
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]))
  })
  return { headers, rows }
}

async function fetchOverviewCsv(
  bucket: string,
  packageName: string,
  yearMonth: string,
  token: string
): Promise<{ headers: string[]; rows: Record<string, string>[]; objectName: string; status: number }> {
  const objectName = `stats/installs/installs_${packageName}_${yearMonth}_overview.csv`
  const url = `${GCS_BASE}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    return { headers: [], rows: [], objectName, status: res.status }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const parsed = parseCsv(decodeUtf16(buf))
  return { ...parsed, objectName, status: 200 }
}

async function listInstallsObjects(
  bucket: string,
  token: string,
  prefix: string
): Promise<{ items: string[]; status: number; error?: string }> {
  const url = `${GCS_BASE}/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}&maxResults=50`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    return { items: [], status: res.status, error: text.slice(0, 500) }
  }
  const data = (await res.json()) as { items?: Array<{ name: string }> }
  return { items: (data.items ?? []).map(i => i.name), status: 200 }
}

async function listBucketRoot(
  bucket: string,
  token: string
): Promise<{ items: string[]; status: number; error?: string }> {
  const url = `${GCS_BASE}/b/${encodeURIComponent(bucket)}/o?maxResults=20`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    return { items: [], status: res.status, error: text.slice(0, 500) }
  }
  const data = (await res.json()) as { items?: Array<{ name: string }> }
  return { items: (data.items ?? []).map(i => i.name), status: 200 }
}

// Months between (and including) the YYYYMM strings of `daysAgo` ago and 1 day ago.
function monthsForRange(days: number): string[] {
  const months = new Set<string>()
  const today = new Date()
  for (let i = 1; i <= days; i++) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    months.add(ym)
  }
  return Array.from(months).sort()
}

function pickColumn(row: Record<string, string>, candidates: string[]): number {
  for (const c of candidates) {
    if (c in row && row[c] !== '') {
      const n = parseInt(row[c].replace(/,/g, ''), 10)
      if (!Number.isNaN(n)) return n
    }
  }
  return 0
}

export async function GET(request: NextRequest) {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME
  const bucket = process.env.GOOGLE_PLAY_REPORT_BUCKET
  if (!packageName) return NextResponse.json({ error: 'GOOGLE_PLAY_PACKAGE_NAME not set' }, { status: 503 })
  if (!bucket) return NextResponse.json({ error: 'GOOGLE_PLAY_REPORT_BUCKET not set' }, { status: 503 })
  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY)
    return NextResponse.json({ error: 'GOOGLE_PLAY_SERVICE_ACCOUNT_KEY not set' }, { status: 503 })

  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '7'), 1), 90)
  const debug = searchParams.get('debug') === '1'

  try {
    const token = await getAccessToken()
    const months = monthsForRange(days)

    // Fetch overview CSVs for each month in range. Missing months (404) are
    // expected for the current month before Google has uploaded any rows.
    const allRows: Record<string, string>[] = []
    const fetchLog: Array<{ objectName: string; status: number; rowCount: number; headers?: string[] }> = []
    for (const ym of months) {
      const csv = await fetchOverviewCsv(bucket, packageName, ym, token)
      fetchLog.push({
        objectName: csv.objectName,
        status: csv.status,
        rowCount: csv.rows.length,
        headers: debug ? csv.headers : undefined,
      })
      allRows.push(...csv.rows)
    }

    // If nothing was found, list what IS in the bucket so we can spot naming
    // mismatches (different package, different folder, etc.).
    let installsListing: Awaited<ReturnType<typeof listInstallsObjects>> | undefined
    let rootListing: Awaited<ReturnType<typeof listBucketRoot>> | undefined
    if (allRows.length === 0) {
      installsListing = await listInstallsObjects(bucket, token, 'stats/installs/')
      // Also list bucket root — if this fails too, the bucket name or SA permission is the issue.
      rootListing = await listBucketRoot(bucket, token)
    }

    // Earliest day we still want included (UTC date, YYYY-MM-DD).
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - days)
    const cutoffStr = cutoff.toISOString().split('T')[0]

    const dailyMap = new Map<string, {
      newInstalls: number
      uninstalls: number
      activeInstalls: number
    }>()

    for (const row of allRows) {
      const date = (row['Date'] ?? row['date'] ?? '').trim()
      if (!date || date < cutoffStr) continue
      const newInstalls = pickColumn(row, [
        'Daily Device Installs',
        'Daily User Installs',
        'Install events',
      ])
      const uninstalls = pickColumn(row, [
        'Daily Device Uninstalls',
        'Daily User Uninstalls',
        'Uninstall events',
      ])
      // Active Device Installs is the reliable source.
      // Total User Installs / Active User Installs are deprecated fields that
      // often contain 0 even when there are real installs — never prefer them.
      const activeInstalls = pickColumn(row, [
        'Active Device Installs',
        'Current Device Installs',
        'Active User Installs',
        'Total User Installs',
      ])
      dailyMap.set(date, { newInstalls, uninstalls, activeInstalls })
    }

    const summary = Array.from(dailyMap.entries())
      .map(([date, m]) => ({ date, ...m }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first

    const totals = {
      newInstalls: summary.reduce((s, r) => s + r.newInstalls, 0),
      uninstalls: summary.reduce((s, r) => s + r.uninstalls, 0),
      activeInstalls: summary[0]?.activeInstalls ?? 0,
    }

    return NextResponse.json({
      packageName,
      bucket,
      days,
      months,
      summary,
      totals,
      diagnostics: {
        fetchLog,
        serviceAccountEmail: loadServiceAccount().client_email,
        ...(installsListing ? {
          installsListing: {
            status: installsListing.status,
            error: installsListing.error,
            sample: installsListing.items.slice(0, 20),
            totalListed: installsListing.items.length,
          },
        } : {}),
        ...(rootListing ? {
          rootListing: {
            status: rootListing.status,
            error: rootListing.error,
            sample: rootListing.items.slice(0, 20),
            totalListed: rootListing.items.length,
          },
        } : {}),
        ...(allRows.length > 0 && debug ? { sampleHeaders: Object.keys(allRows[0]) } : {}),
      },
    })
  } catch (err: any) {
    console.error('[admin/play-store-analytics]', err)
    return NextResponse.json(
      { error: err?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}
