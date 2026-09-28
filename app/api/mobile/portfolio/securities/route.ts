// GET /api/mobile/portfolio/securities?accountId=QAW00012[,QGF0001][&date=yyyy-mm-dd]
// What the investor owns (stocks, ETFs, mutual funds, derivatives, cash) from pms_holdings, like a broker's holdings
// screen. accountId: one strategy account code, or a comma list; omitted = every strategy account on the token,
// combined (one row per security, with the accounts holding it). Owner / group ids on the token are skipped: they
// have no holdings of their own. date: holdings on or before it (default today). See lib/securities.ts.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'
import { isoDate, reviewerSecurityRows, REVIEWER_STRATEGY } from '@/lib/mobileReports'
import { computeSecurities, securitiesFromRows, isAccountCode } from '@/lib/securities'

export const dynamic = 'force-dynamic'

const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)   // IST

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const params = new URL(request.url).searchParams
  const reviewer = !!user!.isReviewer
  const allowed = reviewer ? REVIEWER_ACCOUNT_CODES : (user!.accountCodes || []).filter(isAccountCode)
  const asked = (params.get('accountId') || '').split(',').map(s => s.trim()).filter(Boolean)
  // A list may name accounts the token does not carry (e.g. a Liquid Fund account): those are left out; 403 only when
  // none of the asked accounts is allowed.
  const codes = asked.length ? [...new Set(asked)].filter(c => allowed.includes(c)) : allowed
  if (asked.length && !codes.length) return NextResponse.json({ error: 'Forbidden', available: allowed }, { status: 403 })
  const asOf = isoDate(params.get('date')) || today()

  if (reviewer) {
    const rows = reviewerSecurityRows(codes).filter(r => r.holding_date <= asOf)
    const values = new Map(codes.map(c => [c, { date: null, value: 0 }]))   // no receivable gap in the mock
    return NextResponse.json(securitiesFromRows(codes, rows, values, c => REVIEWER_STRATEGY[c] || c))
  }
  if (!codes.length) return NextResponse.json(securitiesFromRows([], [], new Map(), c => c))
  try {
    return NextResponse.json(await computeSecurities(codes, asOf))
  } catch (e) {
    console.error('[portfolio/securities]', e)
    return NextResponse.json({ error: 'Could not load holdings' }, { status: 500 })
  }
}
