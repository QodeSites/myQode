// GET /api/mobile/portfolio/combined-quarterly-pl?accountIds=QAW00037,QFH00035
// Quarterly P&L aggregated across multiple accounts.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { REVIEWER_MOCK_COMBINED_QUARTERLY_PL } from '@/lib/reviewerMock'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const param = searchParams.get('accountIds')

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_QUARTERLY_PL)

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

    type QEntry = { pct: number; cash: number }
    const qtrData: Record<number, Record<number, QEntry>> = {}
    const yearTotals: Record<number, { totalPct: number; totalCash: number; yearCash: number }> = {}

    let prevValue = 0
    let prevDate: Date | null = null
    let prevYear = 0
    let prevQuarter = 0
    let quarterStartValue = 0
    let quarterSumCash = 0
    let yearStartValue = 0
    let yearSumCash = 0

    const finalizeYear = (year: number, value: number) => {
      const yPct = yearStartValue > 0 ? ((value / yearStartValue) - 1) * 100 : 0
      const yCash = value - yearStartValue - yearSumCash
      yearTotals[year] = { totalPct: yPct, totalCash: yCash, yearCash: yearSumCash }
    }

    const finalizeQuarter = (year: number, qtr: number, value: number) => {
      const qPct = quarterStartValue > 0 ? ((value / quarterStartValue) - 1) * 100 : 0
      const qCash = value - quarterStartValue - quarterSumCash
      if (!qtrData[year]) qtrData[year] = {}
      qtrData[year][qtr] = { pct: qPct, cash: qCash }
    }

    for (const item of rows) {
      const dateObj = new Date(item.report_date)
      const year = dateObj.getFullYear()
      const mo = dateObj.getMonth() + 1
      const qtr = Math.ceil(mo / 3)
      const cash = parseFloat(item.cash_in_out || 0)
      const pValue = parseFloat(item.portfolio_value || 0)

      const isNewYear = prevDate === null || year !== prevYear
      const isNewQuarter = isNewYear || qtr !== prevQuarter

      if (isNewYear) {
        if (prevYear > 0) finalizeYear(prevYear, prevValue)
        yearStartValue = prevDate === null ? 0 : prevValue
        yearSumCash = 0
      }

      if (isNewQuarter) {
        if (prevQuarter > 0) finalizeQuarter(prevYear, prevQuarter, prevValue)
        quarterStartValue = prevDate === null ? 0 : prevValue
        quarterSumCash = 0
      }

      yearSumCash += cash
      quarterSumCash += cash
      prevValue = pValue
      prevDate = dateObj
      prevYear = year
      prevQuarter = qtr
    }

    if (prevQuarter > 0) finalizeQuarter(prevYear, prevQuarter, prevValue)
    if (prevYear > 0) finalizeYear(prevYear, prevValue)

    const years = Object.keys(qtrData).map(Number).sort((a, b) => a - b)
    type QRow = { year: number; q1: number | null; q2: number | null; q3: number | null; q4: number | null; total: number | null; yearCashFlow?: number | null }

    const percentData: QRow[] = []
    const rupeeData: QRow[] = []

    for (const yr of years) {
      const q = qtrData[yr]
      percentData.push({
        year: yr,
        q1: q[1] != null ? +q[1].pct.toFixed(2) : null,
        q2: q[2] != null ? +q[2].pct.toFixed(2) : null,
        q3: q[3] != null ? +q[3].pct.toFixed(2) : null,
        q4: q[4] != null ? +q[4].pct.toFixed(2) : null,
        total: yearTotals[yr] ? +yearTotals[yr].totalPct.toFixed(2) : null,
      })
      rupeeData.push({
        year: yr,
        q1: q[1] != null ? +q[1].cash.toFixed(2) : null,
        q2: q[2] != null ? +q[2].cash.toFixed(2) : null,
        q3: q[3] != null ? +q[3].cash.toFixed(2) : null,
        q4: q[4] != null ? +q[4].cash.toFixed(2) : null,
        total: yearTotals[yr] ? +yearTotals[yr].totalCash.toFixed(2) : null,
        yearCashFlow: yearTotals[yr] ? +yearTotals[yr].yearCash.toFixed(2) : null,
      })
    }

    return NextResponse.json({ percentData, rupeeData, isClosed, closedAt })
  } catch (err) {
    console.error('[mobile/portfolio/combined-quarterly-pl]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
