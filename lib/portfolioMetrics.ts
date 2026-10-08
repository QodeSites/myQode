// Key risk/return metrics for one strategy account or an owner / group aggregate, from its full daily NAV
// (pms_master_sheet) and its benchmark index (tblresearch_new), since inception:
//
//   CAGR          (NAV_end / NAV_start)^(365.25 / days) − 1. NAV_start is 10, the PMS convention the charts use, when
//                 the first NAV isn't already 10. Not annualised under a year (null, with `years`).
//   Volatility    standard deviation of daily returns × √252, on the benchmark's trading days (no weekend zeros).
//   Sharpe        (CAGR − 6.5%) ÷ volatility. Risk-free rate 6.5% (Indian 91-day T-bill), as in PMS factsheets.
//   Beta          cov(portfolio, benchmark) ÷ var(benchmark), daily returns on common trading days.
//   Alpha         CAGR − benchmark CAGR over the same dates (simple excess return a year).
//   Max drawdown  deepest fall of the NAV from its running peak.
//   Best month    highest calendar-month return (month-end NAV to month-end NAV); worst month likewise.
//   Positive months  calendar months with a return above zero, of all months (the partial current month included).
//   The benchmark's best / worst / positive months come from its own month-end levels over the same dates.
//   months / bench.months: every calendar month's return ({ month: 'YYYY-MM', ret }), so a client can show one year.
//   Sortino       (CAGR − 6.5%) ÷ downside deviation: daily returns below 0, squared, over ALL days (n), √, × √252
//                 (Portfolio Visualizer's convention, as qodeinvest.com).
//   Information ratio  mean ÷ standard deviation of the monthly active return (portfolio − benchmark month), × √12.
//                 Needs IR_MIN_MONTHS months.
//   Upside / downside capture  over the days the benchmark rose (fell): the portfolio's geometric mean daily return ÷
//                 the benchmark's, × 100. Needs 3 such days each.
//   bench.volatility / sharpe / sortino: the same measures for the benchmark over the same days.
//
//   Under a year: `cagr` / `benchCagr` stay null (no annualised headline return), but alpha, Sharpe and Sortino use the
//   absolute return since inception annualised the same way, (NAV_end / NAV_start)^(365.25 / days) − 1, from
//   ANNUALISE_MIN_DAYS on (`annReturn` / `benchAnnReturn`, `annualised: true`). The information ratio needs
//   IR_MIN_MONTHS months. Decided 8 Oct 2026.
//
// Decided 6 Oct 2026: risk-free 6.5%, alpha as CAGR − benchmark CAGR.
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyBenchmark } from '@/lib/strategyConfig'
import { closedCutoff } from '@/lib/accountClosure'

export const RISK_FREE = 0.065
export const ANNUALISE_MIN_DAYS = 90   // ratios for a younger account: from about 3 months of history
export const IR_MIN_MONTHS = 3
const COMBINED_BENCHMARK = 'NIFTY 50'   // owner / group views, as combined-nav
const DAY = 86400000
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10)
const r4 = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000)

export type PortfolioMetrics = {
  accountId: string; benchmark: string; from: string; to: string; years: number
  cagr: number | null; benchCagr: number | null; alpha: number | null
  annReturn: number | null; benchAnnReturn: number | null; annualised: boolean
  volatility: number | null; sharpe: number | null; beta: number | null; maxDrawdown: number | null
  bestMonth: { month: string; ret: number } | null; worstMonth: { month: string; ret: number } | null
  positiveMonths: { up: number; total: number } | null; months: MonthRet[]
  sortino: number | null; informationRatio: number | null; upsideCapture: number | null; downsideCapture: number | null
  bench: { bestMonth: MonthRet | null; worstMonth: MonthRet | null; positiveMonths: { up: number; total: number } | null; months: MonthRet[]
    volatility: number | null; sharpe: number | null; sortino: number | null }
  riskFree: number
}

type MonthRet = { month: string; ret: number }
// Calendar-month returns from a dated series: each month's last value against the previous month's last
// (the first month against `start`), then the best, the worst and how many were above zero.
function monthStats(series: { d: string; v: number }[], start: number) {
  const monthEnd = new Map<string, number>()
  for (const x of series) monthEnd.set(x.d.slice(0, 7), x.v)
  let prev = start, best: MonthRet | null = null, worst: MonthRet | null = null, up = 0, total = 0
  const months: MonthRet[] = []
  for (const [m, v] of monthEnd) {
    const ret = v / prev - 1; prev = v
    months.push({ month: m, ret: r4(ret)! })
    total++; if (ret > 0) up++
    if (!best || ret > best.ret) best = { month: m, ret }
    if (!worst || ret < worst.ret) worst = { month: m, ret }
  }
  const r = (x: MonthRet | null) => (x ? { month: x.month, ret: r4(x.ret)! } : null)
  return { bestMonth: r(best), worstMonth: r(worst), positiveMonths: total ? { up, total } : null, months }
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
  // …and a closed account (lib/accountClosure.ts): at the day before it closed
  const cut = isStrategy ? (await closedCutoff(accountId)).closedAt : null
  const last0 = pv?.last ? iso(pv.last) : null
  const last = cut && (!last0 || cut < last0) ? cut : last0
  const navs = rows.map((r: any) => ({ d: iso(r.report_date), v: Number(r.nav) })).filter(x => !last || x.d <= last)
  if (navs.length < 2) return null

  const from = navs[0].d, to = navs[navs.length - 1].d
  const startNav = Math.abs(navs[0].v - 10) > 1e-9 ? 10 : navs[0].v
  const days = (Date.parse(to) - Date.parse(from)) / DAY + (startNav === 10 && navs[0].v !== 10 ? 1 : 0)
  const years = days / 365.25   // as performance/route.ts's since-inception return, so the two never differ by a rounding
  const endNav = navs[navs.length - 1].v
  const canAnn = years >= 1 || days >= ANNUALISE_MIN_DAYS
  const annReturn = canAnn ? Math.pow(endNav / startNav, 1 / years) - 1 : null   // the return since inception, a year
  const cagr = years >= 1 ? annReturn : null

  // benchmark: anchor on or before the first day, then the window
  const b = (await db2.query(
    `(SELECT date, nav::float8 AS nav FROM public.tblresearch_new WHERE indices = $1 AND date <= $2 ORDER BY date DESC LIMIT 1)
     UNION ALL
     (SELECT date, nav::float8 AS nav FROM public.tblresearch_new WHERE indices = $1 AND date > $2 AND date <= $3 ORDER BY date)`,
    [benchmark, from, to])).rows.map((r: any) => ({ d: iso(r.date), v: Number(r.nav) })).sort((x: any, y: any) => x.d.localeCompare(y.d))
  const benchAnnReturn = canAnn && b.length > 1 ? Math.pow(b[b.length - 1].v / b[0].v, 1 / years) - 1 : null
  const benchCagr = years >= 1 ? benchAnnReturn : null

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
  const sharpe = annReturn != null && volatility ? (annReturn - RISK_FREE) / volatility : null
  const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)) }
  const benchVol = rb.length > 20 ? sdOf(rb) * Math.sqrt(252) : null
  const benchSharpe = benchAnnReturn != null && benchVol ? (benchAnnReturn - RISK_FREE) / benchVol : null
  const sortinoOf = (r: number[], g: number | null) => {
    if (r.length <= 20 || g == null) return null
    const dn = r.filter(x => x < 0)
    if (dn.length < 2) return null
    const dsd = Math.sqrt(dn.reduce((t, x) => t + x * x, 0) / r.length) * Math.sqrt(252)
    return dsd > 0 ? (g - RISK_FREE) / dsd : null
  }
  const sortino = sortinoOf(rp, annReturn), benchSortino = sortinoOf(rb, benchAnnReturn)
  // capture: geometric mean daily return on the benchmark's up (down) days, portfolio ÷ benchmark
  const gm = (xs: number[]) => Math.pow(xs.reduce((t, x) => t * (1 + x), 1), 1 / xs.length) - 1
  const upI = rb.map((x, i) => (x > 0 ? i : -1)).filter(i => i >= 0), dnI = rb.map((x, i) => (x < 0 ? i : -1)).filter(i => i >= 0)
  const capture = (ix: number[]) => { if (ix.length < 3) return null; const c = gm(ix.map(i => rp[i])) / gm(ix.map(i => rb[i])) * 100; return isFinite(c) ? c : null }
  const upsideCapture = upI.length >= 3 && dnI.length >= 3 ? capture(upI) : null
  const downsideCapture = upI.length >= 3 && dnI.length >= 3 ? capture(dnI) : null

  // max drawdown on every NAV day (from the starting 10)
  let peak = startNav, maxDrawdown = 0
  for (const x of navs) { peak = Math.max(peak, x.v); maxDrawdown = Math.min(maxDrawdown, x.v / peak - 1) }

  // calendar months: the portfolio from its starting NAV; the benchmark from its level on (or before) the first day,
  // its later points only (the anchor is the start, not a month of its own)
  const pm = monthStats(navs, startNav)
  const bm = b.length > 1 ? monthStats(b.slice(1), b[0].v) : { bestMonth: null, worstMonth: null, positiveMonths: null, months: [] }
  // information ratio: monthly active returns (the months both have)
  const bMon = new Map(bm.months.map(x => [x.month, x.ret]))
  const active = pm.months.filter(x => bMon.has(x.month)).map(x => x.ret - bMon.get(x.month)!)
  let informationRatio: number | null = null
  if (canAnn && active.length >= IR_MIN_MONTHS) {   // same 90-day start as the other ratios
    const m = mean(active), sd = Math.sqrt(active.reduce((t, x) => t + x * x, 0) / active.length - m * m)
    informationRatio = sd > 0 ? (m / sd) * Math.sqrt(12) : null
  }
  const r2 = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100)

  return {
    accountId, benchmark, from, to, years: Math.round(years * 100) / 100,
    cagr: r4(cagr), benchCagr: r4(benchCagr), alpha: annReturn != null && benchAnnReturn != null ? r4(annReturn - benchAnnReturn) : null,
    annReturn: r4(annReturn), benchAnnReturn: r4(benchAnnReturn), annualised: years < 1 && annReturn != null,
    volatility: r4(volatility), sharpe: sharpe == null ? null : Math.round(sharpe * 100) / 100, beta: beta == null ? null : Math.round(beta * 100) / 100,
    maxDrawdown: r4(maxDrawdown),
    bestMonth: pm.bestMonth, worstMonth: pm.worstMonth, positiveMonths: pm.positiveMonths, months: pm.months,
    sortino: r2(sortino), informationRatio: r2(informationRatio), upsideCapture: r2(upsideCapture), downsideCapture: r2(downsideCapture),
    bench: { ...bm, volatility: r4(benchVol), sharpe: r2(benchSharpe), sortino: r2(benchSortino) },
    riskFree: RISK_FREE,
  }
}
