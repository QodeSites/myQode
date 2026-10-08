// GET /api/mobile/portfolio/irr?accounts=QAW00012,QGF0001
// Money-weighted return (XIRR) next to the NAV-based (time-weighted) returns, from public.pms_master_sheet: the daily
// portfolio_value and cash_in_out of the requested accounts, SUMMED into one series (so an owner or family scope can
// pass its strategy accounts, or its owner / group id — which has its own pre-aggregated rows. Do not mix an owner id
// with its own strategy accounts: they would be counted twice).
//
// accounts: comma list of codes on the token (omitted = the token's strategy accounts). Codes not on the token are
// left out; 403 when none is allowed.
//
// → { asOf, accounts, periods: [{ period: '1Y' | '3Y' | 'SI', irr, annualised, from, to }] }
//   irr         percent, 2 dp; null when the window has no investment, is under 30 days, lacks history (1Y / 3Y
//               starting before inception) or has no root
//   annualised  true when the window spans a year or more; SI under a year is the return over the period itself
//   from / to   the window (1Y / 3Y: the same calendar day 1 / 3 years before asOf; SI: the first day with data)
// Sign convention and flow timing: lib/irr.ts.
//   benchIrr / benchValue  the same money in the benchmark instead (lib/irr.ts benchmarkWindowIrr): each investment
//               buys the index on its date, each withdrawal sells it; benchValue is what would be left today (₹).
//   benchmark   one strategy account: its strategy's benchmark; anything else (owner, family, several accounts):
//               NIFTY 50, as lib/portfolioMetrics.ts. Added 8 Oct 2026.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { day } from '@/lib/mobileReports'
import { normaliseAccountCode } from '@/lib/utils'
import { isAccountCode } from '@/lib/securities'
import { monthsBack, sumSeries, windowIrr, benchmarkWindowIrr, type DailyPoint } from '@/lib/irr'
import db2 from '@/lib/db2'
import { getStrategyBenchmark } from '@/lib/strategyConfig'

export const dynamic = 'force-dynamic'

const pct = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 100)

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const params = new URL(request.url).searchParams
  const asked = (params.get('accounts') || params.get('accountId') || '').split(',').map(s => s.trim()).filter(Boolean)

  // App Store / Play Store reviewer: fixed sample figures.
  if (user!.isReviewer) {
    const asOf = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
    return NextResponse.json({
      asOf, accounts: asked, periods: [
        { period: '1Y', irr: 14.82, annualised: true, from: monthsBack(asOf, 12), to: asOf },
        { period: '3Y', irr: null, annualised: false, from: monthsBack(asOf, 36), to: asOf },
        { period: 'SI', irr: 18.35, annualised: true, from: monthsBack(asOf, 26), to: asOf, benchIrr: 11.2, benchValue: null },
      ], benchmark: 'NIFTY 50',
    })
  }

  const onToken = user!.accountCodes || []
  const codes = asked.length ? [...new Set(asked)].filter(c => onToken.includes(c)) : onToken.filter(isAccountCode)
  if (!codes.length) return NextResponse.json({ error: 'Forbidden', available: onToken }, { status: 403 })
  const dbCodes = [...new Set(codes.map(normaliseAccountCode))]   // owner / group ids are "65941.0" on the token

  try {
    const r = await query(
      `SELECT account_code, report_date, portfolio_value, cash_in_out FROM public.pms_master_sheet
        WHERE account_code = ANY($1) ORDER BY account_code, report_date`, [dbCodes])
    const by = new Map<string, DailyPoint[]>()
    for (const x of r.rows) {
      const list = by.get(x.account_code) || []
      list.push({ date: day(x.report_date)!, value: Number(x.portfolio_value) || 0, flow: Number(x.cash_in_out) || 0 })
      by.set(x.account_code, list)
    }
    const series = sumSeries([...by.values()])
    if (!series.length) return NextResponse.json({ asOf: null, accounts: codes, periods: [] })
    const asOf = series[series.length - 1].date
    // the benchmark's levels from a little before the first day (an anchor on or before it) to asOf
    const benchmark = codes.length === 1 && /^Q[A-Z]{2}\d/i.test(dbCodes[0]) ? getStrategyBenchmark(dbCodes[0]) : 'NIFTY 50'
    const firstDay = monthsBack(series[0].date, 1)
    const lv = (await db2.query(
      `(SELECT date, nav::float8 AS nav FROM public.tblresearch_new WHERE indices = $1 AND date <= $2 ORDER BY date DESC LIMIT 1)
       UNION ALL
       (SELECT date, nav::float8 AS nav FROM public.tblresearch_new WHERE indices = $1 AND date > $2 AND date <= $3 ORDER BY date)`,
      [benchmark, firstDay, asOf])).rows.map((x: any) => ({ d: day(x.date)!, v: Number(x.nav) })).filter(x => x.v > 0).sort((a, b) => a.d.localeCompare(b.d))
    const levelAt = (d: string) => {   // last level on or before d
      let lo = 0, hi = lv.length - 1, ans = -1
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (lv[mid].d <= d) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
      return ans < 0 ? null : lv[ans].v
    }
    const out = (period: '1Y' | '3Y' | 'SI', start: string | null) => {
      const w = windowIrr(series, start, asOf)
      const b = w.irr == null ? null : benchmarkWindowIrr(series, levelAt, start, asOf)
      return { period, irr: pct(w.irr), annualised: w.annualised, from: w.from ?? start, to: asOf,
        benchIrr: b ? pct(b.irr) : null, benchValue: b && b.value != null ? Math.round(b.value * 100) / 100 : null }
    }
    return NextResponse.json({
      asOf, accounts: codes, benchmark,
      periods: [out('1Y', monthsBack(asOf, 12)), out('3Y', monthsBack(asOf, 36)), out('SI', null)],
    })
  } catch (e) {
    console.error('[portfolio/irr]', e)
    return NextResponse.json({ error: 'Could not compute IRR' }, { status: 500 })
  }
}
