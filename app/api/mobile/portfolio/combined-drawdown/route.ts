// GET /api/mobile/portfolio/combined-drawdown?accountId={ownerId}&period=1Y
// Drawdown chart for the owner/group aggregate view.
// Uses the same pre-computed approach as the web version:
//   pms_master_sheet WHERE account_code = accountId (no runtime SUM).
// Benchmark: always NIFTY 50 for combined/aggregate views.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { REVIEWER_MOCK_COMBINED_DRAWDOWN } from '@/lib/reviewerMock'

const PERIOD_DAYS: Record<string, number> = {
  '1W': 7, '1M': 30, '3M': 90, '6M': 180,
  '1Y': 365, '3Y': 1095, 'ALL': 99999,
}

const COMBINED_BENCHMARK = 'NIFTY 50'

// Compute running drawdown from an ASC array of { date, nav }.
// Returns a map of date → drawdown % (all values ≤ 0). Peak resets at first point.
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

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_DRAWDOWN)

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['1Y']

  try {
    // ── 0. Detect closed account via pre-computed row ────────────────────────
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
      closedAt = caRes.rows[0]?.report_date ? String(caRes.rows[0].report_date).split('T')[0] : null
    }

    // ── 1. Portfolio rows in the selected window (ASC) ───────────────────────
    const portResult = await pool.query(
      `SELECT report_date, nav
       FROM public.pms_master_sheet
       WHERE account_code = $1
         AND report_date >= CURRENT_DATE - INTERVAL '${days} days'
         ${closedAt ? `AND report_date <= '${closedAt}'` : ''}
       ORDER BY report_date ASC`,
      [accountId]
    )

    const portRows = portResult.rows
    if (portRows.length === 0) {
      return NextResponse.json({
        accountId, period, isClosed, closedAt,
        benchmark: COMBINED_BENCHMARK, series: [],
      })
    }

    const windowStart: string = String(portRows[0].report_date).split('T')[0]
    const windowEnd: string   = closedAt && closedAt < String(portRows[portRows.length - 1].report_date).split('T')[0]
      ? closedAt
      : String(portRows[portRows.length - 1].report_date).split('T')[0]

    // Recompute drawdown from windowStart so first value is always 0
    const portDDMap = computeDrawdownMap(
      portRows.map((r: any) => ({ date: String(r.report_date).split('T')[0], nav: parseFloat(r.nav) }))
    )

    // ── 2. Benchmark – fetch from windowStart so peak resets at same point ───
    const benchResult = await db2.query(
      `SELECT date, nav
       FROM public.tblresearch_new
       WHERE indices = $1
         AND date >= $2
         AND date <= $3
       ORDER BY date ASC`,
      [COMBINED_BENCHMARK, windowStart, windowEnd]
    )

    const benchDDWindow = computeDrawdownMap(
      benchResult.rows.map((r: any) => ({ date: String(r.date).split('T')[0], nav: parseFloat(r.nav) }))
    )

    // ── 3. Align on portfolio dates (spine), forward-fill benchmark DD ───────
    const portfolioDates = portRows.map((r: any) => String(r.report_date).split('T')[0])
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
      period,
      isClosed,
      closedAt,
      benchmark: COMBINED_BENCHMARK,
      series,
    })
  } catch (err) {
    console.error('[mobile/portfolio/combined-drawdown]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
