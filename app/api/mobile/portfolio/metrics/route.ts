// GET /api/mobile/portfolio/metrics?accountId=QGF00014 | <owner id> | <group id> | a comma list of them (combined)
// Key metrics since inception: CAGR, volatility, Sharpe (risk-free 6.5%), beta, alpha (CAGR − benchmark CAGR),
// max drawdown, best / worst month. See lib/portfolioMetrics.ts. Fractions (0.226 = 22.6%).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { normaliseAccountCode } from '@/lib/utils'
import { portfolioMetrics } from '@/lib/portfolioMetrics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ metrics: null })
  // accountId: one id, or a comma list (an owner's open accounts / a family's members, combined: lib/portfolioMetrics.ts)
  const asked = (new URL(request.url).searchParams.get('accountId') || '').split(',').map(x => x.trim()).filter(Boolean)
  if (!asked.length) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  const dbIds = [...new Set(asked.map(normaliseAccountCode))]
  const ok = dbIds.every(id => user!.accountCodes?.some((c) => normaliseAccountCode(c) === id))
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ metrics: await portfolioMetrics(dbIds.length === 1 ? dbIds[0] : dbIds) })
  } catch (e) {
    console.error('[mobile/portfolio/metrics]', e)
    return NextResponse.json({ error: 'Could not compute metrics' }, { status: 500 })
  }
}
