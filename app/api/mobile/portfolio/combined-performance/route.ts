// GET /api/mobile/portfolio/combined-performance?accountIds=QAW00037,QFH00035,QGF00032
// Aggregated performance for multiple accounts (owner-level "all strategies" view).
// Merges each account's daily rows by date, summing portfolio_value and cash_in_out.
// All accountIds must be present in the JWT accountCodes.
// Benchmark: NIFTY 50 (same fallback used by the web version for combined views).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { REVIEWER_MOCK_COMBINED_PERFORMANCE } from '@/lib/reviewerMock'

const COMBINED_BENCHMARK = 'NIFTY 50'

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
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

function valueOnOrBefore(rows: { date: string; portfolioValue: number }[], cutoff: Date): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (new Date(rows[i].date) <= cutoff) return rows[i].portfolioValue
  }
  return null
}

// Find closest nav on or before a cutoff date in a DESC-sorted array
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
  const param = searchParams.get('accountIds')

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_PERFORMANCE)

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
      `SELECT account_code, report_date, portfolio_value, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
       ORDER BY report_date ASC`,
      [accountIds]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'No data found' }, { status: 404 })
    }

    // Merge by date: sum portfolio_value and cash_in_out across all accounts
    const dateMap: Record<string, { portfolioValue: number; cashInOut: number }> = {}
    for (const row of result.rows) {
      const date = String(row.report_date).split('T')[0]
      const pv = parseFloat(row.portfolio_value || 0)
      const cf = parseFloat(row.cash_in_out || 0)
      if (!dateMap[date]) dateMap[date] = { portfolioValue: 0, cashInOut: 0 }
      dateMap[date].portfolioValue += pv
      dateMap[date].cashInOut += cf
    }

    const combined = Object.keys(dateMap).sort().map(date => ({
      date,
      portfolioValue: dateMap[date].portfolioValue,
      cashInOut: dateMap[date].cashInOut,
    }))

    // Detect closed account: find last combined row with portfolioValue > 0
    let lastNonZeroIdx = combined.length - 1
    while (lastNonZeroIdx >= 0 && combined[lastNonZeroIdx].portfolioValue === 0) lastNonZeroIdx--
    const isClosed = lastNonZeroIdx < combined.length - 1
    const closedAtRaw = isClosed && lastNonZeroIdx >= 0 ? combined[lastNonZeroIdx].date : null
    const activeRows = isClosed && lastNonZeroIdx >= 0 ? combined.slice(0, lastNonZeroIdx + 1) : combined

    const first = activeRows[0]
    const latest = activeRows[activeRows.length - 1]
    const inceptionDate = first.date
    const latestDate = latest.date
    const currentValue = latest.portfolioValue
    const firstValue = first.portfolioValue

    const amountInvested = activeRows.reduce((sum, r) => sum + r.cashInOut, 0)
    const totalReturns = currentValue - amountInvested
    const returnsPercent = inceptionReturn(currentValue, firstValue, inceptionDate, latestDate) ?? 0

    // ── Portfolio trailing returns ────────────────────────────────────────────
    const latestDateObj = new Date(latestDate)

    const getMonthTarget = (months: number): Date => {
      const t = new Date(latestDateObj)
      if (isMonthEnd(latestDateObj)) t.setMonth(t.getMonth() - months + 1, 0)
      else t.setMonth(t.getMonth() - months)
      return t
    }

    const v1W  = valueOnOrBefore(activeRows, new Date(latestDateObj.getTime() - 7 * 86400000))
    const v10D = valueOnOrBefore(activeRows, businessDaysAgo(latestDateObj, 10))
    const v1M  = valueOnOrBefore(activeRows, getMonthTarget(1))
    const v3M  = valueOnOrBefore(activeRows, getMonthTarget(3))
    const v6M  = valueOnOrBefore(activeRows, getMonthTarget(6))
    const v1Y  = valueOnOrBefore(activeRows, getMonthTarget(12))
    const v3Y  = valueOnOrBefore(activeRows, getMonthTarget(36))

    // Max drawdown on combined portfolio value
    let peak = -Infinity
    let maxDD = 0
    let currentDD = 0
    for (const r of activeRows) {
      if (r.portfolioValue > peak) peak = r.portfolioValue
      const dd = peak > 0 ? ((r.portfolioValue - peak) / peak) * 100 : 0
      if (dd < maxDD) maxDD = dd
      currentDD = dd
    }

    const portfolioTrailing = {
      w1:   simpleReturn(currentValue, v1W),
      d10:  simpleReturn(currentValue, v10D),
      m1:   simpleReturn(currentValue, v1M),
      m3:   simpleReturn(currentValue, v3M),
      m6:   simpleReturn(currentValue, v6M),
      y1:   simpleReturn(currentValue, v1Y),
      y3:   cagrReturn(currentValue, v3Y, 3),
      currentDD: +currentDD.toFixed(2),
      maxDD: +maxDD.toFixed(2),
      sinceInception: inceptionReturn(currentValue, firstValue, inceptionDate, latestDate),
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
          y1:   simpleReturn(latestBench, b1Y),
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
      accountIds,
      isClosed,
      closedAt: closedAtRaw ? formatDate(closedAtRaw) : null,
      benchmark: COMBINED_BENCHMARK,
      amountInvested: +amountInvested.toFixed(2),
      currentValue: +currentValue.toFixed(2),
      totalReturns: +totalReturns.toFixed(2),
      returnsPercent,
      isNegative: totalReturns < 0,
      inceptionDate: formatDate(inceptionDate),
      dataAsOf: formatDate(latestDate),
      grossValue: +currentValue.toFixed(2),
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
