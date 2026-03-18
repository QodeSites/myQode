// GET /api/mobile/portfolio/nav?accountId=QFH0008&period=1Y
// Both portfolio and benchmark are rebased to 100 at the first portfolio date in the window.
// Benchmark gaps are forward-filled to align with portfolio dates.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyName, getStrategyBenchmark, getPrefix } from '@/lib/strategyConfig'

const PERIOD_DAYS: Record<string, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '3Y': 1095,
  'ALL': 99999,
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  const period = (searchParams.get('period') || '1Y').toUpperCase()

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }
  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['1Y']
  const benchmarkIndex = getStrategyBenchmark(accountId)

  try {
    // ── 1. Portfolio rows (ASC) ──────────────────────────────────────────────
    const portResult = await pool.query(
      `SELECT report_date, nav
       FROM public.pms_master_sheet
       WHERE account_code = $1
         AND report_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY report_date ASC`,
      [accountId]
    )

    const portRows = portResult.rows
    if (portRows.length === 0) {
      return NextResponse.json({
        accountId, period,
        strategy: { prefix: getPrefix(accountId), name: getStrategyName(accountId), benchmark: benchmarkIndex },
        series: [], minValue: 100, maxValue: 100,
      })
    }

    const windowStart: string = portRows[0].report_date
    const windowEnd: string   = portRows[portRows.length - 1].report_date
    const basePortNav = parseFloat(portRows[0].nav)

    // Build a map: date → raw portfolio nav
    const portNavMap: Record<string, number> = {}
    for (const r of portRows) portNavMap[r.report_date] = parseFloat(r.nav)

    // ── 2. Benchmark – get value on or before windowStart as the rebase anchor ─
    const baseRes = await db2.query(
      `SELECT nav FROM public.tblresearch_new
       WHERE indices = $1 AND date <= $2
       ORDER BY date DESC LIMIT 1`,
      [benchmarkIndex, windowStart]
    )

    // ── 3. Benchmark rows inside the window (ASC) ────────────────────────────
    const benchResult = await db2.query(
      `SELECT date, nav
       FROM public.tblresearch_new
       WHERE indices = $1
         AND date >= $2
         AND date <= $3
       ORDER BY date ASC`,
      [benchmarkIndex, windowStart, windowEnd]
    )

    // Build a map: date → raw benchmark nav
    const benchNavMap: Record<string, number> = {}
    for (const r of benchResult.rows) benchNavMap[r.date] = parseFloat(r.nav)

    // Rebase anchor for benchmark: value on or just before windowStart
    const baseBenchNav: number | null =
      baseRes.rows.length > 0 ? parseFloat(baseRes.rows[0].nav) : null

    // ── 4. Walk portfolio dates (spine) ASC, forward-fill benchmark ──────────
    const portfolioDates = portRows.map((r: any) => r.report_date as string)
    let lastBenchRaw: number | null = baseBenchNav

    const series: { date: string; portfolio: number; benchmark: number | null }[] = []

    for (const date of portfolioDates) {
      // Update last known benchmark raw value on trading days
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
      strategy: {
        prefix: getPrefix(accountId),
        name: getStrategyName(accountId),
        benchmark: benchmarkIndex,
      },
      period,
      series,           // ASC, portfolio starts at 100, benchmark starts at 100
      minValue: allValues.length ? +Math.min(...allValues).toFixed(2) : 100,
      maxValue: allValues.length ? +Math.max(...allValues).toFixed(2) : 100,
    })
  } catch (err) {
    console.error('[mobile/portfolio/nav]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
