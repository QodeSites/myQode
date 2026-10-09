// Key risk/return metrics for one strategy account or an owner / group aggregate, from its full daily NAV
// (pms_master_sheet) and its benchmark index (tblresearch_new), since inception:
//
//   CAGR          (NAV_end / NAV_start)^(365.25 / days) − 1. NAV_start is 10, the PMS convention the charts use, when
//                 the first NAV isn't already 10. Not annualised under a year (null, with `years`).
//   Volatility    standard deviation of daily returns × √365, on EVERY calendar day (weekends and holidays at 0% when
//                 the NAV doesn't move; the benchmark carries its last close). Decided 9 Oct 2026 (was trading days × √252).
//   Sharpe        (CAGR − 6.5%) ÷ volatility. Risk-free rate 6.5% (Indian 91-day T-bill), as in PMS factsheets.
//   Beta          cov(portfolio, benchmark) ÷ var(benchmark), daily returns on every calendar day (as volatility).
//   Alpha         CAGR − benchmark CAGR over the same dates (simple excess return a year).
//   Max drawdown  deepest fall of the NAV from its running peak.
//   Best month    highest calendar-month return (month-end NAV to month-end NAV); worst month likewise.
//   Positive months  calendar months with a return above zero, of all months (the partial current month included).
//   The benchmark's best / worst / positive months come from its own month-end levels over the same dates.
//   months / bench.months: every calendar month's return ({ month: 'YYYY-MM', ret }), so a client can show one year.
//   Sortino       (CAGR − 6.5%) ÷ downside deviation: daily returns below 0, squared, over ALL days (n), √, × √365
//                 (Portfolio Visualizer's convention, as qodeinvest.com).
//   Information ratio  mean ÷ standard deviation of the monthly active return (portfolio − benchmark month), × √12.
//                 Needs IR_MIN_MONTHS months.
//   Upside / downside capture  over the days the benchmark rose (fell): the portfolio's geometric mean daily return ÷
//                 the benchmark's, × 100. Needs 3 such days each.
//   bench.volatility / sharpe / sortino: the same measures for the benchmark over the same days.
//
//   Under a year: `cagr` / `benchCagr` stay null (no annualised headline return) and so does `alpha`: the app shows
//   alpha under a year as the period return on the investor's own money minus the benchmark's (/portfolio/irr), so
//   it agrees with the "Return on your money" row. Sharpe and Sortino are annualised from ANNUALISE_MIN_DAYS on, with
//   `annReturn` / `benchAnnReturn` = (NAV_end / NAV_start)^(365.25 / days) − 1 (`annualised: true`); the information
//   ratio needs IR_MIN_MONTHS months. Decided 8 Oct 2026 (quant).
//   Sharpe formula: SHARPE_METHOD (env METRICS_SHARPE), until the quant settles it:
//     'cagr'  (default) (annualised return − 6.5%) ÷ volatility
//     'daily' mean of daily excess returns (r − 6.5% ÷ 365) ÷ their std dev × √365
//
// Decided 6 Oct 2026: risk-free 6.5%, alpha as CAGR − benchmark CAGR.
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { getStrategyBenchmark } from '@/lib/strategyConfig'
import { closedCutoff } from '@/lib/accountClosure'

export const RISK_FREE = 0.065
export const DAYS_A_YEAR = 365   // calendar-day annualisation (every calendar day's return), 9 Oct 2026
export const ANNUALISE_MIN_DAYS = 30   // ratios for a younger account: from 1 month of history (was 90 days; Sanket, 9 Oct 2026)
export const IR_MIN_MONTHS = 2          // two monthly returns at least (a spread needs two)
export const SHARPE_METHOD: 'cagr' | 'daily' = process.env.METRICS_SHARPE === 'daily' ? 'daily' : 'cagr'
const COMBINED_BENCHMARK = 'NIFTY 50'   // owner / group views, as combined-nav
const DAY = 86400000
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10)
const r4 = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000)

export type PortfolioMetrics = {
  accountId: string; benchmark: string; from: string; to: string; years: number
  cagr: number | null; benchCagr: number | null; alpha: number | null
  annReturn: number | null; benchAnnReturn: number | null; annualised: boolean; sharpeMethod: 'cagr' | 'daily'
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

// Several ids (an owner's open accounts, or a family's members, as the app combines them on the device): one daily
// series the way the app's combineFamily() and the backend's group rows build it — value and cash summed per day up to
// the earliest latest day, NAV chained from 10 as NAV_t = NAV_(t-1) × V_t / (V_(t-1) + CF_t) — against NIFTY 50.
// Added 8 Oct 2026 (owner views of open accounts only had no metrics).
async function combinedNavs(ids: string[]): Promise<{ d: string; v: number }[]> {
  const rows = (await pool.query(
    `SELECT account_code, report_date, portfolio_value::float8 AS v, COALESCE(cash_in_out, 0)::float8 AS cf
       FROM public.pms_master_sheet WHERE account_code = ANY($1) ORDER BY report_date`, [ids])).rows
  const lastOf = new Map<string, string>()
  for (const r of rows) lastOf.set(r.account_code, iso(r.report_date))
  if (!lastOf.size) return []
  const lastDay = [...lastOf.values()].sort()[0]
  const days = new Map<string, { v: number; cf: number }>()
  for (const r of rows) {
    const d = iso(r.report_date)
    if (d > lastDay) continue
    const o = days.get(d) || { v: 0, cf: 0 }
    o.v += Number(r.v) || 0; o.cf += Number(r.cf) || 0
    days.set(d, o)
  }
  let nav = 10, prev = 0
  return [...days.keys()].sort().map(d => {
    const { v, cf } = days.get(d)!
    if (prev + cf > 0 && prev > 0) nav *= v / (prev + cf)
    prev = v
    return { d, v: nav }
  })
}

export async function portfolioMetrics(accountIds: string | string[]): Promise<PortfolioMetrics | null> {
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean)
  const multi = ids.length > 1
  const accountId = multi ? ids.join(',') : ids[0]
  const isStrategy = !multi && /^Q[A-Z]{2}\d/i.test(accountId)
  const benchmark = isStrategy ? getStrategyBenchmark(accountId) : COMBINED_BENCHMARK
  const rows = multi ? [] : (await pool.query(
    `SELECT report_date, nav::float8 AS nav FROM public.pms_master_sheet
      WHERE account_code = $1 AND nav IS NOT NULL AND nav > 0 ORDER BY report_date`, [accountId])).rows
  // a closed account: stop at the last day it held money
  const pv = multi ? null : (await pool.query(
    `SELECT max(report_date) AS last FROM public.pms_master_sheet WHERE account_code = $1 AND portfolio_value > 0`, [accountId])).rows[0]
  // …and a closed account (lib/accountClosure.ts): at the day before it closed
  const cut = isStrategy ? (await closedCutoff(accountId)).closedAt : null
  const last0 = pv?.last ? iso(pv.last) : null
  const last = cut && (!last0 || cut < last0) ? cut : last0
  const navs = multi ? await combinedNavs(ids)
    : rows.map((r: any) => ({ d: iso(r.report_date), v: Number(r.nav) })).filter(x => !last || x.d <= last)
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

  // daily returns on every calendar day the portfolio has a NAV (weekends included); the benchmark's level on a day it
  // did not trade is its last close (so its return that day is 0, like the portfolio's)
  const levelOn = (() => { let j = -1; return (d: string) => { while (j + 1 < b.length && b[j + 1].d <= d) j++; return j >= 0 ? b[j].v : null } })()
  const spine = navs.map(x => ({ d: x.d, p: x.v, bv: levelOn(x.d) })).filter(x => x.bv != null) as { d: string; p: number; bv: number }[]
  const rp: number[] = [], rb: number[] = []
  for (let i = 1; i < spine.length; i++) {
    rp.push(spine[i].p / spine[i - 1].p - 1); rb.push(spine[i].bv / spine[i - 1].bv - 1)
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  let volatility: number | null = null, beta: number | null = null
  if (rp.length > 20) {
    const mp = mean(rp), mb = mean(rb)
    const varP = rp.reduce((s, x) => s + (x - mp) ** 2, 0) / (rp.length - 1)
    const varB = rb.reduce((s, x) => s + (x - mb) ** 2, 0) / (rb.length - 1)
    const cov = rp.reduce((s, x, i) => s + (x - mp) * (rb[i] - mb), 0) / (rp.length - 1)
    volatility = Math.sqrt(varP) * Math.sqrt(DAYS_A_YEAR)
    beta = varB > 0 ? cov / varB : null
  }
  // Sharpe: the formula is a setting (SHARPE_METHOD); both need the same history (canAnn) and > 20 daily returns
  const dailySharpe = (r: number[]) => {
    if (r.length <= 20) return null
    const ex = r.map(x => x - RISK_FREE / DAYS_A_YEAR), m = mean(ex)
    const sd = Math.sqrt(ex.reduce((t, x) => t + (x - m) ** 2, 0) / (ex.length - 1))
    return sd > 0 ? (m / sd) * Math.sqrt(DAYS_A_YEAR) : null
  }
  const sharpeOf = (r: number[], ann: number | null, vol: number | null) =>
    ann == null ? null : SHARPE_METHOD === 'daily' ? dailySharpe(r) : vol ? (ann - RISK_FREE) / vol : null
  const sharpe = sharpeOf(rp, annReturn, volatility)
  const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)) }
  const benchVol = rb.length > 20 ? sdOf(rb) * Math.sqrt(DAYS_A_YEAR) : null
  const benchSharpe = sharpeOf(rb, benchAnnReturn, benchVol)
  const sortinoOf = (r: number[], g: number | null) => {
    if (r.length <= 20 || g == null) return null
    const dn = r.filter(x => x < 0)
    if (dn.length < 2) return null
    const dsd = Math.sqrt(dn.reduce((t, x) => t + x * x, 0) / r.length) * Math.sqrt(DAYS_A_YEAR)
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
  if (canAnn && active.length >= IR_MIN_MONTHS) {   // same 1-month start as the other ratios
    const m = mean(active), sd = Math.sqrt(active.reduce((t, x) => t + x * x, 0) / active.length - m * m)
    informationRatio = sd > 0 ? (m / sd) * Math.sqrt(12) : null
  }
  const r2 = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100)

  return {
    accountId, benchmark, from, to, years: Math.round(years * 100) / 100,
    cagr: r4(cagr), benchCagr: r4(benchCagr), alpha: cagr != null && benchCagr != null ? r4(cagr - benchCagr) : null,
    annReturn: r4(annReturn), benchAnnReturn: r4(benchAnnReturn), annualised: years < 1 && annReturn != null, sharpeMethod: SHARPE_METHOD,
    volatility: r4(volatility), sharpe: sharpe == null ? null : Math.round(sharpe * 100) / 100, beta: beta == null ? null : Math.round(beta * 100) / 100,
    maxDrawdown: r4(maxDrawdown),
    bestMonth: pm.bestMonth, worstMonth: pm.worstMonth, positiveMonths: pm.positiveMonths, months: pm.months,
    sortino: r2(sortino), informationRatio: r2(informationRatio), upsideCapture: r2(upsideCapture), downsideCapture: r2(downsideCapture),
    bench: { ...bm, volatility: r4(benchVol), sharpe: r2(benchSharpe), sortino: r2(benchSortino) },
    riskFree: RISK_FREE,
  }
}
