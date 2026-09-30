// GET /api/mobile/reports/transactions?accountId=QAW00012&group=all|trades|money|income|charges|other
//     &from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50&offset=0
// The account's transaction statement from pms_clients_tracker.pms_transactions (Nuvama WealthSpectrum sync),
// newest first, with per-group totals for the same date range. See lib/mobileReports.ts for the groups.
import { NextRequest, NextResponse } from 'next/server'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'
import { reportAccount, page, isoDate, n, day, TXN_GROUPS, HIDDEN_FROM_ALL, groupOf, directionOf, reviewerTransactions } from '@/lib/mobileReports'
import { REVIEWER_HOLDER } from '@/lib/mobileReports'
import { transactionsReport } from '@/lib/reportsData'

import { isManagedCode } from '@/lib/managedAccounts'
import { managedTransactions } from '@/lib/managedReports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await reportAccount(request)
  if (a.error) return a.error
  const { user, accountId, params } = a
  // Managed account (QAC…): built from qode_portfolios (lib/managedReports.ts), same response shape
  if (isManagedCode(accountId)) {
    try { return NextResponse.json(await managedTransactions(accountId, params)) }
    catch (e) { console.error('[reports/transactions managed]', e); return NextResponse.json({ error: 'Could not load this report' }, { status: 500 }) }
  }
  if (user.isReviewer || REVIEWER_ACCOUNT_CODES.includes(accountId)) return NextResponse.json({ ...reviewerTransactions(accountId, params), holder: REVIEWER_HOLDER })
  const res = await transactionsReport(accountId, params)
  return NextResponse.json(res.body, { status: res.status })
}
