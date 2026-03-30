// GET /api/mobile/portfolio/combined-quarterly-pl?accountId={ownerId}
// Quarterly P&L for the owner/group aggregate view.
// Uses the same pre-computed approach as the web version:
//   pms_master_sheet WHERE account_code = accountId (no runtime SUM).
// Calculation matches the regular quarterly-pl route exactly (NAV-based %).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { REVIEWER_MOCK_COMBINED_QUARTERLY_PL } from '@/lib/reviewerMock'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_QUARTERLY_PL)

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await pool.query(
      `SELECT report_date, nav, portfolio_value, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = $1
       ORDER BY report_date ASC`,
      [accountId]
    )

    let rows = result.rows
    if (rows.length === 0) {
      return NextResponse.json({ percentData: [], rupeeData: [], isClosed: false, closedAt: null })
    }

    // Detect closed account: find last row with portfolio_value > 0
    let lastNonZeroIdx = rows.length - 1
    while (lastNonZeroIdx >= 0 && parseFloat(rows[lastNonZeroIdx].portfolio_value || 0) === 0) {
      lastNonZeroIdx--
    }
    const isClosed = lastNonZeroIdx < rows.length - 1
    const closedAt: string | null = isClosed && lastNonZeroIdx >= 0 ? rows[lastNonZeroIdx].report_date : null
    if (isClosed && lastNonZeroIdx >= 0) rows = rows.slice(0, lastNonZeroIdx + 1)

    // ── Computation matching the regular quarterly-pl route ───────────────────
    type QEntry = { pct: number; cash: number }
    const qtrData: Record<number, Record<number, QEntry>> = {}
    const yearTotals: Record<number, { totalPct: number; totalCash: number; yearCash: number }> = {}

    let prevNav = 0
    let prevValue = 0
    let prevDate: Date | null = null
    let prevYear = 0
    let prevQuarter = 0

    let quarterStartNav = 0
    let quarterStartValue = 0
    let quarterSumCash = 0

    let yearStartNav = 0
    let yearStartValue = 0
    let yearSumCash = 0
    let yearStartDate: Date | null = null

    // CAGR if period >= 365 days, else absolute
    const smartPct = (endNav: number, startNav: number, startDate: Date | null, endDate: Date): number => {
      if (startNav <= 0) return 0
      if (startDate) {
        const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        if (days >= 365) {
          const years = days / 365.25
          return (Math.pow(endNav / startNav, 1 / years) - 1) * 100
        }
      }
      return (endNav / startNav - 1) * 100
    }

    const finalizeYear = (year: number, nav: number, value: number, endDate: Date) => {
      const yPct = smartPct(nav, yearStartNav, yearStartDate, endDate)
      const yCash = value - yearStartValue - yearSumCash
      yearTotals[year] = { totalPct: yPct, totalCash: yCash, yearCash: yearSumCash }
    }

    const finalizeQuarter = (year: number, qtr: number, nav: number, value: number) => {
      const qPct = quarterStartNav > 0 ? ((nav / quarterStartNav) - 1) * 100 : 0
      const qCash = value - quarterStartValue - quarterSumCash
      if (!qtrData[year]) qtrData[year] = {}
      qtrData[year][qtr] = { pct: qPct, cash: qCash }
    }

    for (const item of rows) {
      const dateObj = new Date(item.report_date)
      const year = dateObj.getFullYear()
      const mo = dateObj.getMonth() + 1     // 1-indexed
      const qtr = Math.ceil(mo / 3)
      const cash = parseFloat(item.cash_in_out || 0)
      const nav = parseFloat(item.nav)
      const pValue = parseFloat(item.portfolio_value || 0)

      const isNewYear = prevDate === null || year !== prevYear
      const isNewQuarter = isNewYear || qtr !== prevQuarter

      if (isNewYear) {
        if (prevYear > 0) finalizeYear(prevYear, prevNav, prevValue, prevDate!)
        yearStartNav = prevDate === null ? nav : prevNav
        yearStartValue = prevDate === null ? 0 : prevValue
        yearStartDate = prevDate === null ? dateObj : prevDate
        yearSumCash = 0
      }

      if (isNewQuarter) {
        if (prevQuarter > 0) finalizeQuarter(prevYear, prevQuarter, prevNav, prevValue)
        quarterStartNav = prevDate === null ? nav : prevNav
        quarterStartValue = prevDate === null ? 0 : prevValue
        quarterSumCash = 0
      }

      yearSumCash += cash
      quarterSumCash += cash

      prevNav = nav
      prevValue = pValue
      prevDate = dateObj
      prevYear = year
      prevQuarter = qtr
    }

    // Finalize last quarter and last year
    if (prevQuarter > 0) finalizeQuarter(prevYear, prevQuarter, prevNav, prevValue)
    if (prevYear > 0) finalizeYear(prevYear, prevNav, prevValue, prevDate!)

    // ── Build response arrays ──────────────────────────────────────────────────
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
