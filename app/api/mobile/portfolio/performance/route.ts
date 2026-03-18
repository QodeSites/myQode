// GET /api/mobile/portfolio/performance?accountId=QFH0008
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyName, getStrategyBenchmark, getStrategyColor, getPrefix } from '@/lib/strategyConfig'

function formatDate(d: Date | string | null): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function trailingReturn(current: number, past: number | null): number | null {
  if (past == null || past === 0) return null
  return +((((current - past) / past) * 100).toFixed(2))
}

// Find the closest benchmark value on or before a cutoff date (rows must be DESC by date)
function benchNavOnOrBefore(rows: any[], cutoff: Date): number | null {
  for (const r of rows) {
    if (new Date(r.date) <= cutoff) return parseFloat(r.nav)
  }
  return null
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  try {
    // --- Portfolio data ---
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

    const latest = rows[rows.length - 1]
    const first = rows[0]
    const latestNav: number = parseFloat(latest.nav)
    const latestValue: number = parseFloat(latest.portfolio_value)
    const latestDate: string = latest.report_date
    const inceptionDate: string = first.report_date

    // Amount invested = sum of positive cash flows
    const amountInvested: number = rows.reduce((sum: number, r: any) => {
      const v = parseFloat(r.cash_in_out || 0)
      return v > 0 ? sum + v : sum
    }, 0)

    const totalReturns = latestValue - amountInvested
    const returnsPercent = amountInvested > 0
      ? +((totalReturns / amountInvested) * 100).toFixed(2)
      : 0

    // Portfolio trailing helpers (rows are ASC)
    const navDaysAgo = (days: number): number | null => {
      const cutoff = new Date(latestDate)
      cutoff.setDate(cutoff.getDate() - days)
      for (let i = rows.length - 1; i >= 0; i--) {
        if (new Date(rows[i].report_date) <= cutoff) return parseFloat(rows[i].nav)
      }
      return null
    }
    const navMonthsAgo = (months: number): number | null => {
      const cutoff = new Date(latestDate)
      cutoff.setMonth(cutoff.getMonth() - months)
      for (let i = rows.length - 1; i >= 0; i--) {
        if (new Date(rows[i].report_date) <= cutoff) return parseFloat(rows[i].nav)
      }
      return null
    }

    const maxDD = rows.reduce((min: number, r: any) => {
      const v = parseFloat(r.drawdown_percent || 0)
      return v < min ? v : min
    }, 0)

    const portfolioTrailing = {
      w1: trailingReturn(latestNav, navDaysAgo(7)),
      d10: trailingReturn(latestNav, navDaysAgo(10)),
      m1: trailingReturn(latestNav, navMonthsAgo(1)),
      m3: trailingReturn(latestNav, navMonthsAgo(3)),
      m6: trailingReturn(latestNav, navMonthsAgo(6)),
      y1: trailingReturn(latestNav, navMonthsAgo(12)),
      y3: trailingReturn(latestNav, navMonthsAgo(36)),
      currentDD: parseFloat(latest.drawdown_percent || 0),
      maxDD: +maxDD.toFixed(2),
      sinceInception: trailingReturn(latestNav, parseFloat(first.nav)),
    }

    // --- Benchmark data from tblresearch_new (db2) ---
    const benchmarkIndex = getStrategyBenchmark(accountId)

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
      // Fetch benchmark from inception to latest date (DESC for lookback helpers)
      const benchResult = await db2.query(
        `SELECT date, nav
         FROM public.tblresearch_new
         WHERE indices = $1
           AND date >= $2
           AND date <= $3
         ORDER BY date DESC`,
        [benchmarkIndex, inceptionDate, latestDate]
      )

      const bRows = benchResult.rows // DESC
      if (bRows.length > 0) {
        const latestBench = parseFloat(bRows[0].nav)
        const latestBenchDate = bRows[0].date

        const bDaysAgo = (days: number) => {
          const cutoff = new Date(latestBenchDate)
          cutoff.setDate(cutoff.getDate() - days)
          return benchNavOnOrBefore(bRows, cutoff)
        }
        const bMonthsAgo = (months: number) => {
          const cutoff = new Date(latestBenchDate)
          cutoff.setMonth(cutoff.getMonth() - months)
          return benchNavOnOrBefore(bRows, cutoff)
        }

        // Benchmark value at portfolio inception (last row = oldest in DESC)
        const inceptionBench = parseFloat(bRows[bRows.length - 1].nav)

        // Benchmark drawdown (peak-to-valley, walking ASC)
        const bAsc = [...bRows].reverse()
        let peak = parseFloat(bAsc[0].nav)
        let benchMaxDD = 0
        let benchCurrentDD = 0
        for (const r of bAsc) {
          const v = parseFloat(r.nav)
          if (v > peak) peak = v
          const dd = peak > 0 ? ((v - peak) / peak) * 100 : 0
          if (dd < benchMaxDD) benchMaxDD = dd
          benchCurrentDD = dd
        }

        benchmarkTrailing = {
          w1: trailingReturn(latestBench, bDaysAgo(7)),
          d10: trailingReturn(latestBench, bDaysAgo(10)),
          m1: trailingReturn(latestBench, bMonthsAgo(1)),
          m3: trailingReturn(latestBench, bMonthsAgo(3)),
          m6: trailingReturn(latestBench, bMonthsAgo(6)),
          y1: trailingReturn(latestBench, bMonthsAgo(12)),
          y3: trailingReturn(latestBench, bMonthsAgo(36)),
          currentDD: +benchCurrentDD.toFixed(2),
          maxDD: +benchMaxDD.toFixed(2),
          sinceInception: trailingReturn(latestBench, inceptionBench),
        }
      }
    } catch (benchErr) {
      console.warn('[mobile/portfolio/performance] benchmark fetch failed:', benchErr)
    }

    return NextResponse.json({
      accountId,
      strategy: {
        prefix: getPrefix(accountId),
        name: getStrategyName(accountId),
        benchmark: benchmarkIndex,
        color: getStrategyColor(accountId),
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
    console.error('[mobile/portfolio/performance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
