// GET /api/mobile/reports/capital-gains?accountId=QAW00012&fy=2025-26&term=ST|LT&limit=50&offset=0
// Realised capital gains per financial year from pms_clients_tracker.pms_capital_gains (Nuvama "Statement of
// Capital Gain/Loss", loaded by scripts/import-nuvama-reports.mjs; the latest import for the account is used).
// fy defaults to the most recent year with sales.
import { NextRequest, NextResponse } from 'next/server'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'
import { reportAccount, page, n, day, fyRange, reviewerCapitalGains } from '@/lib/mobileReports'
import { REVIEWER_HOLDER } from '@/lib/mobileReports'
import { capitalGainsReport } from '@/lib/reportsData'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await reportAccount(request)
  if (a.error) return a.error
  const { user, accountId, params } = a
  if (user.isReviewer || REVIEWER_ACCOUNT_CODES.includes(accountId)) return NextResponse.json({ ...reviewerCapitalGains(accountId, params), holder: REVIEWER_HOLDER })
  const res = await capitalGainsReport(accountId, params)
  return NextResponse.json(res.body, { status: res.status })
}
