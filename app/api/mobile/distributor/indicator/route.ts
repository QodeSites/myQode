// GET /api/mobile/distributor/indicator — the Valuation Spread Indicator for the partner app's Market indicators.
// Same single upstream call the web component makes (components/indicators/valuation-spread-indicator.tsx) through
// QODE360_API_URL, partner-only (the web proxy lets any signed-in client through; this checks the partner role).
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'

const UPSTREAM = (process.env.QODE360_API_URL || 'https://qode360-backend.qodeinvest.com/api/v1').replace(/\/$/, '')

export async function GET(request: NextRequest) {
  const { error } = await requireMobileDistributor(request)
  if (error) return error
  const q = new URLSearchParams({
    exchange: 'Combined', factor: 'pb_ratio_lag', lookback: '10 Years', divisions: '2', frequency: 'Daily',
    target_bucket: '2', segments: 'Top 750,Top 100,101-250,251-500,500-750',
  })
  try {
    const res = await fetch(`${UPSTREAM}/indicator/vsi/breadth/?${q.toString()}`, { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json({ error: res.status === 503 ? 'The indicator is being rebuilt. Check back shortly.' : 'We couldn’t load the indicator.' }, { status: res.status === 503 ? 503 : 502 })
    return NextResponse.json(body?.data ?? body, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[mobile/distributor/indicator]', err)
    return NextResponse.json({ error: 'Indicator service unavailable' }, { status: 502 })
  }
}
