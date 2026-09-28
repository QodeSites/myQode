// GET /api/reports/{transactions|capital-gains|expenses|factsheet|pnl|balance-sheet}?accountId=QAW00012&…
// The web portal's Reports page. Same queries and parameters as /api/mobile/reports/* (lib/reportsData.ts), but
// authorised by the signed web session (lib/webSession.ts) — never by the unsigned qode-clients cookie.
import { NextRequest, NextResponse } from 'next/server'
import { webSessionCodes } from '@/lib/webSession'
import { transactionsReport, capitalGainsReport, expensesReport, factsheetReport, pnlReport, balanceSheetReport, ReportResult } from '@/lib/reportsData'

export const dynamic = 'force-dynamic'

const HANDLERS: Record<string, (accountId: string, params: URLSearchParams) => Promise<ReportResult>> = {
  transactions: transactionsReport,
  'capital-gains': capitalGainsReport,
  expenses: expensesReport,
  factsheet: factsheetReport,
  pnl: pnlReport,
  'balance-sheet': balanceSheetReport,
}
// These two also take a comma list of accounts ("All accounts": the statement summed); every code must be in the session.
const MULTI = new Set(['pnl', 'balance-sheet'])

export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params
  const handler = HANDLERS[report]
  if (!handler) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const codes = await webSessionCodes()
  if (!codes) return NextResponse.json({ error: 'Your session has expired. Please sign in again.', code: 'NO_SESSION' }, { status: 401 })

  const search = new URL(request.url).searchParams
  const accountId = search.get('accountId') ?? codes[0]
  const asked = MULTI.has(report) ? (accountId || '').split(',').map(s => s.trim()).filter(Boolean) : [accountId]
  if (!accountId || !asked.length || !asked.every(c => c && codes.includes(c))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const res = await handler(accountId, search)
    return NextResponse.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[web/reports]', report, err)
    return NextResponse.json({ error: 'Could not load this report' }, { status: 500 })
  }
}
