// Key risk/return metrics for one strategy account or an owner / group aggregate, from its full daily NAV
// (pms_master_sheet) and its benchmark index (tblresearch_new), since inception:
//
//   CAGR          (NAV_end / NAV_start)^(365 / days) − 1. NAV_start is 10, the PMS convention the charts use, when
//                 the first NAV isn't already 10. Not annualised under a year (null, with `years`).
//   Volatility    standard deviation of daily returns × √252, on the benchmark's trading days (no weekend zeros).
//   Sharpe        (CAGR − 6.5%) ÷ volatility. Risk-free rate 6.5% (Indian 91-day T-bill), as in PMS factsheets.
//   Beta          cov(portfolio, benchmark) ÷ var(benchmark), daily returns on common trading days.
//   Alpha         CAGR − benchmark CAGR over the same dates (simple excess return a year).
//   Max drawdown  deepest fall of the NAV from its running peak.
//   Best month    highest calendar-month return (month-end NAV to month-end NAV); worst month likewise.
//
// Decided 6 Oct 2026: risk-free 6.5%, alpha as CAGR − benchmark CAGR.
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyBenchmark } from '@/lib/strategyConfig'

export const RISK_FREE = 0.065
const COMBINED_BENCHMARK = 'NIFTY 50'   // owner / group views, as combined-nav
const DAY = 86400000
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10)
const r4 = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000)

export type PortfolioMetrics = {
  accountId: string; benchmark: string; from: string; to: string; years: number
  cagr: number | null; benchCagr: number | null; alpha: number | null
  volatility: number | null; sharpe: number | null; beta: number | null; maxDrawdown: number | null
  bestMonth: { month: string; ret: number } | null; worstMonth: { month: string; ret: number } | null
  riskFree: number
}

export async function portfolioMetrics(accountId: string): Promise<PortfolioMetrics | null> {
  const isStrategy = /^Q[A-Z]{2}\d/i.test(accountId)
  const benchmark = isStrategy ? getStrategyBenchmark(accountId) : COMBINED_BENCHMARK
  const rows = (await pool.query(
    `SELECT report_date, nav::float8 AS nav FROM public.pms_master_sheet
      WHERE account_code = $1 AND nav IS NOT NULL AND nav > 0 ORDER BY report_date`, [accountId])).rows
  // a closed account: stop at the last day it held money
  const pv = (await pool.query(
    `SELECT max(report_date) AS last FROM public.pms_master_sheet WHERE account_code = $1 AND portfolio_value > 0`, [accountId])).rows[0]
  const last = pv?.last ? iso(pv.last) : null
  const navs = rows.map((r: any) => ({ d: iso(r.report_date), v: Number(r.nav) })).filter(x => !last || x.d <= last)
  if (navs.length < 2) return null

  const from = navs[0].d, to = navs[navs.length - 1].d
  const startNav = Math.abs(navs[0].v - 10) > 1e-9 ? 10 : navs[0].v
  const days = (Date.parse(to) - Date.parse(from)) / DAY + (startNav === 10 && navs[0].v !== 10 ? 1 : 0)
  const years = days / 365
  const endNav = navs[navs.length - 1].v
  const cagr = years >= 1 ? Math.pow(endNav / startNav, 1 / years) - 1 : null

  // benchmark: anchor on or before the first day, then the window
  const b = (await db2.query(
    `(SELECT date, nav::float8 AS nav FROM public.tblresearch_new WHERE indices = $1 AND date <= $2 ORDER BY date DESC LIMIT 1)
     UNION ALL
     (SELECT date, nav::float8 AS nav FROM public.tblresearch_new WHERE indices = $1 AND date > $2 AND date <= $3 ORDER BY date)`,
    [benchmark, from, to])).rows.map((r: any) => ({ d: iso(r.date), v: Number(r.nav) })).sort((x: any, y: any) => x.d.localeCompare(y.d))
  const benchCagr = years >= 1 && b.length > 1 ? Math.pow(b[b.length - 1].v / b[0].v, 1 / years) - 1 : null

  // daily returns on the benchmark's trading days (portfolio NAV taken on the same days)
  const navOn = new Map(navs.map(x => [x.d, x.v]))
  const spine = b.filter((x: any) => navOn.has(x.d))
  const rp: number[] = [], rb: number[] = []
  for (let i = 1; i < spine.length; i++) {
    const p0 = navOn.get(spine[i - 1].d)!, p1 = navOn.get(spine[i].d)!
    rp.push(p1 / p0 - 1); rb.push(spine[i].v / spine[i - 1].v - 1)
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  let volatility: number | null = null, beta: number | null = null
  if (rp.length > 20) {
    const mp = mean(rp), mb = mean(rb)
    const varP = rp.reduce((s, x) => s + (x - mp) ** 2, 0) / (rp.length - 1)
    const varB = rb.reduce((s, x) => s + (x - mb) ** 2, 0) / (rb.length - 1)
    const cov = rp.reduce((s, x, i) => s + (x - mp) * (rb[i] - mb), 0) / (rp.length - 1)
    volatility = Math.sqrt(varP) * Math.sqrt(252)
    beta = varB > 0 ? cov / varB : null
  }
  const sharpe = cagr != null && volatility ? (cagr - RISK_FREE) / volatility : null

  // max drawdown on every NAV day (from the starting 10)
  let peak = startNav, maxDrawdown = 0
  for (const x of navs) { peak = Math.max(peak, x.v); maxDrawdown = Math.min(maxDrawdown, x.v / peak - 1) }

  // calendar months: last NAV of each month vs the previous month's last (the first month from the start)
  const monthEnd = new Map<string, number>()
  for (const x of navs) monthEnd.set(x.d.slice(0, 7), x.v)
  let prev = startNav, best: { month: string; ret: number } | null = null, worst: { month: string; ret: number } | null = null
  for (const [m, v] of monthEnd) {
    const ret = v / prev - 1; prev = v
    if (!best || ret > best.ret) best = { month: m, ret }
    if (!worst || ret < worst.ret) worst = { month: m, ret }
  }

  return {
    accountId, benchmark, from, to, years: Math.round(years * 100) / 100,
    cagr: r4(cagr), benchCagr: r4(benchCagr), alpha: cagr != null && benchCagr != null ? r4(cagr - benchCagr) : null,
    volatility: r4(volatility), sharpe: sharpe == null ? null : Math.round(sharpe * 100) / 100, beta: beta == null ? null : Math.round(beta * 100) / 100,
    maxDrawdown: r4(maxDrawdown),
    bestMonth: best ? { month: best.month, ret: r4(best.ret)! } : null, worstMonth: worst ? { month: worst.month, ret: r4(worst.ret)! } : null,
    riskFree: RISK_FREE,
  }
}
