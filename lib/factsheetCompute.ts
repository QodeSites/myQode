// Portfolio fact sheet computed by Qode for any as-of date, in the same shape as the Nuvama snapshots that
// scripts/import-nuvama-reports.mjs loads into pms_clients_tracker.pms_factsheet (served by lib/reportsData.ts).
//
// Definitions (reconciled against Nuvama's 25 Sep 2026 fact sheets, see the notes at each step):
//   valueDate      last public.pms_master_sheet row on or before asOf (the daily NAV / value series)
//   portfolioValue pms_master_sheet.portfolio_value on valueDate (= Nuvama's value incl. dividend/interest receivable)
//   contribution   sum of the positive daily cash_in_out from inception to valueDate
//   withdrawal     minus the sum of the negative daily cash_in_out (corpus withdrawals, switches out, TDS on payouts)
//   profitLoss     portfolioValue - contribution + withdrawal
//   returns        time-weighted, from the pms_master_sheet NAV (it starts at 10 the day before inception):
//                  1m / 3m / 1y = NAV(valueDate) / NAV(same calendar day 1, 3, 12 months earlier) - 1, null when that
//                  day is before inception; "Since" = NAV / 10 - 1, annualised when inception is over a year back.
//                  Benchmark over the same windows from public.tblresearch_new. Nuvama uses total-return indices
//                  (NIFTY50TRI, S&P BSE 500 TRI); only the price indices are on file, so the benchmark is labelled as such.
//   holdings       pms_clients_tracker.pms_holdings on the last holding_date on or before asOf, one row per security;
//                  bank balance and receivable/payable merged into "Cash"; the gap to portfolioValue (dividends and
//                  interest receivable, which are not a holding row) shown as "Dividend / Interest receivable". Holding
//                  dates before Sep 2026 have no bank balance rows: there the gap is shown as "Cash and receivables".
//   irrSI / irr1Y  money-weighted return (XIRR, lib/irr.ts) from the same daily portfolio_value and cash_in_out: since
//                  inception to valueDate (annualised when a year or more, else the period's own return, see
//                  irrSIAnnualised), and over the 1y window of the TWRR (opening value → end value), null without a year
//                  of history. Percent, 2 dp. Optional: Nuvama's stored fact sheets do not carry them.
//   sectors        holdings summed by sector. Sector = Nuvama's label for that security (from any imported fact sheet),
//                  else the NSE basic industry (public.stocks), else the asset class rules in sectorOf().
import { query as q1 } from '@/lib/db1'
import { query as qMain } from '@/lib/db'
import { day } from '@/lib/mobileReports'
import { windowIrr, type DailyPoint } from '@/lib/irr'

type Row = Record<string, any>
const r2 = (x: number) => Math.round(x * 100) / 100
const pct = (x: number | null) => (x == null || !Number.isFinite(x) ? null : r2(x * 100))

// Calendar helpers on yyyy-mm-dd strings (UTC, so no time zone drift).
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => fromMs(toMs(d) + n * 86400000)
/** Same calendar day `months` earlier; clamped to the month's last day (31 Mar - 1m = 28/29 Feb). */
const monthsBack = (d: string, months: number) => {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 - months, dd = +d.slice(8, 10)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return fromMs(Date.UTC(y, m, Math.min(dd, last)))
}
const ddmmyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`

/** Last value on or before `d` in an ascending [date, value] series (null when none). */
function onOrBefore(series: [string, number][], d: string): number | null {
  let lo = 0, hi = series.length - 1, ans = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (series[mid][0] <= d) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  return ans < 0 ? null : series[ans][1]
}

// Nuvama's benchmark per strategy → the price index on file (public.tblresearch_new.indices) and its label.
const BENCH: Record<string, { index: string; name: string }> = {
  NIFTY50TRI: { index: 'NIFTY 50', name: 'NIFTY 50 (price index)' },
  'S&P BSE 500 Total Return Index': { index: 'BSE500', name: 'S&P BSE 500 (price index)' },
}
// Without an imported fact sheet: Nuvama's benchmark by strategy prefix (QLF's bond index is not on file).
const BENCH_BY_PREFIX: Record<string, string> = { QAW: 'NIFTY50TRI', QGF: 'S&P BSE 500 Total Return Index', QTF: 'S&P BSE 500 Total Return Index', QFH: 'S&P BSE 500 Total Return Index' }
const benchFor = (accountCode: string, nuvamaName: string | null) =>
  BENCH[nuvamaName || BENCH_BY_PREFIX[accountCode.slice(0, 3).toUpperCase()] || ''] || null

export const CASH = 'Cash and Equivalent', RECEIVABLE = 'Dividend / Interest receivable'
/** Fallback sector when Nuvama has not labelled the security in any imported fact sheet. */
export function sectorOf(h: Row): string {
  const t = h.security_type, cls = String(h.astclsname || ''), detail = String(h.detailtypename || ''), name = String(h.security_name || '')
  if (t === 'c' || cls === CASH) return CASH
  if (t === 'o' || t === 'f') return 'Options'
  if (t === 'm') return 'Mutual Fund'
  if (/ETF/i.test(detail)) return /GOLD/i.test(name) ? 'Commodity' : 'Equity'
  if (t === 's') return h.basic_industry || 'Equity (sector not on file)'
  return cls || 'Other'
}
// Display order of the holdings list (Nuvama lists by asset group, then sector).
export const groupRank = (sector: string, h: Row | null) =>
  sector === RECEIVABLE ? 6 : sector === CASH ? 5 : sector === 'Options' ? 4 : sector === 'Commodity' ? 3
    : sector === 'Mutual Fund' || h?.security_type === 'm' ? 2 : 1

/**
 * pms_holdings rows of each account on its own last holding_date on or before asOf, with the resolved labels:
 * nuvama_sector (Nuvama's sector for the security from any imported fact sheet) and basic_industry (public.stocks).
 * One query (pms_holdings has no (account, date) index: one pass picks each account's last date). Shared by the
 * fact sheet and /api/mobile/portfolio/securities; resolve a row's sector with holdingSector().
 */
export function holdingsRows(accountCodes: string[], asOf: string) {
  return q1(
    `WITH h AS (
       SELECT ws_account_code, security_name, security_code, security_type, astclsname, detailtypename, holding_qty,
              unitcost, cost, mktprice, mktvalue, holding_date,
              max(holding_date) OVER (PARTITION BY ws_account_code) AS last_date
         FROM pms_clients_tracker.pms_holdings WHERE ws_account_code = ANY($1) AND holding_date <= $2),
     cur AS (SELECT * FROM h WHERE holding_date = last_date),
     lab AS (
       SELECT DISTINCT ON (x->>'security') x->>'security' AS security, x->>'sector' AS sector
         FROM pms_clients_tracker.pms_factsheet f, jsonb_array_elements(f.holdings) x
        WHERE x->>'security' IN (SELECT security_name FROM cur)
        ORDER BY x->>'security', f.as_of_date DESC)
     SELECT cur.*, lab.sector AS nuvama_sector,
            (SELECT s.basic_industry FROM public.stocks s
              WHERE (s.nse_symbol = cur.security_code OR s.bse_code = cur.security_code) AND s.basic_industry IS NOT NULL LIMIT 1) AS basic_industry
       FROM cur LEFT JOIN lab ON lab.security = cur.security_name`, [accountCodes, asOf])
}
/** Sector of a holdingsRows() row: Nuvama's label, else the NSE industry / asset class rules. */
export const holdingSector = (h: Row): string => h.nuvama_sector || sectorOf(h)

export type ComputedFactsheet = {
  asOf: string; strategy: string | null; inceptionDate: string | null
  contribution: number; withdrawal: number; profitLoss: number; portfolioValue: number; valueDate: string
  returns: { periods: string[]; portfolio: (number | null)[]; benchmark: { name: string; values: (number | null)[] } | null }
  sectors: { sector: string; pct: number | null }[]
  holdings: { security: string; sector: string; value: number; pct: number | null }[]
  holdingsDate: string | null
  computed: true
  irrSI?: number | null
  irrSIAnnualised?: boolean
  irr1Y?: number | null
}

/** Range of dates a fact sheet can be computed for (the account's NAV series). One indexed query. */
export async function factsheetCoverage(accountCode: string): Promise<{ from: string | null; to: string | null }> {
  const r = (await qMain(`SELECT min(report_date) AS f, max(report_date) AS t FROM public.pms_master_sheet WHERE account_code = $1`, [accountCode])).rows[0]
  return { from: day(r?.f), to: day(r?.t) }
}

/**
 * Fact sheet for `accountCode` as of `asOf` (yyyy-mm-dd), from Qode's own data. Null when there is no NAV data on or
 * before asOf. Three queries in parallel, then the benchmark series.
 */
export async function computeFactsheet(accountCode: string, asOf: string): Promise<ComputedFactsheet | null> {
  const [navRes, holdRes, metaRes] = await Promise.all([
    qMain(
      `SELECT report_date, nav, portfolio_value, cash_in_out FROM public.pms_master_sheet
        WHERE account_code = $1 AND report_date <= $2 ORDER BY report_date`, [accountCode, asOf]),
    holdingsRows([accountCode], asOf),
    // Static account facts from the latest imported Nuvama fact sheet, if any: strategy, inception, benchmark.
    q1(
      `SELECT strategy, inception_date, returns->'benchmark'->>'name' AS bench FROM pms_clients_tracker.pms_factsheet
        WHERE account_code = $1 ORDER BY as_of_date DESC LIMIT 1`, [accountCode]),
  ])

  const rows = navRes.rows
  if (!rows.length) return null
  const nav: [string, number][] = rows.map(r => [day(r.report_date)!, Number(r.nav)])
  const last = rows[rows.length - 1]
  const valueDate = day(last.report_date)!
  const firstDate = nav[0][0]
  const meta = metaRes.rows[0]
  const inceptionDate = day(meta?.inception_date) || firstDate
  const portfolioValue = Number(last.portfolio_value) || 0
  let contribution = 0, withdrawal = 0
  for (const r of rows) { const c = Number(r.cash_in_out) || 0; c > 0 ? (contribution += c) : (withdrawal -= c) }

  // ── Returns (TWRR from the NAV) ──
  // A closed account (value 0 on its last row) keeps its final NAV, so its windows end at asOf (1m / 3m show 0%),
  // as in Nuvama's fact sheet. The benchmark is measured over the same windows.
  const closed = portfolioValue === 0 && valueDate < asOf
  const end = closed ? asOf : valueDate
  const bench = benchFor(accountCode, meta?.bench ?? null)
  const siBase = addDays(inceptionDate, -1)
  const benchRows = bench ? (await q1(
    `SELECT date, nav FROM public.tblresearch_new WHERE indices = $1 AND date >= $2 AND date <= $3 ORDER BY date`,
    [bench.index, addDays([siBase, monthsBack(end, 12)].sort()[0], -10), end])).rows : []
  const bSeries: [string, number][] = benchRows.map(r => [day(r.date)!, Number(r.nav)])
  // NAV on a base date: the series value, or the opening 10 on the day before the series starts.
  const navAt = (d: string) => (d >= firstDate ? onOrBefore(nav, d) : d === addDays(firstDate, -1) ? 10 : null)
  const endNav = nav[nav.length - 1][1], endBench = onOrBefore(bSeries, end)
  const periods = ['1m', '3m', '1y', `Since ${ddmmyy(inceptionDate)}`]
  const portfolio: (number | null)[] = [], benchVals: (number | null)[] = []
  for (const m of [1, 3, 12]) {
    const base = monthsBack(end, m), ok = base >= siBase
    const p = ok ? navAt(base) : null
    const b = ok ? onOrBefore(bSeries, base) : null
    portfolio.push(p ? pct(endNav / p - 1) : null)
    benchVals.push(b && endBench ? pct(endBench / b - 1) : null)
  }
  // Since inception: annualised over the account's life (inception day to valueDate, both counted) when over a year.
  const days = (toMs(valueDate) - toMs(siBase)) / 86400000
  const ann = (g: number) => (days > 365.25 ? Math.pow(g, 365.25 / days) - 1 : g - 1)
  portfolio.push(pct(ann(endNav / 10)))
  const bSi = onOrBefore(bSeries, siBase)
  benchVals.push(bSi && endBench ? pct(ann(endBench / bSi)) : null)

  // ── Money-weighted return (XIRR) from the daily value and cash flows ──
  const daily: DailyPoint[] = rows.map(r => ({ date: day(r.report_date)!, value: Number(r.portfolio_value) || 0, flow: Number(r.cash_in_out) || 0 }))
  const irrSi = windowIrr(daily, null, valueDate)
  const base1y = monthsBack(end, 12)
  const irr1y = base1y >= siBase ? windowIrr(daily, base1y, end) : null

  // ── Holdings and sectors ──
  const hRows = holdRes.rows
  const holdingsDate = hRows.length ? day(hRows[0].holding_date) : null
  const items: { security: string; sector: string; value: number; rank: number }[] = []
  let cash = 0, hasCash = false
  for (const h of hRows) {
    const v = Number(h.mktvalue) || 0
    if (h.security_type === 'c') { cash += v; hasCash = true; continue }
    if (!v && !Number(h.holding_qty)) continue
    const sector = holdingSector(h)
    items.push({ security: h.security_name, sector, value: v, rank: groupRank(sector, h) })
  }
  if (hasCash) items.push({ security: 'Cash', sector: CASH, value: cash, rank: groupRank(CASH, null) })
  const held = items.reduce((s, x) => s + x.value, 0)
  // Dividends / interest receivable are in the value but not in the holdings: show the gap when both are the same day.
  // Holdings before Sep 2026 carry no bank balance rows, so there the gap is the cash and the receivables together.
  if (holdingsDate === valueDate && Math.abs(portfolioValue - held) >= 1)
    items.push(hasCash
      ? { security: RECEIVABLE, sector: RECEIVABLE, value: portfolioValue - held, rank: groupRank(RECEIVABLE, null) }
      : { security: 'Cash and receivables', sector: CASH, value: portfolioValue - held, rank: groupRank(CASH, null) })
  const total = holdingsDate === valueDate ? portfolioValue : items.reduce((s, x) => s + x.value, 0)
  const share = (v: number) => r2((v / total) * 100)
  items.sort((a, b) => a.rank - b.rank || a.sector.localeCompare(b.sector) || a.security.localeCompare(b.security, undefined, { sensitivity: 'base' }))
  const bySector = new Map<string, number>()
  for (const x of items) bySector.set(x.sector, (bySector.get(x.sector) || 0) + x.value)
  const live = total >= 1   // a closed account's leftover paise are not a portfolio

  return {
    asOf, strategy: meta?.strategy ?? null, inceptionDate,
    contribution: r2(contribution), withdrawal: r2(withdrawal), profitLoss: r2(portfolioValue - contribution + withdrawal),
    portfolioValue: r2(portfolioValue), valueDate,
    returns: { periods, portfolio, benchmark: bench ? { name: bench.name, values: benchVals } : null },
    sectors: live ? [...bySector].map(([sector, v]) => ({ sector, pct: share(v) })) : [],
    holdings: live ? items.map(x => ({ security: x.security, sector: x.sector, value: r2(x.value), pct: share(x.value) })) : [],
    holdingsDate,
    computed: true,
    irrSI: pct(irrSi.irr), irrSIAnnualised: irrSi.annualised, irr1Y: irr1y ? pct(irr1y.irr) : null,
  }
}
