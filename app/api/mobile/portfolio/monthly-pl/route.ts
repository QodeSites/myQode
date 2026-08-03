// GET /api/mobile/portfolio/monthly-pl?accountId=QAW0009
// Monthly P&L bucketed by year × month, in both % and ₹.
// Calculation matches the web version exactly:
//   % = (endMonthNAV / startMonthNAV − 1) × 100
//   ₹ = endMonthPortfolioValue − startMonthPortfolioValue − netCashFlowsDuringMonth
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { normaliseAccountCode } from '@/lib/utils'
import { reviewerMockMonthlyPL } from '@/lib/reviewerMock'

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
type MonthKey = typeof MONTH_KEYS[number]

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  if (user!.isReviewer) return NextResponse.json(reviewerMockMonthlyPL(accountId ?? 'DEMO001'))

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  // Owner/group ids reach us float-formatted ("58282.0") — pms_clients_master
  // stores them that way, and the snapshot route echoes ownerid straight back to
  // the app. Authorise against either form, since accountCodes may hold the raw
  // suffixed value from the JWT while the app now sends the clean one (or vice
  // versa). Strategy codes like QGF00014 are left untouched by the normaliser.
  const dbAccountId = normaliseAccountCode(accountId)
  const isAuthorised = user!.accountCodes?.some(
    (code) => code === accountId || normaliseAccountCode(code) === dbAccountId
  )
  if (!isAuthorised) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  try {
    const result = await pool.query(
      `SELECT report_date, nav, portfolio_value, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = $1
       ORDER BY report_date ASC`,
      [dbAccountId]
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

    // ── Computation matching web version ─────────────────────────────────────
    // monthData[year][monthIdx0] = { pct, cash, capitalInOut }
    type MonthEntry = { pct: number; cash: number; capitalInOut: number }
    const monthData: Record<number, Record<number, MonthEntry>> = {}
    // yearData[year] = { totalPct, totalCash, yearCash }
    const yearTotals: Record<number, { totalPct: number; totalCash: number; yearCash: number }> = {}

    let prevNav = 0
    let prevValue = 0
    let prevDate: Date | null = null
    let prevYear = 0
    let prevYearMonth: string | null = null   // key: "${year}-${monthIdx0}"

    let monthStartNav = 0
    let monthStartValue = 0
    let monthSumCash = 0

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

    const finalizeMonth = (ymKey: string, nav: number, value: number) => {
      const [ymYear, ymMo] = ymKey.split('-').map(Number)
      const mPct = monthStartNav > 0 ? ((nav / monthStartNav) - 1) * 100 : 0
      const mCash = value - monthStartValue - monthSumCash
      if (!monthData[ymYear]) monthData[ymYear] = {}
      monthData[ymYear][ymMo] = { pct: mPct, cash: mCash, capitalInOut: monthSumCash }
    }

    for (const item of rows) {
      const dateObj = new Date(item.report_date)
      const year = dateObj.getFullYear()
      const mo = dateObj.getMonth()       // 0-indexed
      const ym = `${year}-${mo}`
      const cash = parseFloat(item.cash_in_out || 0)
      const nav = parseFloat(item.nav)
      const pValue = parseFloat(item.portfolio_value || 0)

      const isNewYear = prevDate === null || year !== prevYear
      const isNewMonth = prevDate === null || ym !== prevYearMonth

      if (isNewYear) {
        if (prevYear > 0) finalizeYear(prevYear, prevNav, prevValue, prevDate!)
        yearStartNav = prevDate === null ? nav : prevNav
        yearStartValue = prevDate === null ? 0 : prevValue
        yearStartDate = prevDate === null ? dateObj : prevDate
        yearSumCash = 0
      }

      if (isNewMonth) {
        if (prevYearMonth !== null) finalizeMonth(prevYearMonth, prevNav, prevValue)
        monthStartNav = prevDate === null ? nav : prevNav
        monthStartValue = prevDate === null ? 0 : prevValue
        monthSumCash = 0
        prevYearMonth = ym
      }

      yearSumCash += cash
      monthSumCash += cash

      prevNav = nav
      prevValue = pValue
      prevDate = dateObj
      prevYear = year
    }

    // Finalize last month and last year
    if (prevYearMonth !== null) finalizeMonth(prevYearMonth, prevNav, prevValue)
    if (prevYear > 0) finalizeYear(prevYear, prevNav, prevValue, prevDate!)

    // ── Build response arrays ──────────────────────────────────────────────────
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
    console.error('[mobile/portfolio/monthly-pl]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
