// GET /api/mobile/portfolio/combined-performance?accountId={ownerId}
// Performance for the owner/group aggregate view.
// Uses the same pre-computed approach as the web version:
//   pms_master_sheet WHERE account_code = accountId (no runtime SUM).
// Benchmark: always NIFTY 50 for combined/aggregate views.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { REVIEWER_MOCK_COMBINED_PERFORMANCE } from '@/lib/reviewerMock'

const COMBINED_BENCHMARK = 'NIFTY 50'

function formatDate(d: Date | string | null): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function businessDaysAgo(date: Date, days: number): Date {
  const target = new Date(date)
  let count = 0
  while (count < days) {
    target.setDate(target.getDate() - 1)
    const dow = target.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return target
}

function simpleReturn(current: number, past: number | null): number | null {
  if (past == null || past === 0) return null
  return +(((current / past - 1) * 100).toFixed(2))
}

function cagrReturn(current: number, past: number | null, years: number): number | null {
  if (past == null || past === 0) return null
  return +(((Math.pow(current / past, 1 / years) - 1) * 100).toFixed(2))
}

function inceptionReturn(current: number, past: number | null, inceptionDateStr: string, latestDateStr: string): number | null {
  if (past == null || past === 0) return null
  const days = (new Date(latestDateStr).getTime() - new Date(inceptionDateStr).getTime()) / (1000 * 60 * 60 * 24)
  const years = days / 365.25
  if (years >= 1) return +(((Math.pow(current / past, 1 / years) - 1) * 100).toFixed(2))
  return +(((current / past - 1) * 100).toFixed(2))
}

function navOnOrBefore(rows: any[], cutoff: Date, dateKey: string, navKey: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (new Date(rows[i][dateKey]) <= cutoff) return parseFloat(rows[i][navKey])
  }
  return null
}

function benchNavOnOrBefore(rows: any[], cutoff: Date): number | null {
  for (const r of rows) {
    if (new Date(r.date) <= cutoff) return parseFloat(r.nav)
  }
  return null
}

const isMonthEnd = (d: Date) => {
  const n = new Date(d)
  n.setDate(n.getDate() + 1)
  return n.getMonth() !== d.getMonth()
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_PERFORMANCE)

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // --- Portfolio data from pre-computed row ---
    const historyResult = await pool.query(
      `SELECT report_date, nav, portfolio_value, drawdown_percent, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = $1
       ORDER BY report_date ASC`,
      [accountId]
    )

    const rows = historyResult.rows
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data found' }, { status: 404 })
    }

    // Detect closed account: find last row with portfolio_value > 0
    let lastNonZeroIdx = rows.length - 1
    while (lastNonZeroIdx >= 0 && parseFloat(rows[lastNonZeroIdx].portfolio_value || 0) === 0) {
      lastNonZeroIdx--
    }
    const isClosed = lastNonZeroIdx < rows.length - 1
    const closedAtRaw: string | null = isClosed && lastNonZeroIdx >= 0 ? rows[lastNonZeroIdx].report_date : null
    const activeRows = isClosed && lastNonZeroIdx >= 0 ? rows.slice(0, lastNonZeroIdx + 1) : rows

    const latest = activeRows[activeRows.length - 1]
    const first = activeRows[0]
    const latestNav: number = parseFloat(latest.nav)
    const latestValue: number = parseFloat(latest.portfolio_value)
    const latestDate: string = latest.report_date
    const inceptionDate: string = first.report_date
    const firstNav: number = parseFloat(first.nav)

    const amountInvested: number = activeRows.reduce((sum: number, r: any) => {
      return sum + parseFloat(r.cash_in_out || 0)
    }, 0)

    const totalReturns = latestValue - amountInvested
    const returnsPercent = inceptionReturn(latestNav, firstNav, inceptionDate, latestDate) ?? 0

    // ── Trailing return helpers (NAV-based, ASC) ──────────────────────────────
    const latestDateObj = new Date(latestDate)

    const getMonthTarget = (months: number): Date => {
      const t = new Date(latestDateObj)
      if (isMonthEnd(latestDateObj)) {
        t.setMonth(t.getMonth() - months + 1, 0)
      } else {
        t.setMonth(t.getMonth() - months)
      }
      return t
    }

    const nav1W  = navOnOrBefore(activeRows, new Date(latestDateObj.getTime() - 7 * 86400000), 'report_date', 'nav')
    const nav10D = navOnOrBefore(activeRows, businessDaysAgo(latestDateObj, 10), 'report_date', 'nav')
    const nav1M  = navOnOrBefore(activeRows, getMonthTarget(1),  'report_date', 'nav')
    const nav3M  = navOnOrBefore(activeRows, getMonthTarget(3),  'report_date', 'nav')
    const nav6M  = navOnOrBefore(activeRows, getMonthTarget(6),  'report_date', 'nav')
    const nav1Y  = navOnOrBefore(activeRows, getMonthTarget(12), 'report_date', 'nav')
    const nav3Y  = navOnOrBefore(activeRows, getMonthTarget(36), 'report_date', 'nav')

    // Max drawdown from the pre-computed column
    const maxDDRaw = activeRows.reduce((min: number, r: any) => {
      const v = parseFloat(r.drawdown_percent || 0)
      return v < min ? v : min
    }, 0)

    const portfolioTrailing = {
      w1:   simpleReturn(latestNav, nav1W),
      d10:  simpleReturn(latestNav, nav10D),
      m1:   simpleReturn(latestNav, nav1M),
      m3:   simpleReturn(latestNav, nav3M),
      m6:   simpleReturn(latestNav, nav6M),
      y1:   cagrReturn(latestNav, nav1Y, 1),
      y3:   cagrReturn(latestNav, nav3Y, 3),
      currentDD: parseFloat(latest.drawdown_percent || 0),
      maxDD: +maxDDRaw.toFixed(2),
      sinceInception: inceptionReturn(latestNav, firstNav, inceptionDate, latestDate),
    }

    // ── NIFTY 50 benchmark trailing returns ───────────────────────────────────
    type BenchTrailing = {
      w1: number | null; d10: number | null; m1: number | null; m3: number | null;
      m6: number | null; y1: number | null; y3: number | null;
      currentDD: number | null; maxDD: number | null; sinceInception: number | null;
    }
    let benchmarkTrailing: BenchTrailing = {
      w1: null, d10: null, m1: null, m3: null,
      m6: null, y1: null, y3: null,
      currentDD: null, maxDD: null, sinceInception: null,
    }

    try {
      const benchEndDate = closedAtRaw ?? latestDate
      const benchResult = await db2.query(
        `SELECT date, nav
         FROM public.tblresearch_new
         WHERE indices = $1
           AND date >= $2
           AND date <= $3
         ORDER BY date DESC`,
        [COMBINED_BENCHMARK, inceptionDate, benchEndDate]
      )

      const bRows = benchResult.rows // DESC
      if (bRows.length > 0) {
        const latestBench = parseFloat(bRows[0].nav)
        const latestBenchDate = new Date(bRows[0].date)

        const bIsMonthEnd = isMonthEnd(latestBenchDate)
        const getBMonthTarget = (months: number): Date => {
          const t = new Date(latestBenchDate)
          if (bIsMonthEnd) {
            t.setMonth(t.getMonth() - months + 1, 0)
          } else {
            t.setMonth(t.getMonth() - months)
          }
          return t
        }

        const b1W  = benchNavOnOrBefore(bRows, new Date(latestBenchDate.getTime() - 7 * 86400000))
        const b10D = benchNavOnOrBefore(bRows, businessDaysAgo(latestBenchDate, 10))
        const b1M  = benchNavOnOrBefore(bRows, getBMonthTarget(1))
        const b3M  = benchNavOnOrBefore(bRows, getBMonthTarget(3))
        const b6M  = benchNavOnOrBefore(bRows, getBMonthTarget(6))
        const b1Y  = benchNavOnOrBefore(bRows, getBMonthTarget(12))
        const b3Y  = benchNavOnOrBefore(bRows, getBMonthTarget(36))
        const inceptionBench = parseFloat(bRows[bRows.length - 1].nav)
        const inceptionBenchDate = bRows[bRows.length - 1].date

        // Benchmark drawdown (peak-to-valley, walking ASC)
        const bAsc = [...bRows].reverse()
        let bPeak = parseFloat(bAsc[0].nav)
        let benchMaxDD = 0
        let benchCurrentDD = 0
        for (const r of bAsc) {
          const v = parseFloat(r.nav)
          if (v > bPeak) bPeak = v
          const dd = bPeak > 0 ? ((v - bPeak) / bPeak) * 100 : 0
          if (dd < benchMaxDD) benchMaxDD = dd
          benchCurrentDD = dd
        }

        benchmarkTrailing = {
          w1:   simpleReturn(latestBench, b1W),
          d10:  simpleReturn(latestBench, b10D),
          m1:   simpleReturn(latestBench, b1M),
          m3:   simpleReturn(latestBench, b3M),
          m6:   simpleReturn(latestBench, b6M),
          y1:   cagrReturn(latestBench, b1Y, 1),
          y3:   cagrReturn(latestBench, b3Y, 3),
          currentDD: +benchCurrentDD.toFixed(2),
          maxDD: +benchMaxDD.toFixed(2),
          sinceInception: inceptionReturn(latestBench, inceptionBench, inceptionBenchDate, bRows[0].date),
        }
      }
    } catch (benchErr) {
      console.warn('[mobile/portfolio/combined-performance] benchmark fetch failed:', benchErr)
    }

    return NextResponse.json({
      accountId,
      isClosed,
      closedAt: closedAtRaw ? formatDate(closedAtRaw) : null,
      strategy: {
        benchmark: COMBINED_BENCHMARK,
      },
      amountInvested: +amountInvested.toFixed(2),
      currentValue: +latestValue.toFixed(2),
      totalReturns: +totalReturns.toFixed(2),
      returnsPercent,
      isNegative: totalReturns < 0,
      inceptionDate: formatDate(inceptionDate),
      dataAsOf: formatDate(latestDate),
      grossValue: +latestValue.toFixed(2),
      trailingReturns: {
        portfolio: portfolioTrailing,
        benchmark: benchmarkTrailing,
      },
    })
  } catch (err) {
    console.error('[mobile/portfolio/combined-performance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
