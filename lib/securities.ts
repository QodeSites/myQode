// Security-level holdings of one or more strategy accounts (GET /api/mobile/portfolio/securities): what the investor
// owns, like a broker's holdings screen. Built from the same rows as the fact sheet (lib/factsheetCompute.ts
// holdingsRows: each account's last pms_holdings date on or before asOf, Nuvama / NSE sector labels) and the same
// cash rules: bank balance and receivable/payable merged into "Cash"; the gap to pms_master_sheet.portfolio_value
// (dividends / interest receivable) added when the holdings and the value are the same day.
// Combined across accounts, a security is one row (qty, cost and value summed; avg cost = cost / qty).
// Fields used from pms_holdings: security_code (NSE symbol for listed shares and ETFs, AMFI code for mutual funds,
// OPTnnn for options; there is no ISIN column), security_name, security_type, astclsname, detailtypename,
// holding_qty, cost (total cost), mktprice, mktvalue, holding_date.
import { query as qMain } from '@/lib/db'
import { holdingsRows, holdingSector, CASH, RECEIVABLE } from '@/lib/factsheetCompute'
import { day } from '@/lib/mobileReports'
import { getStrategyName } from '@/lib/strategyConfig'

type Row = Record<string, any>
const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 10000) / 10000

/** Strategy account codes (QAW00012, QGF0001 …): the JWT also carries owner / group ids ("65941.0"), never holdings. */
export const isAccountCode = (c: unknown) => typeof c === 'string' && /^[A-Z]{3}\d+$/i.test(c)

export type AssetClass = 'Stocks' | 'ETFs' | 'Mutual funds' | 'Derivatives' | 'Cash'
/** Instrument kind of a pms_holdings row (the sector says what it invests in). Futures / options margin is Derivatives, as Nuvama groups it. */
function assetClassOf(h: Row): AssetClass {
  const t = h.security_type, detail = String(h.detailtypename || '')
  if (t === 'c' || h.astclsname === CASH) return 'Cash'   // bank, receivable/payable, liquid ETFs
  if (t === 'o' || t === 'f') return 'Derivatives'
  if (t === 'm') return 'Mutual funds'
  if (/ETF/i.test(detail)) return 'ETFs'
  return 'Stocks'
}
// Rows whose quantity is rupees (cash, margin): no qty / price / avg cost shown.
const unitless = (h: Row) => h.security_type === 'c' || /INIMRGN$/i.test(String(h.security_code || ''))

export type SecurityItem = {
  security: string; symbol: string | null; sector: string; assetClass: AssetClass
  qty: number | null; avgCost: number | null; price: number | null
  invested: number; value: number; gain: number; gainPct: number | null; weight: number
  accounts: string[]
}
export type SecuritiesResponse = {
  asOf: string | null
  accounts: { code: string; strategy: string; holdingsDate: string | null; value: number }[]
  totals: { value: number; invested: number; gain: number; gainPct: number | null; count: number }
  sectors: { sector: string; value: number; weight: number }[]
  assetClasses: { assetClass: AssetClass; value: number; weight: number }[]
  items: SecurityItem[]
}

type Acc = { key: string; security: string; symbol: string | null; sector: string; assetClass: AssetClass; unitless: boolean
  qty: number; cost: number; value: number; price: number | null; accounts: Set<string> }

/**
 * Holdings of `codes` (strategy account codes the caller may see) as of `asOf` (yyyy-mm-dd). Two queries in
 * parallel: the holdings (db1) and each account's portfolio value on or before asOf (main db).
 */
export async function computeSecurities(codes: string[], asOf: string): Promise<SecuritiesResponse> {
  const [holdRes, valRes] = await Promise.all([
    holdingsRows(codes, asOf),
    qMain(
      `SELECT DISTINCT ON (account_code) account_code, report_date, portfolio_value FROM public.pms_master_sheet
        WHERE account_code = ANY($1) AND report_date <= $2 ORDER BY account_code, report_date DESC`, [codes, asOf]),
  ])
  const valueOf = new Map<string, { date: string | null; value: number }>(
    valRes.rows.map(r => [r.account_code, { date: day(r.report_date), value: Number(r.portfolio_value) || 0 }]))
  return securitiesFromRows(codes, holdRes.rows, valueOf, getStrategyName)
}

/** The response from holdingsRows()-shaped rows and each account's { date, value }: pure (the reviewer mock uses it too). */
export function securitiesFromRows(codes: string[], rows: Row[], valueOf: Map<string, { date: string | null; value: number }>,
  strategyOf: (code: string) => string): SecuritiesResponse {

  const byKey = new Map<string, Acc>()
  const add = (code: string, a: Omit<Acc, 'accounts' | 'qty' | 'cost' | 'value'>, qty: number, cost: number, value: number) => {
    const x = byKey.get(a.key) || { ...a, qty: 0, cost: 0, value: 0, accounts: new Set<string>() }
    x.qty += qty; x.cost += cost; x.value += value; x.accounts.add(code)
    if (a.price != null) x.price = a.price
    byKey.set(a.key, x)
  }
  const perAccount = new Map<string, { date: string | null; held: number; hasCash: boolean }>()
  for (const h of rows) {
    const code = h.ws_account_code, v = Number(h.mktvalue) || 0, qty = Number(h.holding_qty) || 0
    const acct = perAccount.get(code) || { date: day(h.holding_date), held: 0, hasCash: false }
    perAccount.set(code, acct)
    if (h.security_type === 'c') {
      acct.held += v; acct.hasCash = true
      add(code, { key: 'cash', security: 'Cash', symbol: null, sector: CASH, assetClass: 'Cash', unitless: true, price: null }, 0, v, v)
      continue
    }
    if (!v && !qty) continue
    acct.held += v
    const cost = h.cost == null ? v : Number(h.cost) || 0
    const price = Number(h.mktprice)
    add(code, {
      key: `${h.security_type}|${h.security_code || h.security_name}`, security: h.security_name, symbol: h.security_code || null,
      sector: holdingSector(h), assetClass: assetClassOf(h), unitless: unitless(h), price: price > 0 ? price : null,
    }, qty, unitless(h) ? v : cost, v)
  }
  // Dividends / interest receivable: in the value, not in the holdings (same rule as the fact sheet).
  const accounts: SecuritiesResponse['accounts'] = []
  for (const code of codes) {
    const a = perAccount.get(code), pv = valueOf.get(code)
    let value = a ? a.held : pv ? pv.value : 0
    if (a && pv && a.date === pv.date && Math.abs(pv.value - a.held) >= 1) {
      const gap = pv.value - a.held
      value = pv.value
      if (a.hasCash) add(code, { key: 'receivable', security: RECEIVABLE, symbol: null, sector: RECEIVABLE, assetClass: 'Cash', unitless: true, price: null }, 0, gap, gap)
      else add(code, { key: 'cash', security: 'Cash', symbol: null, sector: CASH, assetClass: 'Cash', unitless: true, price: null }, 0, gap, gap)
    }
    if (a || pv) accounts.push({ code, strategy: strategyOf(code), holdingsDate: a?.date ?? null, value: r2(value) })
  }

  const all = [...byKey.values()].filter(x => Math.abs(x.value) >= 0.5 || Math.abs(x.qty) > 0)
  const total = all.reduce((s, x) => s + x.value, 0)
  const invested = all.reduce((s, x) => s + x.cost, 0)
  const w = (v: number) => (Math.abs(total) >= 1 ? r2((v / total) * 100) : 0)
  const items: SecurityItem[] = all.map(x => ({
    security: x.security, symbol: x.symbol, sector: x.sector, assetClass: x.assetClass,
    qty: x.unitless ? null : r4(x.qty), avgCost: x.unitless || !x.qty ? null : r4(x.cost / x.qty), price: x.unitless ? null : x.price,
    invested: r2(x.cost), value: r2(x.value), gain: r2(x.value - x.cost),
    gainPct: x.unitless || !x.cost ? null : r2(((x.value - x.cost) / Math.abs(x.cost)) * 100),
    weight: w(x.value), accounts: [...x.accounts].sort(),
  })).sort((a, b) => b.value - a.value)
  const group = <K extends string>(key: (i: SecurityItem) => K) => {
    const m = new Map<K, number>()
    for (const i of items) m.set(key(i), (m.get(key(i)) || 0) + i.value)
    return [...m].sort((a, b) => b[1] - a[1])
  }
  const dates = [...perAccount.values()].map(a => a.date).filter(Boolean) as string[]
  return {
    asOf: dates.length ? dates.sort()[dates.length - 1] : null,
    accounts,
    totals: { value: r2(total), invested: r2(invested), gain: r2(total - invested), gainPct: invested ? r2(((total - invested) / invested) * 100) : null,
      count: items.filter(i => i.qty != null).length },
    sectors: group(i => i.sector).map(([sector, value]) => ({ sector, value: r2(value), weight: w(value) })),
    assetClasses: group(i => i.assetClass).map(([assetClass, value]) => ({ assetClass, value: r2(value), weight: w(value) })),
    items,
  }
}
