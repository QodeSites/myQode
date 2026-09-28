// GET /api/mobile/reports/balance-sheet?accountId=QAW00012[,QGF00014]&date=2026-09-25
// The balance sheet (at cost) as of `date` (default: the latest value date), with the P&L from the start of that
// financial year, in the same response shape as /api/mobile/reports/pnl. See lib/plbsCompute.ts.
import { NextRequest, NextResponse } from 'next/server'
import { plbsRequest } from '@/lib/plbsAuth'
import { balanceSheetReport } from '@/lib/reportsData'
import { reviewerPlbs, fyStart } from '@/lib/plbsCompute'
import { isoDate, REVIEWER_HOLDER } from '@/lib/mobileReports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await plbsRequest(request)
  if (a.error) return a.error
  const { codes, omitted, params, reviewer } = a
  if (reviewer) {
    const to = isoDate(params.get('date')) || '2026-09-25'
    return NextResponse.json({ ...reviewerPlbs(codes, fyStart(to), to), holder: codes.length === 1 ? REVIEWER_HOLDER : null, periods: [] })
  }
  const res = await balanceSheetReport(codes.join(','), params)
  return NextResponse.json(res.status === 200 ? { ...res.body, omitted } : res.body, { status: res.status })
}
