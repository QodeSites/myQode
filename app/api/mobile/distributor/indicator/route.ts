// GET /api/mobile/distributor/indicator — the Valuation Spread Indicator for the partner app's Market indicators.
// Same single upstream call the web component makes (components/indicators/valuation-spread-indicator.tsx) through
// QODE360_API_URL, partner-only (the web proxy lets any signed-in client through; this checks the partner role).
//
// Speed: the upstream takes 5–8 s and returns ~2 MB, and the data is the same for every partner (daily market
// data). So the response is cached in memory for CACHE_MS and shared; a stale copy is served at once while one
// background refresh runs, and concurrent first requests share a single upstream call. Only what the app draws is
// sent: `series` (points from 2006 on, the chart's start) — `distribution` and `dates` are dropped.
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'

const UPSTREAM = (process.env.QODE360_API_URL || 'https://qode360-backend.qodeinvest.com/api/v1').replace(/\/$/, '')
const CACHE_MS = 30 * 60 * 1000
const HISTORY_START = '2006-01-01'

type Slim = { series: { segment: string; points: { date: string; value: number | null }[] }[] }
let cache: { data: Slim; at: number } | null = null
let inflight: Promise<Slim> | null = null

class UpstreamError extends Error { constructor(public status: number) { super(`upstream ${status}`) } }

function fetchSlim(): Promise<Slim> {
  if (inflight) return inflight
  const q = new URLSearchParams({
    exchange: 'Combined', factor: 'pb_ratio_lag', lookback: '10 Years', divisions: '2', frequency: 'Daily',
    target_bucket: '2', segments: 'Top 750,Top 100,101-250,251-500,500-750',
  })
  inflight = (async () => {
    const res = await fetch(`${UPSTREAM}/indicator/vsi/breadth/?${q.toString()}`, { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new UpstreamError(res.status)
    const d = body?.data ?? body
    const series = (Array.isArray(d?.series) ? d.series : []).map((s: any) => ({
      segment: s?.segment,
      points: (Array.isArray(s?.points) ? s.points : []).filter((p: any) => String(p?.date) >= HISTORY_START).map((p: any) => ({ date: p.date, value: p.value })),
    }))
    const slim = { series }
    cache = { data: slim, at: Date.now() }
    return slim
  })().finally(() => { inflight = null })
  return inflight
}

export async function GET(request: NextRequest) {
  const { error } = await requireMobileDistributor(request)
  if (error) return error
  const headers = { 'Cache-Control': 'private, no-store' }
  if (cache) {
    // Serve what we have; refresh in the background once it is older than CACHE_MS.
    if (Date.now() - cache.at > CACHE_MS) fetchSlim().catch(err => console.error('[mobile/distributor/indicator] refresh', err))
    return NextResponse.json(cache.data, { headers })
  }
  try {
    return NextResponse.json(await fetchSlim(), { headers })
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json({ error: err.status === 503 ? 'The indicator is being rebuilt. Check back shortly.' : 'We couldn’t load the indicator.' }, { status: err.status === 503 ? 503 : 502 })
    }
    console.error('[mobile/distributor/indicator]', err)
    return NextResponse.json({ error: 'Indicator service unavailable' }, { status: 502 })
  }
}
