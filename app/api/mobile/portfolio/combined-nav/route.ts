// GET /api/mobile/portfolio/combined-nav?accountId={ownerId}&period=1Y
// NAV chart for the owner/group aggregate view.
// Uses the same pre-computed approach as the web version:
//   pms_master_sheet WHERE account_code = accountId (no runtime SUM).
// Benchmark: always NIFTY 50 for combined/aggregate views.
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
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  const period = (searchParams.get('period') || '1Y').toUpperCase()

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_NAV)

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
        benchmark: COMBINED_BENCHMARK,
        series: [], minValue: 100, maxValue: 100,
      })
    }

    const windowStart: string = String(portRows[0].report_date).split('T')[0]
    const windowEnd: string   = closedAt && closedAt < String(portRows[portRows.length - 1].report_date).split('T')[0]
      ? closedAt
      : String(portRows[portRows.length - 1].report_date).split('T')[0]
    const basePortNav = parseFloat(portRows[0].nav)

    // Build a map: date → raw portfolio nav
    const portNavMap: Record<string, number> = {}
    for (const r of portRows) portNavMap[String(r.report_date).split('T')[0]] = parseFloat(r.nav)

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

    // ── 4. Walk portfolio dates (spine) ASC, forward-fill benchmark ──────────
    const portfolioDates = portRows.map((r: any) => String(r.report_date).split('T')[0])
    let lastBenchRaw: number | null = baseBenchNav

    const series: { date: string; portfolio: number; benchmark: number | null }[] = []

    for (const date of portfolioDates) {
      if (benchNavMap[date] !== undefined) lastBenchRaw = benchNavMap[date]

      const portRebased =
        basePortNav > 0 ? +(((portNavMap[date] / basePortNav) * 100).toFixed(4)) : 100

      const benchRebased =
        lastBenchRaw !== null && baseBenchNav !== null && baseBenchNav > 0
          ? +(((lastBenchRaw / baseBenchNav) * 100).toFixed(4))
          : null

      series.push({ date, portfolio: portRebased, benchmark: benchRebased })
    }

    // ── 5. Min / max across both series for Y-axis scaling ───────────────────
    const allValues: number[] = []
    for (const s of series) {
      allValues.push(s.portfolio)
      if (s.benchmark !== null) allValues.push(s.benchmark)
    }

    return NextResponse.json({
      accountId,
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
