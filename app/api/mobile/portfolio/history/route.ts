// GET /api/mobile/portfolio/history?accountId=QGF00052
// Raw history for ONE strategy account, so the mobile app can build the same three views the web
// performance page offers for accounts with legacy data: Nuvama, Orbis (Legacy), Orbis + Nuvama (Combined).
//   nuvama    – pms_master_sheet rows (same rows as /api/portfolio-history)
//   orbis     – orbis_master_sheet rows for this nuvama_code (same rows /api/auth/client-data attaches)
//   benchmark – the strategy benchmark from the earliest of those dates to the latest
// The app ports the web's client-side maths (createConsolidatedData, trailing returns, P&L, drawdown).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyName, getStrategyBenchmark, getStrategyColor, getPrefix } from '@/lib/strategyConfig'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }
  // Strategy accounts only: owner / group aggregates have no legacy (Orbis) view on the web either.
  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const strategy = {
    prefix: getPrefix(accountId),
    name: getStrategyName(accountId),
    benchmark: getStrategyBenchmark(accountId),
    color: getStrategyColor(accountId),
  }

  if (user!.isReviewer) {
    return NextResponse.json({ accountId, strategy, nuvama: [], orbis: [], orbisMetrics: null, benchmark: [] })
  }

  try {
    const [nuvamaRes, orbisRes] = await Promise.all([
      pool.query(
        `SELECT report_date, nav, portfolio_value, drawdown_percent, cash_in_out
         FROM public.pms_master_sheet
         WHERE account_code = $1
         ORDER BY report_date ASC`,
        [accountId]
      ),
      pool.query(
        `SELECT date, nav, market_value, net_capital_flow, capital_amount
         FROM orbis_master_sheet
         WHERE nuvama_code = $1
         ORDER BY date ASC`,
        [accountId]
      ),
    ])

    const nuvama = nuvamaRes.rows
    const orbis = orbisRes.rows

    // Same rule as /api/auth/client-data: latest non-zero capital and market value.
    let orbisMetrics: { latestCapitalAmount: number; latestMarketValue: number } | null = null
    if (orbis.length > 0) {
      const desc = [...orbis].reverse()
      const cap = desc.find((r: any) => Number(r.capital_amount) > 0)
      const mkt = desc.find((r: any) => Number(r.market_value) > 0)
      orbisMetrics = {
        latestCapitalAmount: cap ? Number(cap.capital_amount) : 0,
        latestMarketValue: mkt ? Number(mkt.market_value) : 0,
      }
    }

    let benchmark: { date: string; nav: number }[] = []
    const first = orbis.length > 0 ? orbis[0].date : nuvama.length > 0 ? nuvama[0].report_date : null
    const lastNuvama = nuvama.length > 0 ? nuvama[nuvama.length - 1].report_date : null
    const lastOrbis = orbis.length > 0 ? orbis[orbis.length - 1].date : null
    const last = lastNuvama && lastOrbis ? (new Date(lastNuvama) > new Date(lastOrbis) ? lastNuvama : lastOrbis) : (lastNuvama ?? lastOrbis)
    if (strategy.benchmark && first && last) {
      try {
        const b = await db2.query(
          `SELECT date, nav
           FROM public.tblresearch_new
           WHERE indices = $1 AND date >= $2 AND date <= $3
           ORDER BY date ASC`,
          [strategy.benchmark, first, last]
        )
        benchmark = b.rows.map((r: any) => ({ date: r.date, nav: parseFloat(r.nav) }))
      } catch (benchErr) {
        console.error('[mobile/portfolio/history] benchmark fetch failed:', benchErr)
      }
    }

    return NextResponse.json({ accountId, strategy, nuvama, orbis, orbisMetrics, benchmark })
  } catch (err) {
    console.error('[mobile/portfolio/history]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
