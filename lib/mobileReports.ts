// Shared pieces for /api/mobile/reports/* (transactions, capital gains, expenses, fact sheet).
// Data lives in PG_DATABASE1 (lib/db1): pms_clients_tracker.pms_transactions (synced) and the tables loaded
// from Nuvama's report exports by scripts/import-nuvama-reports.mjs (pms_capital_gains, pms_expense_statement,
// pms_factsheet). All are keyed by the strategy account code (= pms_clients_master.clientcode = JWT accountCodes).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth, MobileAuthUser } from '@/lib/mobileAuth'
import { query as queryMain } from '@/lib/db'

/** Name and strategy printed in a statement's header ("Account : QAW00032 · NAME"). Never fails a report. */
export async function accountHolder(accountId: string): Promise<{ name: string | null; strategy: string | null }> {
  try {
    const r = await queryMain('SELECT clientname, schemename FROM pms_clients_master WHERE clientcode = $1 LIMIT 1', [accountId])
    return { name: r.rows[0]?.clientname ?? null, strategy: r.rows[0]?.schemename ?? null }
  } catch { return { name: null, strategy: null } }
}
export const REVIEWER_HOLDER = { name: 'Demo Investor', strategy: 'QODE ADVISORS LLP - QODE ALL WEATHER' }

/** A distributor reading an investor's report with the read-only view token (/api/mobile/distributor/view-account),
 *  e.g. the partner app's "Download reports" (which sends via=distributor; export=1 is the PDF): one server log line
 *  per request, so these downloads can be traced to the distributor. Never fails a report. */
export function traceDistributorReport(request: NextRequest, user: MobileAuthUser, accounts: string[], params: URLSearchParams) {
  try {
    if (!user.viewedByDistributor) return
    if (params.get('export') !== '1' && params.get('via') !== 'distributor') return
    console.info('[mobile/reports] distributor view', JSON.stringify({
      report: new URL(request.url).pathname.split('/').pop(), by: user.impersonatedBy ?? null, investor: user.clientCode ?? null,
      accounts, export: params.get('export') === '1', via: params.get('via') || null,
      from: params.get('from') || null, to: params.get('to') || null, fy: params.get('fy') || null, date: params.get('date') || null,
    }))
  } catch { /* logging only */ }
}

/** Auth + the one-account scope check every report route shares. */
export async function reportAccount(request: NextRequest): Promise<
  { user: MobileAuthUser; accountId: string; params: URLSearchParams; error?: undefined } | { error: NextResponse }
> {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return { error }
  const params = new URL(request.url).searchParams
  const accountId = params.get('accountId') ?? user!.accountCodes?.[0]
  if (!accountId) return { error: NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 }) }
  if (!user!.accountCodes?.includes(accountId)) return { error: NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 }) }
  traceDistributorReport(request, user!, [accountId], params)
  return { user: user!, accountId, params }
}

export const page = (params: URLSearchParams, def = 50, max = 200) => ({
  limit: Math.min(Math.max(parseInt(params.get('limit') || '', 10) || def, 1), max),
  offset: Math.max(parseInt(params.get('offset') || '', 10) || 0, 0),
})
export const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
export const n = (v: unknown) => (v == null ? null : Number(v))
export const day = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d == null ? null : String(d).slice(0, 10))

// Nuvama tran_type → the app's groups. "all" leaves out margin bookkeeping (IML) and TDS transfers between
// internal ledgers (TDI/TDO); they stay reachable under "other".
export const TXN_GROUPS: Record<string, { label: string; codes: string[] }> = {
  trades:  { label: 'Trades',       codes: ['BY-', 'SL+', 'OBY', 'CSL'] },
  money:   { label: 'Money in/out', codes: ['CS+', 'CS-', 'PSI', 'PSO', 'SII', 'SOO'] },
  income:  { label: 'Income',       codes: ['RD0', 'IN1', 'CSI'] },
  charges: { label: 'Charges',      codes: ['CUS', 'E01', 'E03', 'E09', 'E10', 'E12', 'E20', 'E21', 'STT', 'MGF', 'PRF', 'TDP'] },
}
export const HIDDEN_FROM_ALL = ['IML', 'TDI', 'TDO']
const IN_CODES = new Set(['CS+', 'PSI', 'SII', 'RD0', 'IN1', 'CSI', 'SL+', 'CSL', 'OPI'])
const OUT_CODES = new Set(['CS-', 'PSO', 'SOO', 'BY-', 'OBY', 'OPO', ...TXN_GROUPS.charges.codes])
export const groupOf = (code: string) => Object.keys(TXN_GROUPS).find(g => TXN_GROUPS[g].codes.includes(code)) || 'other'
/** Cash direction for the account: money in / out (null when neither, e.g. margin). */
export const directionOf = (code: string) => (IN_CODES.has(code) ? 'in' : OUT_CODES.has(code) ? 'out' : null)

/** Indian financial year label for a date: 2025-04-01 … 2026-03-31 → "2025-26". */
export const fyOf = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}` }
export const fyRange = (fy: string) => { const s = +fy.slice(0, 4); return [`${s}-04-01`, `${s + 1}-03-31`] }

// ── App Store / Play Store reviewer (mock accounts DEMO001 / DEMO002): no database reads ───────────────────
const AS_OF = '2026-09-25'
// from / to (yyyy-mm-dd, inclusive) as lib/reportsData.ts reads them; inRange keeps a row when its date is inside.
const reviewerRange = (params?: URLSearchParams) => ({ from: isoDate(params?.get('from') ?? null), to: isoDate(params?.get('to') ?? null) })
const inRange = (d: string | null | undefined, from: string | null, to: string | null) => !!d && (!from || d >= from) && (!to || d <= to)
export const reviewerTransactions = (accountId: string, params?: URLSearchParams) => {
  const group = params?.get('group') || 'all'
  const { from, to } = reviewerRange(params)
  const all = [
    { date: '2026-09-22', code: 'BY-', type: 'Buy', security: 'HDFC Bank Ltd', qty: 120, rate: 1652.4, amount: 198288 },
    { date: '2026-09-18', code: 'SL+', type: 'Sell', security: 'Infosys Ltd', qty: 80, rate: 1890.1, amount: 151208 },
    { date: '2026-09-10', code: 'RD0', type: 'Dividend Reinvest', security: 'ITC Ltd', qty: null, rate: null, amount: 4200 },
    { date: '2026-09-01', code: 'CUS', type: 'Custody Charges', security: null, qty: null, rate: null, amount: 1180 },
    { date: '2026-08-14', code: 'CS+', type: 'Corpus Deposits', security: null, qty: null, rate: null, amount: 500000 },
    { date: '2026-07-01', code: 'MGF', type: 'Management Fees', security: null, qty: null, rate: null, amount: 12500 },
  ].map((t, i) => ({ id: i + 1, ...t, group: groupOf(t.code), direction: directionOf(t.code), settleDate: t.date, charges: 0, ref: null, notes: null }))
  const items = all.filter(t => inRange(t.date, from, to))
  const money = items.filter(t => t.group === 'money')
  return { accountId, asOf: AS_OF, group, from, to, items: items.filter(t => group === 'all' || t.group === group), hasMore: false,
    coverage: { from: all[all.length - 1].date, to: all[0].date },
    summary: Object.keys(TXN_GROUPS).map(g => ({ group: g, label: TXN_GROUPS[g].label, count: items.filter(t => t.group === g).length, amount: items.filter(t => t.group === g).reduce((s, t) => s + t.amount, 0) })),
    moneyIn: money.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0), moneyOut: money.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0) }
}
export const reviewerCapitalGains = (accountId: string, params?: URLSearchParams) => {
  // A from / to range (sale date) takes precedence over a financial year, as in lib/reportsData.ts.
  const { from, to } = reviewerRange(params)
  const ranged = !!(from || to)
  const fy = ranged ? null : params?.get('fy') === '2025-26' ? '2025-26' : '2026-27'
  const term = params?.get('term') === 'ST' || params?.get('term') === 'LT' ? params.get('term') : null
  const all = ranged ? [...REVIEWER_LOTS_2627, ...REVIEWER_LOTS_2526].filter(l => inRange(l.saleDate, from, to)) : fy === '2025-26' ? REVIEWER_LOTS_2526 : REVIEWER_LOTS_2627
  const st = all.filter(l => l.term === 'ST').reduce((s, l) => s + l.gain, 0), lt = all.filter(l => l.term === 'LT').reduce((s, l) => s + l.gain, 0)
  const ltTaxable = all.filter(l => l.term === 'LT').reduce((s, l) => s + (l.ltTaxable || 0), 0)
  return {
  accountId, asOf: AS_OF, fy, from, to, term,
  coverage: { from: REVIEWER_LOTS_2526[REVIEWER_LOTS_2526.length - 1].saleDate, to: REVIEWER_LOTS_2627[0].saleDate },
  years: [{ fy: '2026-27', st: 84210, lt: 126400, total: 210610, lots: 3 }, { fy: '2025-26', st: -12040, lt: 58300, total: 46260, lots: 2 }],
  summary: { st, lt, ltTaxable: ranged ? ltTaxable : lt, total: st + lt, byCategory: [{ category: 'Listed Shares/Equity Mutual Funds (STT paid on Sale)', st, lt, ltTaxable: ranged ? ltTaxable : lt }] },
  items: all.filter(l => !term || l.term === term), hasMore: false }
}
const REVIEWER_LOTS_2627 = [
    { saleDate: '2026-09-18', purchaseDate: '2024-06-11', security: 'Infosys Ltd', securityType: 'Shares', category: 'Listed Shares/Equity Mutual Funds (STT paid on Sale)', qty: 80, saleRate: 1890.1, purchaseRate: 1405, purchaseAmount: 112400, saleAmount: 151208, cost: 112400, gain: 38808, ltTaxable: 38808, term: 'LT', daysHeld: 829 },
    { saleDate: '2026-08-02', purchaseDate: '2026-03-20', security: 'Tata Motors Ltd', securityType: 'Shares', category: 'Listed Shares/Equity Mutual Funds (STT paid on Sale)', qty: 150, saleRate: 950, purchaseRate: 388.6, purchaseAmount: 58290, saleAmount: 142500, cost: 58290, gain: 84210, ltTaxable: null, term: 'ST', daysHeld: 135 },
    { saleDate: '2026-05-12', purchaseDate: '2023-11-02', security: 'Larsen & Toubro Ltd', securityType: 'Shares', category: 'Listed Shares/Equity Mutual Funds (STT paid on Sale)', qty: 60, saleRate: 3576.67, purchaseRate: 2116.8, purchaseAmount: 127008, saleAmount: 214600, cost: 127008, gain: 87592, ltTaxable: 87592, term: 'LT', daysHeld: 922 },
]
const REVIEWER_LOTS_2526 = [
    { saleDate: '2026-02-10', purchaseDate: '2025-10-01', security: 'Wipro Ltd', securityType: 'Shares', category: 'Listed Shares/Equity Mutual Funds (STT paid on Sale)', qty: 100, saleRate: 480.2, saleAmount: 48020, purchaseRate: 600.6, purchaseAmount: 60060, cost: 60060, gain: -12040, ltTaxable: null, term: 'ST', daysHeld: 132 },
    { saleDate: '2025-12-05', purchaseDate: '2023-08-14', security: 'ITC Ltd', securityType: 'Shares', category: 'Listed Shares/Equity Mutual Funds (STT paid on Sale)', qty: 200, saleRate: 468.5, saleAmount: 93700, purchaseRate: 177, purchaseAmount: 35400, cost: 35400, gain: 58300, ltTaxable: 58300, term: 'LT', daysHeld: 844 },
]
export const reviewerExpenses = (accountId: string, params?: URLSearchParams) => {
  const type = params?.get('type') || null
  const { from, to } = reviewerRange(params)
  const all = [
    { date: '2026-09-01', settleDate: '2026-09-01', type: 'Custody Charges', notes: 'Custody charges for Aug 2026', amount: 1180, status: 'paid' },
    { date: '2026-07-01', settleDate: '2026-07-03', type: 'Management Fees', notes: 'Management fee Q1 FY27', amount: 12500, status: 'paid' },
    { date: '2026-09-25', settleDate: null, type: 'Fund Accountant Fees', notes: 'Accrued', amount: 4120, status: 'payable' },
  ]
  const ranged = !!(from || to)
  const inR = all.filter(x => inRange(x.date, from, to))
  // With a range, the totals come from the rows inside it (as the real query does); without one, the statement totals.
  const byType = ranged
    ? [...inR.reduce((m, x) => { const t = m.get(x.type) || { type: x.type, amount: 0, count: 0 }; t.amount += x.amount; t.count += 1; return m.set(x.type, t) }, new Map<string, { type: string; amount: number; count: number }>()).values()].sort((a, b) => b.amount - a.amount)
    : [{ type: 'Management Fees', amount: 37500, count: 3 }, { type: 'Custody Charges', amount: 7080, count: 6 }, { type: 'Fund Accountant Fees', amount: 4720, count: 6 }, { type: 'Sec. Tran. Tax', amount: 3090, count: 14 }]
  return ({
  accountId, asOf: AS_OF, strategy: 'QODE ADVISORS LLP - QODE ALL WEATHER', period: { from: '2025-04-01', to: AS_OF }, from, to,
  paid: ranged ? inR.filter(x => x.status !== 'payable').reduce((s, x) => s + x.amount, 0) : 52390,
  payable: ranged ? inR.filter(x => x.status === 'payable').reduce((s, x) => s + x.amount, 0) : 4120,
  byType,
  items: inR.filter(x => !type || x.type === type), type, hasMore: false })
}
// Fact sheet snapshots (newest first). ?date= picks the latest snapshot on or before it, as lib/reportsData.ts does.
const REVIEWER_SNAPSHOTS = [
  { asOf: AS_OF, profitLoss: 612400, portfolioValue: 3112400, portfolio: [2.1, 5.4, 18.2, 16.9], benchmark: [-4.16, -1.86, -1.32, 12.4] },
  { asOf: '2026-06-30', profitLoss: 540800, portfolioValue: 3040800, portfolio: [1.4, 3.9, 16.8, 16.1], benchmark: [2.35, 6.1, 4.8, 13.9] },
  { asOf: '2026-03-31', profitLoss: 468900, portfolioValue: 2968900, portfolio: [-0.8, 1.2, 14.6, 15.4], benchmark: [-3.2, -5.4, 5.9, 12.7] },
]
export const reviewerFactsheet = (accountId: string, params?: URLSearchParams) => {
  const date = isoDate(params?.get('date') ?? null)
  const dates = REVIEWER_SNAPSHOTS.map(x => x.asOf)
  const snap = REVIEWER_SNAPSHOTS.find(x => !date || x.asOf <= date)
  if (!snap) return { accountId, asOf: null, dates, date }
  return {
  accountId, asOf: snap.asOf, dates, date, strategy: 'QODE ADVISORS LLP - QODE ALL WEATHER', inceptionDate: '2023-06-01',
  contribution: 2500000, withdrawal: 0, profitLoss: snap.profitLoss, portfolioValue: snap.portfolioValue, valueDate: snap.asOf,
  returns: { periods: ['1m', '3m', '1y', 'Since 01/06/23'], portfolio: snap.portfolio, benchmark: { name: 'S&P BSE 500 Total Return Index', values: snap.benchmark } },
  sectors: [{ sector: 'Equity', pct: 62.5 }, { sector: 'Mutual Fund', pct: 24.1 }, { sector: 'Cash and Equivalent', pct: 13.4 }],
  holdings: [
    { security: 'HDFC Bank Ltd', sector: 'Banks', value: 412300, pct: 13.25 },
    { security: 'Infosys Ltd', sector: 'IT - Software', value: 298100, pct: 9.58 },
    { security: 'Nippon India Liquid Fund', sector: 'Mutual Fund', value: 750000, pct: 24.1 },
    { security: 'Cash and Equivalent', sector: 'Cash', value: 417000, pct: 13.4 },
  ] }
}

// Security-level holdings (GET /api/mobile/portfolio/securities) for the reviewer accounts, as pms_holdings rows run
// through the same aggregation as real data (lib/securities.ts). [code, name, type, detail, qty, avg cost, price, sector]
const REVIEWER_POSITIONS: Record<string, [string, string, string, string, number, number, number, string][]> = {
  DEMO001: [
    ['HDFCBANK', 'HDFC Bank Ltd', 's', 'Listed', 240, 1512.4, 1652.4, 'Private Sector Bank'],
    ['INFY', 'Infosys Ltd', 's', 'Listed', 160, 1405, 1890.1, 'Computers - Software & Consulting'],
    ['RELIANCE', 'Reliance Industries Ltd', 's', 'Listed', 150, 2480.5, 2915.3, 'Refineries & Marketing'],
    ['ITC', 'ITC Ltd', 's', 'Listed', 600, 402.1, 468.5, 'Diversified FMCG'],
    ['GOLDBEES', 'NIPPON INDIA ETF GOLD BEES', 's', 'Equity ETF', 3000, 75.8, 124.4, 'Commodity'],
    ['118701', 'Nippon India Liquid Fund - Direct Plan - Growth', 'm', 'Equity', 120, 6010, 6250, 'Mutual Fund'],
  ],
  DEMO002: [
    ['HDFCBANK', 'HDFC Bank Ltd', 's', 'Listed', 120, 1580, 1652.4, 'Private Sector Bank'],
    ['TRENT', 'Trent Ltd', 's', 'Listed', 70, 4210, 5480.2, 'Speciality Retail'],
    ['DIXON', 'Dixon Technologies (India) Ltd', 's', 'Listed', 25, 9800, 14620, 'Consumer Electronics'],
    ['PERSISTENT', 'Persistent Systems Ltd', 's', 'Listed', 60, 4950, 5710.4, 'Computers - Software & Consulting'],
    ['MOMENTUM50', 'Motilal Oswal Nifty 500 Momentum 50 ETF', 's', 'Equity ETF', 9000, 50.7, 53.5, 'Equity'],
  ],
}
const REVIEWER_CASH: Record<string, number> = { DEMO001: 212400, DEMO002: 96300 }
export const reviewerSecurityRows = (codes: string[]) => codes.flatMap(code => [
  ...(REVIEWER_POSITIONS[code] || []).map(([security_code, security_name, security_type, detailtypename, qty, avg, price, sector]) => ({
    ws_account_code: code, security_code, security_name, security_type, detailtypename, astclsname: 'Equity', holding_date: AS_OF,
    holding_qty: qty, cost: qty * avg, mktprice: price, mktvalue: qty * price, nuvama_sector: sector, basic_industry: null })),
  ...(REVIEWER_CASH[code] != null ? [{ ws_account_code: code, security_code: 'CASH', security_name: 'Cash/Bank Balance', security_type: 'c',
    detailtypename: 'Bank Account', astclsname: 'Cash and Equivalent', holding_date: AS_OF, holding_qty: REVIEWER_CASH[code],
    cost: REVIEWER_CASH[code], mktprice: 0, mktvalue: REVIEWER_CASH[code], nuvama_sector: null, basic_industry: null }] : []),
])
export const REVIEWER_STRATEGY: Record<string, string> = { DEMO001: 'Qode All Weather', DEMO002: 'Qode Growth Fund' }
