// GET /api/mobile/portfolio/drawdown?accountId=QAW0009&period=1Y
// Portfolio drawdown is taken from the DB column (pre-computed from inception).
// Benchmark drawdown is computed from inception so the peak is accurate, then
// both are aligned to the same portfolio dates (benchmark forward-filled).
// First point is always 0.0 for both. Series is ASC.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyName, getStrategyBenchmark, getPrefix } from '@/lib/strategyConfig'
import { reviewerMockDrawdown } from '@/lib/reviewerMock'

const PERIOD_DAYS: Record<string, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '3Y': 1095,
  'ALL': 99999,
}

// Compute running drawdown from an ASC array of { date, nav }.
// Returns a map of date → drawdown % (all values ≤ 0).
function computeDrawdownMap(navRows: { date: string; nav: number }[]): Record<string, number> {
  const result: Record<string, number> = {}
  let peak = -Infinity
  for (const r of navRows) {
    if (r.nav > peak) peak = r.nav
    result[r.date] = peak > 0 ? +(((r.nav - peak) / peak) * 100).toFixed(4) : 0
  }
  return result
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  const period = (searchParams.get('period') || '1Y').toUpperCase()
  if (user!.isReviewer) return NextResponse.json(reviewerMockDrawdown(accountId ?? 'DEMO001'))

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }
  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['1Y']
  const benchmarkIndex = getStrategyBenchmark(accountId)

  try {
    // ── 0. Detect closed account ─────────────────────────────────────────────
    const closedCheckRes = await pool.query(
      `SELECT report_date, portfolio_value FROM public.pms_master_sheet
       WHERE account_code = $1 ORDER BY report_date DESC LIMIT 2`,
      [accountId]
    )
    const last2 = closedCheckRes.rows
    const isClosed = last2.length >= 2 &&
      parseFloat(last2[0].portfolio_value || 0) === 0 &&
      parseFloat(last2[1].portfolio_value || 0) === 0
    let closedAt: string | null = null
    if (isClosed) {
      const caRes = await pool.query(
        `SELECT report_date FROM public.pms_master_sheet
         WHERE account_code = $1 AND portfolio_value > 0
         ORDER BY report_date DESC LIMIT 1`,
        [accountId]
      )
      closedAt = caRes.rows[0]?.report_date ?? null
    }

    // ── 1. Portfolio rows in the window (ASC) ────────────────────────────────
    // Fetch nav so we can recompute drawdown anchored to windowStart (= always 0).
    // Parameterized cutoff date — no INTERVAL string interpolation.
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const portResult = await pool.query(
      closedAt
        ? `SELECT report_date, nav
           FROM public.pms_master_sheet
           WHERE account_code = $1
             AND report_date >= $2
             AND report_date <= $3
           ORDER BY report_date ASC`
        : `SELECT report_date, nav
           FROM public.pms_master_sheet
           WHERE account_code = $1
             AND report_date >= $2
           ORDER BY report_date ASC`,
      closedAt ? [accountId, cutoffStr, closedAt] : [accountId, cutoffStr]
    )

    const portRows = portResult.rows
    if (portRows.length === 0) {
      return NextResponse.json({
        accountId, period, isClosed, closedAt,
        strategy: { prefix: getPrefix(accountId), name: getStrategyName(accountId), benchmark: benchmarkIndex },
        series: [],
      })
    }

    const windowStart: string = portRows[0].report_date
    const windowEnd: string   = closedAt && closedAt < portRows[portRows.length - 1].report_date
      ? closedAt
      : portRows[portRows.length - 1].report_date

    // Recompute drawdown from windowStart so first value is always 0
    const portDDMap = computeDrawdownMap(
      portRows.map((r: any) => ({ date: r.report_date, nav: parseFloat(r.nav) }))
    )

    // ── 2. Benchmark – fetch only from windowStart so peak resets at the same
    //       point the portfolio window starts. Both series begin at 0.0. ──────
    const benchResult = await db2.query(
      `SELECT date, nav
       FROM public.tblresearch_new
       WHERE indices = $1
         AND date >= $2
         AND date <= $3
       ORDER BY date ASC`,
      [benchmarkIndex, windowStart, windowEnd]
    )

    // Compute drawdown with peak anchored at windowStart → first value is always 0
    const benchDDWindow = computeDrawdownMap(
      benchResult.rows.map((r: any) => ({ date: r.date, nav: parseFloat(r.nav) }))
    )

    // ── 3. Align on portfolio dates (spine), forward-fill benchmark DD ───────
    const portfolioDates = portRows.map((r: any) => r.report_date as string)
    let lastBenchDD: number | null = null

    const series: { date: string; portfolio: number; benchmark: number | null }[] = []

    for (const date of portfolioDates) {
      if (benchDDWindow[date] !== undefined) lastBenchDD = benchDDWindow[date]

      series.push({
        date,
        portfolio: portDDMap[date],
        benchmark: lastBenchDD !== null ? +lastBenchDD.toFixed(4) : null,
      })
    }

    return NextResponse.json({
      accountId,
      isClosed,
      closedAt,
      strategy: {
        prefix: getPrefix(accountId),
        name: getStrategyName(accountId),
        benchmark: benchmarkIndex,
      },
      period,
      series,   // ASC, all values ≤ 0
    })
  } catch (err) {
    console.error('[mobile/portfolio/drawdown]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
