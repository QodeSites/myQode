// GET /api/mobile/reports/factsheet?accountId=QAW00012
// The account's portfolio fact sheet: the stored Nuvama snapshot (pms_clients_tracker.pms_factsheet, loaded by
// scripts/import-nuvama-reports.mjs) for its dates, otherwise computed by lib/factsheetCompute.ts (?date=, computed: true):
// summary, TWRR vs benchmark, sector allocation and
// security-level holdings.
import { NextRequest, NextResponse } from 'next/server'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'
import { reportAccount, n, day, reviewerFactsheet } from '@/lib/mobileReports'
import { REVIEWER_HOLDER } from '@/lib/mobileReports'
import { factsheetReport } from '@/lib/reportsData'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await reportAccount(request)
  if (a.error) return a.error
  const { user, accountId, params } = a
  if (user.isReviewer || REVIEWER_ACCOUNT_CODES.includes(accountId)) return NextResponse.json({ ...reviewerFactsheet(accountId, params), holder: REVIEWER_HOLDER })
  const res = await factsheetReport(accountId, params)
  return NextResponse.json(res.body, { status: res.status })
}
