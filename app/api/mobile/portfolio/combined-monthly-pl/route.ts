// GET /api/mobile/portfolio/combined-monthly-pl?accountIds=QAW00037,QFH00035
// Monthly P&L aggregated across multiple accounts.
// Merges daily rows by date (summing portfolio_value and cash_in_out), then
// runs the same month-boundary logic as the single-account monthly-pl route.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { REVIEWER_MOCK_COMBINED_MONTHLY_PL } from '@/lib/reviewerMock'

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
type MonthKey = typeof MONTH_KEYS[number]

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const param = searchParams.get('accountIds')

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_MONTHLY_PL)

  if (!param) {
    return NextResponse.json({ error: 'accountIds is required (comma-separated)' }, { status: 400 })
  }

  const accountIds = param.split(',').map(s => s.trim()).filter(Boolean)
  if (accountIds.length === 0) {
    return NextResponse.json({ error: 'At least one accountId is required' }, { status: 400 })
  }

  const unauthorized = accountIds.filter(id => !user!.accountCodes?.includes(id))
  if (unauthorized.length > 0) {
    return NextResponse.json({ error: 'Forbidden', unauthorized }, { status: 403 })
  }

  try {
    const result = await pool.query(
      `SELECT report_date, SUM(portfolio_value) AS portfolio_value, SUM(cash_in_out) AS cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
       GROUP BY report_date
       ORDER BY report_date ASC`,
      [accountIds]
    )

    let rows = result.rows
    if (rows.length === 0) {
      return NextResponse.json({ percentData: [], rupeeData: [], isClosed: false, closedAt: null })
    }

    // Detect closed
    let lastNonZeroIdx = rows.length - 1
    while (lastNonZeroIdx >= 0 && parseFloat(rows[lastNonZeroIdx].portfolio_value || 0) === 0) lastNonZeroIdx--
    const isClosed = lastNonZeroIdx < rows.length - 1
    const closedAt: string | null = isClosed && lastNonZeroIdx >= 0
      ? String(rows[lastNonZeroIdx].report_date).split('T')[0] : null
    if (isClosed && lastNonZeroIdx >= 0) rows = rows.slice(0, lastNonZeroIdx + 1)

    type MonthEntry = { pct: number; cash: number; capitalInOut: number }
    const monthData: Record<number, Record<number, MonthEntry>> = {}
    const yearTotals: Record<number, { totalPct: number; totalCash: number; yearCash: number }> = {}

    let prevValue = 0
    let prevDate: Date | null = null
    let prevYear = 0
    let prevYearMonth: string | null = null

    // For combined view, use portfolio_value ratio directly (no single-fund NAV available)
    let monthStartValue = 0
    let monthSumCash = 0
    let yearStartValue = 0
    let yearSumCash = 0

    const finalizeYear = (year: number, value: number) => {
      const yPct = yearStartValue > 0 ? ((value / yearStartValue) - 1) * 100 : 0
      const yCash = value - yearStartValue - yearSumCash
      yearTotals[year] = { totalPct: yPct, totalCash: yCash, yearCash: yearSumCash }
    }

    const finalizeMonth = (ymKey: string, value: number) => {
      const [ymYear, ymMo] = ymKey.split('-').map(Number)
      const mPct = monthStartValue > 0 ? ((value / monthStartValue) - 1) * 100 : 0
      const mCash = value - monthStartValue - monthSumCash
      if (!monthData[ymYear]) monthData[ymYear] = {}
      monthData[ymYear][ymMo] = { pct: mPct, cash: mCash, capitalInOut: monthSumCash }
    }

    for (const item of rows) {
      const dateObj = new Date(item.report_date)
      const year = dateObj.getFullYear()
      const mo = dateObj.getMonth()
      const ym = `${year}-${mo}`
      const cash = parseFloat(item.cash_in_out || 0)
      const pValue = parseFloat(item.portfolio_value || 0)

      const isNewYear = prevDate === null || year !== prevYear
      const isNewMonth = prevDate === null || ym !== prevYearMonth

      if (isNewYear) {
        if (prevYear > 0) finalizeYear(prevYear, prevValue)
        yearStartValue = prevDate === null ? 0 : prevValue
        yearSumCash = 0
      }

      if (isNewMonth) {
        if (prevYearMonth !== null) finalizeMonth(prevYearMonth, prevValue)
        monthStartValue = prevDate === null ? 0 : prevValue
        monthSumCash = 0
        prevYearMonth = ym
      }

      yearSumCash += cash
      monthSumCash += cash
      prevValue = pValue
      prevDate = dateObj
      prevYear = year
    }

    if (prevYearMonth !== null) finalizeMonth(prevYearMonth, prevValue)
    if (prevYear > 0) finalizeYear(prevYear, prevValue)

    const years = Object.keys(monthData).map(Number).sort((a, b) => a - b)
    type YearRow = { year: number } & Record<MonthKey, number | null> & { total: number | null; yearCashFlow?: number | null }

    const pctRows: YearRow[] = []
    const rupRows: YearRow[] = []

    for (const yr of years) {
      const pctRow: any = { year: yr, total: yearTotals[yr] ? +yearTotals[yr].totalPct.toFixed(2) : null }
      const rupRow: any = {
        year: yr,
        total: yearTotals[yr] ? +yearTotals[yr].totalCash.toFixed(2) : null,
        yearCashFlow: yearTotals[yr] ? +yearTotals[yr].yearCash.toFixed(2) : null,
      }
      for (let mo = 0; mo < 12; mo++) {
        const mKey = MONTH_KEYS[mo]
        const entry = monthData[yr]?.[mo]
        pctRow[mKey] = entry != null ? +entry.pct.toFixed(2) : null
        rupRow[mKey] = entry != null ? +entry.cash.toFixed(2) : null
      }
      pctRows.push(pctRow)
      rupRows.push(rupRow)
    }

    return NextResponse.json({ percentData: pctRows, rupeeData: rupRows, isClosed, closedAt })
  } catch (err) {
    console.error('[mobile/portfolio/combined-monthly-pl]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
