// Auth + scope for /api/mobile/reports/pnl and /balance-sheet: accountId is one strategy account code or a comma
// list. As in /api/mobile/portfolio/securities, a list may name accounts the token does not carry (the app's scope can
// list e.g. a Liquid Fund account): those are left out and returned in `omitted`; 403 only when none is allowed.
// Omitted = the token's first account. Reviewer tokens (and the reviewer's mock codes) get the mock statement.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'
import { traceDistributorReport } from '@/lib/mobileReports'

export async function plbsRequest(request: NextRequest): Promise<
  { codes: string[]; omitted: string[]; params: URLSearchParams; reviewer: boolean; error?: undefined } | { error: NextResponse }
> {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return { error }
  const params = new URL(request.url).searchParams
  const asked = [...new Set((params.get('accountId') || user!.accountCodes?.[0] || '').split(',').map(s => s.trim()).filter(Boolean))]
  if (!asked.length) return { error: NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 }) }
  const reviewer = !!user!.isReviewer || asked.every(c => REVIEWER_ACCOUNT_CODES.includes(c))
  if (reviewer) return { codes: asked, omitted: [], params, reviewer }
  const codes = asked.filter(c => user!.accountCodes?.includes(c))
  if (!codes.length) return { error: NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 }) }
  traceDistributorReport(request, user!, codes, params)
  return { codes, omitted: asked.filter(c => !codes.includes(c)), params, reviewer }
}
