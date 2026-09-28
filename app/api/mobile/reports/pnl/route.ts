// GET /api/mobile/reports/pnl?accountId=QAW00012[,QGF00014]&from=2025-04-01&to=2026-09-25
// Profit and loss account - Balance sheet, in Nuvama's layout: income, expenses and the surplus for the period, the
// unrealised gain block, and the balance sheet (at cost) as of `to`. accountId: one strategy account code or a
// comma list (summed: "All accounts"; codes not on the token are left out and listed in `omitted`). A stored Nuvama report for exactly that period is served
// as is; otherwise computed by Qode (computed: true, note). See lib/plbsCompute.ts and lib/reportsData.ts.
import { NextRequest, NextResponse } from 'next/server'
import { plbsRequest } from '@/lib/plbsAuth'
import { pnlReport } from '@/lib/reportsData'
import { reviewerPlbs, fyStart } from '@/lib/plbsCompute'
import { isoDate, REVIEWER_HOLDER } from '@/lib/mobileReports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await plbsRequest(request)
  if (a.error) return a.error
  const { codes, omitted, params, reviewer } = a
  if (reviewer) {
    const to = isoDate(params.get('to')) || '2026-09-25', from = isoDate(params.get('from')) || fyStart(to)
    return NextResponse.json({ ...reviewerPlbs(codes, from, to), holder: codes.length === 1 ? REVIEWER_HOLDER : null, periods: [] })
  }
  const res = await pnlReport(codes.join(','), params)
  return NextResponse.json(res.status === 200 ? { ...res.body, omitted } : res.body, { status: res.status })
}
