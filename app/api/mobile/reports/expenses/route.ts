// GET /api/mobile/reports/expenses?accountId=QAW00012&type=Management%20Fees&limit=50&offset=0
// The account's statement of expenses from pms_clients_tracker.pms_expense_statement (Nuvama export, loaded by
// scripts/import-nuvama-reports.mjs; latest import for the account): paid / payable totals, a breakdown by charge
// type, and the entries newest first (optionally one type).
import { NextRequest, NextResponse } from 'next/server'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'
import { reportAccount, page, n, day, reviewerExpenses } from '@/lib/mobileReports'
import { REVIEWER_HOLDER } from '@/lib/mobileReports'
import { expensesReport } from '@/lib/reportsData'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await reportAccount(request)
  if (a.error) return a.error
  const { user, accountId, params } = a
  if (user.isReviewer || REVIEWER_ACCOUNT_CODES.includes(accountId)) return NextResponse.json({ ...reviewerExpenses(accountId, params), holder: REVIEWER_HOLDER })
  const res = await expensesReport(accountId, params)
  return NextResponse.json(res.body, { status: res.status })
}
