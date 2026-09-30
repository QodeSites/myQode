// Reports for managed accounts (QAC…, qode_portfolios), in the same shapes as the Nuvama report routes so the app's
// report screens and PDFs work unchanged:
//   - fact sheet  (GET /api/mobile/reports/factsheet)    : from master_sheet's Total Portfolio Value series (value,
//     money in / out, NAV-based returns vs NIFTY 50) and the account's latest broker holdings
//   - statement   (GET /api/mobile/reports/transactions) : group 'money' = capital in / out in master_sheet NETTED PER
//     MONTH (many accounts book a flow almost every day, e.g. F&O settlements between legs, so single days would show
//     hundreds of false "deposits"; agreed 30 Sep 2026),
//     group 'trades' = equity and mutual fund buys / sells from the tradebooks. Futures & options trades are not in
//     any tradebook, so they are not listed (the app says so).
// There is no capital gains, P&L / balance sheet or expense data for these accounts.
import pool from '@/lib/db'
import db2 from '@/lib/db2'
import { managedHistoryRows, managedStrategy, managedLabel, managedHoldingRows, MANAGED_BENCHMARK } from '@/lib/managedAccounts'
import { isoDate, page } from '@/lib/mobileReports'

const DAY = 86400000
const r2 = (x: number) => Math.round(x * 100) / 100
const iso = (d: any) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10))
const num = (v: any) => Number(v) || 0
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
const monthsBack = (d: string, m: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() - m); return t.toISOString().slice(0, 10) }
const onOrBefore = <T extends { d: string }>(rows: T[], d: string) => { let hit: T | null = null; for (const r of rows) { if (r.d <= d) hit = r; else break } return hit }

/** Capital in / out netted per calendar month: [{ month: 'YYYY-MM', date: last flow date, net, moves }], oldest first. */
function monthlyNet(flows: { d: string; cf: number }[]) {
  const m = new Map<string, { month: string; date: string; net: number; moves: number }>()
  for (const f of flows) {
    if (!f.cf) continue
    const k = f.d.slice(0, 7), x = m.get(k) || { month: k, date: f.d, net: 0, moves: 0 }
    x.net += f.cf; x.moves += 1; if (f.d > x.date) x.date = f.d
    m.set(k, x)
  }
  return [...m.values()].filter(x => Math.abs(x.net) >= 1).sort((a, b) => (a.month < b.month ? -1 : 1))
}

type Pt = { d: string; nav: number }
/** 1m / 3m / 6m / 1y returns (simple) and since inception (annualised after a year), from a NAV series. base: the
 *  NAV the day before the first row (100 for a managed account's own series, the first value for a benchmark). */
function periodReturns(series: Pt[], asOf: string, base: number | null, since: string) {
  const last = onOrBefore(series, asOf)
  if (!last) return [null, null, null, null, null]
  const back = (m: number) => {
    const t = monthsBack(asOf, m)
    if (series[0].d > t) return null
    const p = onOrBefore(series, t)
    return p && p.nav ? r2((last.nav / p.nav - 1) * 100) : null
  }
  const b = base ?? onOrBefore(series, since)?.nav ?? series[0].nav
  const years = (Date.parse(asOf) - Date.parse(since)) / DAY / 365.25
  const si = b ? r2((years >= 1 ? Math.pow(last.nav / b, 1 / years) - 1 : last.nav / b - 1) * 100) : null
  return [back(1), back(3), back(6), back(12), si]
}

export async function managedFactsheet(accountId: string, params: URLSearchParams) {
  const code = accountId.toUpperCase()
  const [all, strat] = await Promise.all([managedHistoryRows(code), managedStrategy(code)])
  const series = all.map((r: any) => ({ d: iso(r.report_date), nav: num(r.nav), v: num(r.portfolio_value), cf: num(r.cash_in_out) }))
  const want = isoDate(params.get('date'))
  const rows = want ? series.filter(r => r.d <= want) : series
  const monthEnds = [...new Set(series.map(r => r.d.slice(0, 7)))].map(m => series.filter(r => r.d.slice(0, 7) === m).pop()!.d)
  const dates = [...new Set([series.length ? series[series.length - 1].d : null, ...monthEnds.reverse()].filter(Boolean))].slice(0, 13) as string[]
  const coverage = series.length ? { from: series[0].d, to: series[series.length - 1].d } : { from: null, to: null }
  const label = managedLabel(strat)
  if (!rows.length) return { accountId: code, asOf: null, dates, date: want, coverage, strategy: label, computed: true }

  const first = rows[0], last = rows[rows.length - 1], asOf = last.d
  // Money in / out = the monthly nets (as in the cash-flows report), never the gross of daily settlement flows
  const months = monthlyNet(rows)
  const contribution = months.reduce((s, x) => s + (x.net > 0 ? x.net : 0), 0)
  const withdrawal = months.reduce((s, x) => s + (x.net < 0 ? -x.net : 0), 0)
  const inception = first.d
  const port = periodReturns(rows, asOf, 100, (() => { const t = new Date(inception + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10) })())

  let bench: (number | null)[] = [null, null, null, null, null]
  try {
    const b = await db2.query(`SELECT date, nav FROM public.tblresearch_new WHERE indices = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC`,
      [MANAGED_BENCHMARK, monthsBack(inception, 1), asOf])
    const bs = b.rows.map((r: any) => ({ d: iso(r.date), nav: num(r.nav) }))
    if (bs.length) bench = periodReturns(bs, asOf, onOrBefore(bs, inception)?.nav ?? bs[0].nav, inception)
  } catch (e) { console.error('[managedFactsheet] benchmark', (e as Error).message) }

  // Holdings: the account's latest broker holdings (equity, ETFs, mutual funds), as a share of what is held
  const hold = await managedHoldingRows([code]).catch(() => [] as any[])
  const held = hold.reduce((s: number, h: any) => s + num(h.mktvalue), 0)
  const kind = (h: any) => (h.security_type === 'm' ? 'Mutual Fund' : h.detailtypename === 'ETF' ? 'ETF' : 'Equity')
  const byKind = new Map<string, number>()
  for (const h of hold) byKind.set(kind(h), (byKind.get(kind(h)) || 0) + num(h.mktvalue))
  const pct = (v: number) => (held ? r2((v / held) * 100) : null)
  const holdingsDate = hold.length ? hold.map((h: any) => h.holding_date).sort().pop() : null

  return {
    accountId: code, asOf, dates, date: want, coverage, strategy: label, inceptionDate: inception,
    contribution: r2(contribution), withdrawal: r2(withdrawal), portfolioValue: r2(last.v), valueDate: asOf,
    profitLoss: r2(last.v - (contribution - withdrawal)),
    returns: { periods: ['1m', '3m', '6m', '1y', `Since ${dmy(inception)}`], portfolio: port, benchmark: { name: MANAGED_BENCHMARK, values: bench } },
    sectors: [...byKind].sort((a, b) => b[1] - a[1]).map(([sector, v]) => ({ sector, pct: pct(v) })),
    holdings: hold.map((h: any) => ({ security: h.security_name, sector: kind(h), value: r2(num(h.mktvalue)), pct: pct(num(h.mktvalue)) }))
      .filter((h: any) => h.value).sort((a: any, b: any) => b.value - a.value),
    computed: true,
    note: 'Computed by Qode from the account\'s daily portfolio values (managed account). Money in and out are netted by month.'
      + (holdingsDate ? ` Holdings are the broker's as of ${dmy(holdingsDate)}, as a share of the holdings shown.` : ' No broker holdings are on record for this account.'),
  }
}

const GROUPS: Record<string, string> = { trades: 'Trades (equity & mutual funds)', money: 'Money in/out' }

export async function managedTransactions(accountId: string, params: URLSearchParams) {
  const code = accountId.toUpperCase()
  const group = params.get('group') === 'trades' ? 'trades' : params.get('group') === 'money' ? 'money' : 'all'
  const from = isoDate(params.get('from')), to = isoDate(params.get('to'))
  const exportAll = params.get('export') === '1'
  const { limit, offset } = exportAll ? { limit: 5000, offset: 0 } : page(params)

  const [cash, eq, mf] = await Promise.all([
    pool.query(`SELECT date, capital_in_out::float8 AS amt FROM public.master_sheet WHERE qcode = $1 AND system_tag = 'Total Portfolio Value' AND capital_in_out <> 0 ORDER BY date ASC`, [code]),
    pool.query(`SELECT id, date, trade_type, symbol, quantity::float8 AS qty, price::float8 AS price, broker FROM public.equity_holdings_tradebook WHERE qcode = $1 ORDER BY date DESC, id DESC`, [code]),
    pool.query(`SELECT id, date, trade_type, symbol, isin, quantity::float8 AS qty, price::float8 AS price, broker FROM public.mutual_funds_tradebook WHERE qcode = $1 ORDER BY date DESC, id DESC`, [code]),
  ])
  const isSell = (t: string) => /^s/i.test(String(t || ''))
  const all = [
    ...monthlyNet(cash.rows.map((r: any) => ({ d: iso(r.date), cf: num(r.amt) }))).map(x => {
      const inflow = x.net > 0, [y, mo] = x.month.split('-')
      const label = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo - 1]} ${y}`
      return { id: `c${x.month}`, date: x.date, code: inflow ? 'CS+' : 'CS-', type: inflow ? `Net money in · ${label}` : `Net money out · ${label}`, security: null, qty: null, rate: null,
        amount: r2(Math.abs(x.net)), group: 'money', direction: inflow ? 'in' : 'out', settleDate: x.date, charges: 0, ref: null,
        notes: `${x.moves} ${x.moves === 1 ? 'movement' : 'movements'} in ${label}, netted` }
    }),
    ...[...eq.rows.map((r: any) => ({ ...r, kind: 'Equity' })), ...mf.rows.map((r: any) => ({ ...r, kind: 'Mutual fund' }))].map((r: any) => {
      const sell = isSell(r.trade_type), qty = Math.abs(num(r.qty)), price = num(r.price)
      return { id: `${r.kind === 'Equity' ? 'e' : 'm'}${r.id}`, date: iso(r.date), code: sell ? 'SL+' : 'BY-', type: `${sell ? 'Sell' : 'Buy'} · ${r.kind}`,
        security: r.symbol || r.isin, qty, rate: price || null, amount: r2(qty * price), group: 'trades', direction: sell ? 'in' : 'out',
        settleDate: iso(r.date), charges: 0, ref: null, notes: r.broker ? `Broker: ${r.broker}` : null }
    }),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const inRange = all.filter(t => (!from || t.date >= from) && (!to || t.date <= to))
  const shown = inRange.filter(t => group === 'all' || t.group === group)
  const money = inRange.filter(t => t.group === 'money')
  const dates = all.map(t => t.date).sort()
  return {
    accountId: code, asOf: dates.length ? dates[dates.length - 1] : null, group, from, to,
    items: shown.slice(offset, offset + limit), hasMore: shown.length > offset + limit, total: shown.length,
    coverage: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : { from: null, to: null },
    summary: Object.keys(GROUPS).map(g => ({ group: g, label: GROUPS[g], count: inRange.filter(t => t.group === g).length, amount: r2(inRange.filter(t => t.group === g).reduce((s, t) => s + t.amount, 0)) })),
    moneyIn: r2(money.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0)),
    moneyOut: r2(money.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0)),
    note: 'Money in/out is netted by month. Futures & options trades are not included: only equity and mutual fund trades are on record for managed accounts.',
    managed: true,
  }
}
