// GET /api/mobile/distributor/strategy-aum
// How the distributor's book splits across Qode strategies, at the latest portfolio values.
// Same payload as the web's /api/distributor/strategy-aum (see lib/mobileDistributor).
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor, distributorStrategyAum } from '@/lib/mobileDistributor'

export async function GET(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  try {
    return NextResponse.json(await distributorStrategyAum(distributor!), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[mobile/distributor/strategy-aum]', err)
    return NextResponse.json({ error: 'Could not load the strategy split' }, { status: 500 })
  }
}
