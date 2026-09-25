// Partner app "Fees & payouts" — the web's /api/distributor/calculator, same figures (see lib/mobileDistributorProxy).
// GET  → { firstInceptionDate, periods, suggestedPeriod, distributorName }
// POST { startDate, endDate, period } → per-account fee rows (web shape)
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'
import { callWebDistributorRoute, relay } from '@/lib/mobileDistributorProxy'

export async function GET(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  try {
    const r = await callWebDistributorRoute(distributor!.email, 'calculator')
    // The web statement/invoice read the partner's name from a cookie that doesn't carry it; the app gets it here.
    if (r.status === 200 && r.data) r.data.distributorName = distributor!.clientname
    return relay(r)
  } catch (err) {
    console.error('[mobile/distributor/fees GET]', err)
    return NextResponse.json({ error: 'Could not load periods' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  try {
    // Only the period is forwarded — never includeQodeShare.
    return relay(await callWebDistributorRoute(distributor!.email, 'calculator', { method: 'POST', body: { startDate: body?.startDate, endDate: body?.endDate, period: body?.period } }))
  } catch (err) {
    console.error('[mobile/distributor/fees POST]', err)
    return NextResponse.json({ error: 'Could not load fees' }, { status: 502 })
  }
}
