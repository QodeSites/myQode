// GET /api/mobile/portfolio/nav?accountId=QAW0009&period=1Y
// Both portfolio and benchmark are rebased to 100 at the first portfolio date in the window.
// Benchmark gaps are forward-filled to align with portfolio dates.
// period=ALL is the web's NAV chart (performance/page.tsx enrichedData) exactly:
//   • when the first NAV isn't 10, a synthetic NAV=10 row is prepended one day before inception
//   • the benchmark anchor is the index value ON the inception date (the web fetches the index from
//     inception onwards); with no index row that day the web shows no benchmark line, so neither do we
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyName, getStrategyBenchmark, getPrefix } from '@/lib/strategyConfig'
import { normaliseAccountCode } from '@/lib/utils'
import { reviewerMockNav } from '@/lib/reviewerMock'

const PERIOD_DAYS: Record<string, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '3Y': 1095,
  'ALL': 99999,
}

// 'YYYY-MM-DD' → the day before, as the web computes its synthetic inception date
const dayBefore = (d: string) => { const t = new Date(d.split('T')[0] + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().split('T')[0] }

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  const period = (searchParams.get('period') || '1Y').toUpperCase()
  if (user!.isReviewer) return NextResponse.json(reviewerMockNav(accountId ?? 'DEMO001'))

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

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['1Y']
  const benchmarkIndex = getStrategyBenchmark(accountId)

  try {
    // ── 0. Detect closed account ─────────────────────────────────────────────
    const closedCheckRes = await pool.query(
      `SELECT report_date, portfolio_value FROM public.pms_master_sheet
       WHERE account_code = $1 ORDER BY report_date DESC LIMIT 2`,
      [dbAccountId]
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
        [dbAccountId]
      )
      closedAt = caRes.rows[0]?.report_date ?? null
    }

    // ── 1. Portfolio rows (ASC) ──────────────────────────────────────────────
    // Use parameterized cutoff date instead of INTERVAL string interpolation
    // and parameterized closedAt to avoid any SQL injection surface.
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
      closedAt ? [dbAccountId, cutoffStr, closedAt] : [dbAccountId, cutoffStr]
    )

    const portRows = portResult.rows
    if (portRows.length === 0) {
      return NextResponse.json({
        accountId, period, isClosed, closedAt,
        strategy: { prefix: getPrefix(accountId), name: getStrategyName(accountId), benchmark: benchmarkIndex },
        series: [], minValue: 100, maxValue: 100,
      })
    }

    const windowStart: string = portRows[0].report_date
    const windowEnd: string   = closedAt && closedAt < portRows[portRows.length - 1].report_date
      ? closedAt
      : portRows[portRows.length - 1].report_date
    const isAll = period === 'ALL'
    const firstNav = parseFloat(portRows[0].nav)
    const syntheticDate = isAll && firstNav !== 10 ? dayBefore(String(windowStart)) : null
    const basePortNav = syntheticDate ? 10 : firstNav

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

    // Rebase anchor for benchmark: value on or just before windowStart — for ALL, exactly on inception (web rule)
    const baseBenchNav: number | null = isAll
      ? (benchNavMap[String(windowStart)] ?? null)
      : baseRes.rows.length > 0 ? parseFloat(baseRes.rows[0].nav) : null

    // ── 4. Walk portfolio dates (spine) ASC, forward-fill benchmark ──────────
    const portfolioDates = portRows.map((r: any) => r.report_date as string)
    let lastBenchRaw: number | null = baseBenchNav

    // nav / benchmarkValue are the raw (un-rebased) values, for the chart tooltip — same as the web tooltip.
    const series: { date: string; portfolio: number; benchmark: number | null; nav: number; benchmarkValue: number | null }[] = []

    // the web's synthetic starting point: NAV 10, benchmark rebased to 10 (= 100 here), one day before inception
    if (syntheticDate) series.push({ date: syntheticDate, portfolio: 100, benchmark: baseBenchNav !== null ? 100 : null, nav: 10, benchmarkValue: baseBenchNav })

    for (const date of portfolioDates) {
      // Update last known benchmark raw value on trading days
      if (benchNavMap[date] !== undefined) lastBenchRaw = benchNavMap[date]

      const portRebased =
        basePortNav > 0 ? +(((portNavMap[date] / basePortNav) * 100).toFixed(4)) : 100

      const benchRebased =
        lastBenchRaw !== null && baseBenchNav !== null && baseBenchNav > 0
          ? +(((lastBenchRaw / baseBenchNav) * 100).toFixed(4))
          : null

      series.push({ date, portfolio: portRebased, benchmark: benchRebased, nav: portNavMap[date], benchmarkValue: lastBenchRaw })
    }

    // ── 5. Min / max across both series for Y-axis scaling ───────────────────
    const allValues: number[] = []
    for (const s of series) {
      allValues.push(s.portfolio)
      if (s.benchmark !== null) allValues.push(s.benchmark)
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
      series,           // ASC, portfolio starts at 100, benchmark starts at 100
      minValue: allValues.length ? +Math.min(...allValues).toFixed(2) : 100,
      maxValue: allValues.length ? +Math.max(...allValues).toFixed(2) : 100,
    })
  } catch (err) {
    console.error('[mobile/portfolio/nav]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
