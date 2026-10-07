// GET /api/mobile/portfolio/metrics?accountId=QGF00014 | <owner id> | <group id>
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
  const accountId = new URL(request.url).searchParams.get('accountId') || ''
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  const dbId = normaliseAccountCode(accountId)
  const ok = user!.accountCodes?.some((c) => c === accountId || normaliseAccountCode(c) === dbId)
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ metrics: await portfolioMetrics(dbId) })
  } catch (e) {
    console.error('[mobile/portfolio/metrics]', e)
    return NextResponse.json({ error: 'Could not compute metrics' }, { status: 500 })
  }
}
