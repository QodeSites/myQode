// GET /api/mobile/portfolio/combined-nav?accountIds=QAW00037,QFH00035&period=1Y
// NAV chart for the owner-level "all strategies" combined view.
// Sums portfolio_value across all accounts per date, then rebases to 100 at window start.
// Benchmark: NIFTY 50 (same fallback used by the web version for combined views).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { REVIEWER_MOCK_COMBINED_NAV } from '@/lib/reviewerMock'

const PERIOD_DAYS: Record<string, number> = {
  '1W': 7, '1M': 30, '3M': 90, '6M': 180,
  '1Y': 365, '3Y': 1095, 'ALL': 99999,
}

const COMBINED_BENCHMARK = 'NIFTY 50'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const param = searchParams.get('accountIds')
  const period = (searchParams.get('period') || '1Y').toUpperCase()

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_NAV)

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

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['1Y']

  try {
    // ── 0. Detect closed ─────────────────────────────────────────────────────
    const closedCheckRes = await pool.query(
      `SELECT report_date, SUM(portfolio_value) AS combined_value
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
       GROUP BY report_date
       ORDER BY report_date DESC
       LIMIT 2`,
      [accountIds]
    )
    const last2 = closedCheckRes.rows
    const isClosed = last2.length >= 2 &&
      parseFloat(last2[0].combined_value || 0) === 0 &&
      parseFloat(last2[1].combined_value || 0) === 0
    let closedAt: string | null = null
    if (isClosed) {
      const caRes = await pool.query(
        `SELECT report_date FROM (
           SELECT report_date, SUM(portfolio_value) AS combined_value
           FROM public.pms_master_sheet
           WHERE account_code = ANY($1)
           GROUP BY report_date
           ORDER BY report_date DESC
         ) t WHERE combined_value > 0 LIMIT 1`,
        [accountIds]
      )
      closedAt = caRes.rows[0]?.report_date
        ? String(caRes.rows[0].report_date).split('T')[0]
        : null
    }

    // ── 1. Portfolio rows in the selected window (ASC) ───────────────────────
    const result = await pool.query(
      `SELECT report_date, SUM(portfolio_value) AS combined_value
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
         AND report_date >= CURRENT_DATE - INTERVAL '${days} days'
         ${closedAt ? `AND report_date <= '${closedAt}'` : ''}
       GROUP BY report_date
       ORDER BY report_date ASC`,
      [accountIds]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ accountIds, period, isClosed, closedAt, series: [], minValue: 100, maxValue: 100, benchmark: COMBINED_BENCHMARK })
    }

    const rows = result.rows
    const windowStart: string = String(rows[0].report_date).split('T')[0]
    const windowEnd: string   = closedAt ?? String(rows[rows.length - 1].report_date).split('T')[0]
    const baseValue = parseFloat(rows[0].combined_value)

    // ── 2. Benchmark anchor value at or just before windowStart ─────────────
    const baseRes = await db2.query(
      `SELECT nav FROM public.tblresearch_new
       WHERE indices = $1 AND date <= $2
       ORDER BY date DESC LIMIT 1`,
      [COMBINED_BENCHMARK, windowStart]
    )

    // ── 3. Benchmark rows inside the window (ASC) ────────────────────────────
    const benchResult = await db2.query(
      `SELECT date, nav
       FROM public.tblresearch_new
       WHERE indices = $1
         AND date >= $2
         AND date <= $3
       ORDER BY date ASC`,
      [COMBINED_BENCHMARK, windowStart, windowEnd]
    )

    const benchNavMap: Record<string, number> = {}
    for (const r of benchResult.rows) benchNavMap[String(r.date).split('T')[0]] = parseFloat(r.nav)

    const baseBenchNav: number | null =
      baseRes.rows.length > 0 ? parseFloat(baseRes.rows[0].nav) : null

    // ── 4. Build series: walk portfolio dates (spine), forward-fill benchmark ─
    let lastBenchRaw: number | null = baseBenchNav

    const series = rows.map((r: any) => {
      const date = String(r.report_date).split('T')[0]
      const val = parseFloat(r.combined_value)

      if (benchNavMap[date] !== undefined) lastBenchRaw = benchNavMap[date]

      const portfolio = baseValue > 0 ? +(((val / baseValue) * 100).toFixed(4)) : 100
      const benchmark =
        lastBenchRaw !== null && baseBenchNav !== null && baseBenchNav > 0
          ? +(((lastBenchRaw / baseBenchNav) * 100).toFixed(4))
          : null

      return { date, portfolio, benchmark }
    })

    // ── 5. Min / max across both series for Y-axis scaling ───────────────────
    const allValues: number[] = []
    for (const s of series) {
      allValues.push(s.portfolio)
      if (s.benchmark !== null) allValues.push(s.benchmark)
    }

    return NextResponse.json({
      accountIds,
      period,
      isClosed,
      closedAt,
      benchmark: COMBINED_BENCHMARK,
      series,
      minValue: allValues.length ? +Math.min(...allValues).toFixed(2) : 100,
      maxValue: allValues.length ? +Math.max(...allValues).toFixed(2) : 100,
    })
  } catch (err) {
    console.error('[mobile/portfolio/combined-nav]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
