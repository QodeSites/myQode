// GET /api/mobile/distributor/journey
// The distributor's book: referred investors with their onboarding journey, stage counts, totals and the
// partner's referral links. Same payload as the web's /api/distributor/journey (see lib/mobileDistributor).
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor, distributorJourney } from '@/lib/mobileDistributor'

export async function GET(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  try {
    return NextResponse.json(await distributorJourney(distributor!), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[mobile/distributor/journey]', err)
    return NextResponse.json({ error: 'Could not load your investors' }, { status: 500 })
  }
}
