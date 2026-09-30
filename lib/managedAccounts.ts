// Managed accounts (the OneView book in qode_portfolios): people are `clients` (icode QUS…), their accounts are QAC…
// codes linked through `pooled_account_users`, and each account's daily series is master_sheet's
// 'Total Portfolio Value' row (value, NAV from 100, drawdown %, capital in/out). The other system_tag rows are strategy
// legs and notional exposure, not shown.
//
// For now only admins see these, through "View as" in the app's admin mode (a read-only 4 h token marked `managed`).
// The app builds every figure on the phone from the raw series (GET /api/mobile/portfolio/history), exactly as it does
// for Orbis accounts, so none of the PMS routes change. Never selects the credential columns of `accounts` / `clients`.
import pool from '@/lib/db'

export const isManagedCode = (c: unknown) => typeof c === 'string' && /^QAC\d+$/i.test(c.trim())
const SERIES_TAG = 'Total Portfolio Value'
export const MANAGED_BENCHMARK = 'NIFTY 50'
export const MANAGED_COLOR = '#5B4B8A'
const CLOSED_BELOW = 100

/** "Managed · QYE++" (the account's strategy from `accounts`), else "Managed account". */
export const managedLabel = (strategy?: string | null) => (strategy ? `Managed · ${strategy}` : 'Managed account')

/** Raw daily rows for one QAC account, in pms_master_sheet's column names (the app's history maths reads these). */
export async function managedHistoryRows(qcode: string) {
  const r = await pool.query(
    `SELECT date AS report_date, nav, portfolio_value, drawdown AS drawdown_percent, capital_in_out AS cash_in_out
       FROM public.master_sheet WHERE qcode = $1 AND system_tag = $2 ORDER BY date ASC`, [qcode.toUpperCase(), SERIES_TAG])
  return r.rows
}

export async function managedStrategy(qcode: string): Promise<string | null> {
  const r = await pool.query(`SELECT strategy FROM public.accounts WHERE qcode = $1 LIMIT 1`, [qcode.toUpperCase()])
  return r.rows[0]?.strategy || null
}

type Person = { icode: string; name: string; email: string; accounts: { qcode: string; strategy: string | null; value: number | null; asOf: string | null; closed: boolean }[]; total: number }

/** Managed people (for the admin list), optionally filtered by name / email / QUS / QAC code. */
export async function managedPeople(q = ''): Promise<Person[]> {
  const like = q.trim() ? `%${q.trim()}%` : null
  const r = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (qcode) qcode, date, portfolio_value::float8 AS v
         FROM public.master_sheet WHERE system_tag = $2 ORDER BY qcode, date DESC),
     prev AS (
       SELECT qcode, (array_agg(portfolio_value::float8 ORDER BY date DESC))[2] AS v2
         FROM public.master_sheet WHERE system_tag = $2 GROUP BY qcode)
     SELECT c.icode, trim(c.user_name) AS name, lower(trim(c.email)) AS email, p.qcode, a.strategy,
            l.v, l.date::text AS as_of, pr.v2
       FROM public.clients c
       JOIN public.pooled_account_users p ON p.icode = c.icode
       LEFT JOIN public.accounts a ON a.qcode = p.qcode
       LEFT JOIN latest l ON l.qcode = p.qcode
       LEFT JOIN prev pr ON pr.qcode = p.qcode
      WHERE $1::text IS NULL OR c.user_name ILIKE $1 OR c.email ILIKE $1 OR c.icode ILIKE $1 OR p.qcode ILIKE $1
      ORDER BY trim(c.user_name), p.qcode`, [like, SERIES_TAG])
  const byIcode = new Map<string, Person>()
  for (const x of r.rows) {
    const p: Person = byIcode.get(x.icode) || { icode: x.icode, name: x.name || x.icode, email: x.email || '', accounts: [], total: 0 }
    const v = x.v == null ? null : Number(x.v)
    const closed = v != null && Math.abs(v) < CLOSED_BELOW && x.v2 != null && Math.abs(Number(x.v2)) < CLOSED_BELOW
    p.accounts.push({ qcode: x.qcode, strategy: x.strategy || null, value: v, asOf: x.as_of || null, closed })
    if (v != null && !closed) p.total += v
    byIcode.set(x.icode, p)
  }
  return [...byIcode.values()]
}

export async function managedPerson(icode: string): Promise<Person | null> {
  const all = await managedPeople(icode)
  return all.find(p => p.icode.toUpperCase() === icode.trim().toUpperCase()) || null
}

/** The session payload an admin views a managed person with: read-only, their QAC codes only. */
export function managedSessionPayload(p: Person, adminEmail: string) {
  const codes = p.accounts.map(a => a.qcode)
  return {
    userId: p.icode, email: p.email, clientCode: codes[0] || p.icode, clientId: p.icode,
    accountCodes: codes, ownerIds: [p.icode], groupId: null as any, isHeadOfFamily: false,
    isImpersonated: true, impersonatedBy: adminEmail, viewOnly: true, managed: true,
  }
}

/** Snapshot in /api/mobile/portfolio/snapshot's shape: one owner (the person) with their QAC accounts. */
export async function managedSnapshot(icode: string) {
  const p = await managedPerson(icode)
  if (!p) return null
  const accounts = p.accounts.map(a => ({
    id: a.qcode, strategyPrefix: 'QAC', strategyName: managedLabel(a.strategy), strategyColor: MANAGED_COLOR,
    hasOrbis: false, type: 'Managed account', clientId: p.icode, lastUpdated: a.asOf, portfolioValue: Math.round((a.value || 0) * 100) / 100,
    status: a.closed ? 'closed' : 'active', isClosed: a.closed, closedOn: a.closed ? a.asOf : null, mobile: null, managed: true,
  }))
  const total = Math.round(p.total * 100) / 100
  return {
    owners: [{ id: p.icode, name: p.name, email: p.email, groupId: null, isHeadOfFamily: false, totalValue: total, accounts }],
    totalPortfolioValue: total, formattedTotal: null, activeAccountCount: accounts.filter(a => !a.isClosed).length,
    isHeadOfFamily: false, groupId: null, managed: true,
  }
}

/**
 * Holdings for QAC accounts in lib/securities.ts row shape: each account's latest broker holdings (console equity
 * and mutual funds, whichever is newest per account). Value = quantity × last price, cost = quantity × average price.
 */
export async function managedHoldingRows(codes: string[]) {
  if (!codes.length) return []
  const [eq, mf] = await Promise.all([
    pool.query(
      `SELECT h.qcode, h.date::text AS d, h.symbol, h.isin, h.quantity::float8 AS qty, h.average_price::float8 AS avg, h.last_price::float8 AS ltp
         FROM public.console_equity_holdings h
         JOIN (SELECT qcode, max(date) AS d FROM public.console_equity_holdings WHERE qcode = ANY($1) GROUP BY qcode) m ON m.qcode = h.qcode AND m.d = h.date`, [codes]),
    pool.query(
      `SELECT h.qcode, h.date::text AS d, h.fund_name, h.isin, h.quantity::float8 AS qty, h.average_price::float8 AS avg, h.last_price::float8 AS ltp
         FROM public.console_mf_holdings h
         JOIN (SELECT qcode, max(date) AS d FROM public.console_mf_holdings WHERE qcode = ANY($1) GROUP BY qcode) m ON m.qcode = h.qcode AND m.d = h.date`, [codes]),
  ])
  const rows: any[] = []
  for (const h of eq.rows) {
    const qty = Number(h.qty) || 0
    rows.push({
      ws_account_code: h.qcode, holding_date: h.d, security_type: 'e', security_code: h.symbol, security_name: h.symbol,
      holding_qty: qty, cost: qty * (Number(h.avg) || 0), mktvalue: qty * (Number(h.ltp) || 0), mktprice: h.ltp,
      detailtypename: /BEES$|ETF/i.test(String(h.symbol || '')) ? 'ETF' : 'Equity', isin: h.isin,
    })
  }
  for (const h of mf.rows) {
    const qty = Number(h.qty) || 0
    rows.push({
      ws_account_code: h.qcode, holding_date: h.d, security_type: 'm', security_code: h.isin, security_name: h.fund_name || h.isin,
      holding_qty: qty, cost: qty * (Number(h.avg) || 0), mktvalue: qty * (Number(h.ltp) || 0), mktprice: h.ltp,
      detailtypename: 'Mutual Fund', isin: h.isin,
    })
  }
  return rows
}
