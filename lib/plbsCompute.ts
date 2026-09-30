// "Profit and loss account - Balance sheet" of one or more strategy accounts, in Nuvama WealthSpectrum's layout
// (report "ProfitLossAccount", sample export reports/Z1713_144_ProfitLossAccount1213UT.csv):
//
//   P&L for [from, to]       INCOME     Dividend, Interest, Realized Gain/Loss                    → TOTAL
//                            EXPENSES   Custodian Fees, Management Fees, STT, Other Expenses      → TOTAL
//                            SURPLUS FOR THE PERIOD = income − expenses (unrealised gains are NOT in it)
//   Unrealised block         At the end / at the beginning / net during the period, for investments and for
//                            options, and the combined net (shown under the P&L, not added to the surplus)
//   Balance sheet at `to`    LIABILITIES  Capital contribution − withdrawals + reserves and surplus
//                            (beginning + for the period = ending) + current liabilities and provisions
//                            ASSETS       Investments at cost, net options purchase position, futures / options
//                            margin, current assets (bank, receivable against sale, outstanding dividend)
//                            Both sides at COST: portfolio value = total assets + unrealised − current liabilities.
//
// Computed by Qode from Nuvama's own feeds. Every rule below was reconciled line by line against Nuvama's report for
// all 636 accounts over 01/04/2025 – 25/09/2026 (see the notes in each step; mismatches are listed in the handover):
//
//   Dividend        pms_corporate_benefits type 'Dividend' by ex-date (Nuvama accrues on the ex-date) + 'RD0'
//                   (dividend reinvested in liquid ETF units) + the dividend still outstanding at `to` when `to` is
//                   past the last ex-date loaded into pms_corporate_benefits (that feed lags; see outstanding below).
//                   Cash in lieu of fractions is not dividend (Nuvama books it as a sale).
//   Interest        'IN1' interest received + 'CSI' cash interest, by transaction date.
//   Realised        pms_capital_gains (latest import) realised gain for sale dates in the period, all security types
//                   (shares, mutual funds, options) + securities transferred OUT of the account ('OPO' Stock Out /
//                   Switch Out, not an asset-type conversion): Nuvama books the transfer value (the OPO amount) as
//                   sale proceeds, so the gain is that amount − the lots' cost on the last holding date before it.
//   Custodian Fees  'CUS'.       Management Fees  'MGF' management + 'PRF' performance fees.
//   STT             the stt column of every trade (BY-, SL+, OBY, CSL) + 'STT' / 'E21' charge entries.
//   Other Expenses  'E01' fund accounting, 'E03' exit load GST, 'E09' clearing, 'E10' audit, 'E12' bank, 'E20' AIF
//                   derivative brokerage. Brokerage, GST and exchange fees on trades are NOT expenses: Nuvama keeps
//                   them in the trade's cost / proceeds, so they are inside realised and unrealised gains.
//                   All by booking (transaction) date: accrual basis, as in Nuvama (unpaid charges are payables).
//                   'TDP' (TDS on payouts) is a withdrawal, not an expense.
//   Unrealised      pms_holdings on each account's last holding date on or before the date: market value − cost,
//                   options (security_type 'o', not margin) separately; beginning = the day before `from`.
//   Capital         Corpus in ('CS+'), switches in ('PSI', 'SII') and securities brought in ('OPI' Stock In / Switch
//                   In at their book cost, dated by the settlement date = the day they came in; asset-type conversion
//                   pairs "Change in Asset type MF to Shares" are left out), from inception to the date.
//   Withdrawals     'CS-', 'PSO', 'SOO', 'TDP', 'TDO' (tax withheld moved to the capital account) and securities
//                   transferred out ('OPO', at the transfer value).
//   Reserves        beginning = what the value implies on the day before `from`:
//                   portfolio value − unrealised − (capital − withdrawals); for the period = the computed surplus.
//   Current liab.   Payable against purchases (buys not yet settled) + fees billed and unpaid on the date
//                   (pms_expense_statement: booked on or before, settled after or not yet), split custodian /
//                   management / other.
//   Assets          Investments at cost and net options purchase position (cost of open options) from pms_holdings;
//                   futures / options margin = the 'Initial Margin' holding rows; balance with banks = the bank row of
//                   pms_holdings (on dates since 5 Sep 2026, when Nuvama started sending cash rows), otherwise derived
//                   from the portfolio value (value − securities and margin at market − receivables + payables);
//                   receivable against sale = sales not yet settled; outstanding dividend = the gap between the
//                   portfolio value and everything held, on dates with cash rows.
//
// Reconciliation: the surplus implied by the portfolio value (change in reserves = Δ(value − unrealised − net
// capital)) is compared with the computed surplus; the difference, if any, is reported and shown as a line in the
// balance sheet. Nothing is plugged into the P&L.
import { query as q1 } from '@/lib/db1'
import { query as qMain } from '@/lib/db'

type Row = Record<string, any>
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * 86400000).toISOString().slice(0, 10)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-08-28" → "28 Aug 2026" (for the notes printed under a line). */
const dmy = (d: string) => `${d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`
/** Start of the Indian financial year (1 April) containing `d`. */
export const fyStart = (d: string) => `${+d.slice(5, 7) >= 4 ? d.slice(0, 4) : +d.slice(0, 4) - 1}-04-01`

export const PLBS_NOTE = 'Computed by Qode from Nuvama transaction, holdings and expense data.'
export const PLBS_BASIS =
  'Accrual basis, as in Nuvama: income and charges by booking date, dividends by ex-date, realised gains by sale date. ' +
  'The surplus excludes unrealised gains, which are shown separately. The balance sheet is at cost: portfolio value = ' +
  'total assets + unrealised gain − current liabilities. Brokerage and GST on trades are part of the trade cost, so ' +
  'they sit inside realised and unrealised gains rather than under expenses.'

// ── line keys (shared with scripts/import-nuvama-pnl.mjs, which stores Nuvama's own report under these keys) ──────
export const LINE_LABELS: Record<string, string> = {
  dividend: 'Dividend', interest: 'Interest', realised: 'Realized gain/loss', incomeTotal: 'Total income',
  custodian: 'Custodian fees', management: 'Management fees', stt: 'Securities transaction tax (STT)', other: 'Other expenses',
  expenseTotal: 'Total expenses', surplus: 'Surplus for the period',
  eqEnd: 'At the end of the period', eqBegin: 'At the beginning of the period', eqNet: 'Net unrealised gain/loss during the period',
  optEnd: 'At the end of the period (options)', optBegin: 'At the beginning of the period (options)',
  optNet: 'Net unrealised gain/loss during the period (options)', unrealisedNet: 'Net unrealised gain/loss',
  capital: 'Capital contribution', withdrawals: 'Less: withdrawals', reservesBegin: 'Reserves and surplus, beginning',
  reservesPeriod: 'Reserves and surplus, for the period', reservesEnd: 'Reserves and surplus, ending',
  payablePurchases: 'Payable against purchases', custodianPayable: 'Custodian fees, billed / payable',
  managementPayable: 'Management fees, billed / payable', otherPayable: 'Other expenses, billed / payable',
  currentLiabilities: 'Current liabilities and provisions', liabilitiesTotal: 'Total',
  investmentsAtCost: 'Investments at cost', optionsPosition: 'Net options purchase position',
  futuresMargin: 'Futures margin account', optionsMargin: 'Options margin account',
  bank: 'Balance with banks', receivableSale: 'Receivable against sale', outstandingDividend: 'Outstanding dividend',
  currentAssets: 'Current assets', assetsTotal: 'Total',
}
const INCOME = ['dividend', 'interest', 'realised'], EXPENSES = ['custodian', 'management', 'stt', 'other']
const CUR_LIAB = ['payablePurchases', 'custodianPayable', 'managementPayable', 'otherPayable']
const CUR_ASSETS = ['bank', 'receivableSale', 'outstandingDividend']
export type Lines = Record<string, number>
/** Extra lines Nuvama may print that have no fixed key: "x:<section>:<label>" (section income | expenses | liab | assets). */
const extras = (lines: Lines, section: string): StatementLine[] =>
  Object.keys(lines).filter(k => k.startsWith(`x:${section}:`)).map(k => ({ key: k, label: k.split(':').slice(2).join(':'), amount: r2(lines[k]) }))

export type StatementLine = { key: string; label: string; amount: number; note?: string }
export type PlbsStatement = {
  accountId: string; accounts: string[]; from: string; to: string; asOf: string
  computed: boolean; note: string | null; basis: string
  coverage: { from: string | null; to: string | null }
  pnl: { income: StatementLine[]; incomeTotal: number; expenses: StatementLine[]; expenseTotal: number; surplus: number }
  unrealised: { investments: { end: number; begin: number; net: number }; options: { end: number; begin: number; net: number } | null; net: number }
  balanceSheet: {
    asOf: string
    liabilities: { capital: number; withdrawals: number; reserves: { begin: number; period: number; end: number };
      current: StatementLine[]; currentTotal: number; difference: number; total: number }
    assets: { investmentsAtCost: number; optionsPosition: number | null; futuresMargin: number | null; optionsMargin: number | null
      current: StatementLine[]; currentTotal: number; total: number }
  }
  items: { group: string; label: string; amount: number; note?: string }[]
  totals: { income: number; expenses: number; surplus: number; unrealised: number; liabilities: number; assets: number; portfolioValue: number | null }
  reconciliation: { expected: number | null; computed: number; diff: number | null; balanceDiff: number
    portfolioValue: number | null; valueFromStatement: number; valueDiff: number | null; note: string }
  lines: Lines
}

const line = (lines: Lines, key: string, note?: string): StatementLine => ({ key, label: LINE_LABELS[key], amount: r2(lines[key] || 0), ...(note ? { note } : {}) })

/**
 * The response for a set of keyed lines (computed here, or a stored Nuvama report): P&L, unrealised block, balance
 * sheet, a flat `items` list and the totals. Totals are recomputed from the lines, so a stored report and a computed
 * one print the same way. `recon` carries the value-based checks (computed statements only).
 */
export function statementFromLines(lines: Lines, meta: {
  accounts: string[]; from: string; to: string; computed: boolean; note: string | null; coverage: { from: string | null; to: string | null }
  portfolioValue?: number | null; expectedSurplus?: number | null; notes?: Record<string, string>
}): PlbsStatement {
  const L = (k: string) => lines[k] || 0
  const notes = meta.notes || {}
  const income = [...INCOME.map(k => line(lines, k, notes[k])), ...extras(lines, 'income')]
  // Nuvama leaves out a management fee line when there is none (e.g. an account billed only on performance).
  const expenses = [...EXPENSES.filter(k => k !== 'management' || Math.abs(L(k)) >= 0.005).map(k => line(lines, k, notes[k])), ...extras(lines, 'expenses')]
  // A stored Nuvama report keeps Nuvama's printed totals (they can differ from the sum of the lines by a paisa).
  const pick = (k: string, v: number) => (!meta.computed && lines[k] != null ? r2(lines[k]) : v)
  const incomeTotal = pick('incomeTotal', r2(income.reduce((s, x) => s + x.amount, 0))), expenseTotal = pick('expenseTotal', r2(expenses.reduce((s, x) => s + x.amount, 0)))
  const surplus = pick('surplus', r2(incomeTotal - expenseTotal))
  const hasOptions = ['optEnd', 'optBegin'].some(k => Math.abs(L(k)) >= 0.005) || lines.optNet != null
  const inv = { end: r2(L('eqEnd')), begin: r2(L('eqBegin')), net: r2(L('eqEnd') - L('eqBegin')) }
  const opt = hasOptions ? { end: r2(L('optEnd')), begin: r2(L('optBegin')), net: r2(L('optEnd') - L('optBegin')) } : null
  const unrealisedNet = r2(inv.net + (opt ? opt.net : 0))

  const current = [...CUR_LIAB.filter(k => k === 'payablePurchases' || Math.abs(L(k)) >= 0.005).map(k => line(lines, k, notes[k])), ...extras(lines, 'liab')]
  const currentTotal = pick('currentLiabilities', r2(current.reduce((s, x) => s + x.amount, 0)))
  const reserves = { begin: r2(L('reservesBegin')), period: surplus, end: pick('reservesEnd', r2(L('reservesBegin') + surplus)) }
  const curA = [...CUR_ASSETS.filter(k => k !== 'outstandingDividend' || Math.abs(L(k)) >= 0.005).map(k => line(lines, k, notes[k])), ...extras(lines, 'assets')]
  const curATotal = pick('currentAssets', r2(curA.reduce((s, x) => s + x.amount, 0)))
  const opt0 = (k: string) => (Math.abs(L(k)) >= 0.005 || lines[k] != null ? r2(L(k)) : null)
  const assets = {
    investmentsAtCost: r2(L('investmentsAtCost')), optionsPosition: opt0('optionsPosition'), futuresMargin: opt0('futuresMargin'), optionsMargin: opt0('optionsMargin'),
    current: curA, currentTotal: curATotal, total: 0,
  }
  assets.total = pick('assetsTotal', r2(assets.investmentsAtCost + (assets.optionsPosition || 0) + (assets.futuresMargin || 0) + (assets.optionsMargin || 0) + curATotal))
  const capital = r2(L('capital')), withdrawals = r2(L('withdrawals'))
  const liabBefore = r2(capital - withdrawals + reserves.end + currentTotal)
  // A computed statement shows a gap of more than ₹1 between the two sides as its own line, "Other / reconciliation";
  // a smaller one (rounding) is left out of the statement and reported in reconciliation.balanceDiff. A stored Nuvama
  // report is printed as Nuvama sent it, so its own total is kept.
  const balanceDiff = r2(assets.total - liabBefore)
  const difference = meta.computed && Math.abs(balanceDiff) > 1 ? balanceDiff : 0
  const liabTotal = meta.computed ? r2(liabBefore + difference) : r2(lines.liabilitiesTotal ?? liabBefore)
  // Portfolio value from the statement: assets at cost + unrealised gain at the end − current liabilities.
  const valueFromStatement = r2(assets.total + inv.end + (opt ? opt.end : 0) - currentTotal)
  const pv = meta.portfolioValue ?? null
  const expected = meta.expectedSurplus ?? null

  const items = [
    ...income.map(x => ({ group: 'Income', label: x.label, amount: x.amount, ...(x.note ? { note: x.note } : {}) })),
    { group: 'Income', label: 'Total income', amount: incomeTotal },
    ...expenses.map(x => ({ group: 'Expenses', label: x.label, amount: x.amount, ...(x.note ? { note: x.note } : {}) })),
    { group: 'Expenses', label: 'Total expenses', amount: expenseTotal },
    { group: 'Surplus', label: 'Surplus for the period', amount: surplus },
    { group: 'Unrealised', label: 'Investments, end', amount: inv.end }, { group: 'Unrealised', label: 'Investments, beginning', amount: inv.begin },
    { group: 'Unrealised', label: 'Investments, net', amount: inv.net },
    ...(opt ? [{ group: 'Unrealised', label: 'Options, end', amount: opt.end }, { group: 'Unrealised', label: 'Options, beginning', amount: opt.begin }, { group: 'Unrealised', label: 'Options, net', amount: opt.net }] : []),
    { group: 'Unrealised', label: 'Net unrealised gain/loss', amount: unrealisedNet },
    { group: 'Liabilities', label: 'Capital contribution', amount: capital }, { group: 'Liabilities', label: 'Less: withdrawals', amount: withdrawals },
    { group: 'Liabilities', label: 'Reserves and surplus, beginning', amount: reserves.begin }, { group: 'Liabilities', label: 'Reserves and surplus, for the period', amount: reserves.period },
    { group: 'Liabilities', label: 'Reserves and surplus, ending', amount: reserves.end },
    ...current.map(x => ({ group: 'Liabilities', label: x.label, amount: x.amount })),
    ...(difference ? [{ group: 'Liabilities', label: 'Other / reconciliation', amount: difference, note: 'Difference between the surplus implied by the portfolio value and the computed surplus' }] : []),
    { group: 'Liabilities', label: 'Total liabilities', amount: liabTotal },
    { group: 'Assets', label: 'Investments at cost', amount: assets.investmentsAtCost },
    ...(assets.optionsPosition != null ? [{ group: 'Assets', label: 'Net options purchase position', amount: assets.optionsPosition }] : []),
    ...(assets.futuresMargin != null ? [{ group: 'Assets', label: 'Futures margin account', amount: assets.futuresMargin }] : []),
    ...(assets.optionsMargin != null ? [{ group: 'Assets', label: 'Options margin account', amount: assets.optionsMargin }] : []),
    ...curA.map(x => ({ group: 'Assets', label: x.label, amount: x.amount, ...(x.note ? { note: x.note } : {}) })),
    { group: 'Assets', label: 'Total assets', amount: assets.total },
  ]
  const reconNote = meta.computed
    ? (expected == null ? 'No portfolio value on record for this period.'
      : Math.abs(expected - surplus) <= 1 ? 'The computed surplus agrees with the change in portfolio value (after unrealised gains and capital flows) within ₹1.'
      : 'The computed surplus differs from the change in portfolio value (after unrealised gains and capital flows); the difference is shown as "Other / reconciliation" in the balance sheet.')
    : "Nuvama's own report, as imported."
  return {
    accountId: meta.accounts.join(','), accounts: meta.accounts, from: meta.from, to: meta.to, asOf: meta.to,
    computed: meta.computed, note: meta.note, basis: '', coverage: meta.coverage,
    pnl: { income, incomeTotal, expenses, expenseTotal, surplus },
    unrealised: { investments: inv, options: opt, net: unrealisedNet },
    balanceSheet: {
      asOf: meta.to,
      liabilities: { capital, withdrawals, reserves, current, currentTotal, difference, total: liabTotal },
      assets,
    },
    items,
    totals: { income: incomeTotal, expenses: expenseTotal, surplus, unrealised: unrealisedNet, liabilities: liabTotal, assets: assets.total, portfolioValue: pv },
    reconciliation: {
      expected: expected == null ? null : r2(expected), computed: surplus, diff: expected == null ? null : r2(expected - surplus), balanceDiff,
      portfolioValue: pv, valueFromStatement, valueDiff: pv == null ? null : r2(pv - valueFromStatement), note: reconNote,
    },
    lines,
  }
}

// ── the computation ────────────────────────────────────────────────────────────────────────────────────────────
const TX = 'pms_clients_tracker.pms_transactions', HOLD = 'pms_clients_tracker.pms_holdings'
const CONV = `descmemo ILIKE 'Change in Asset type%'`   // MF ↔ shares re-typing: an OPI / OPO pair, not a transfer
const CAPITAL_IN = ['CS+', 'PSI', 'SII', 'OPI'], CAPITAL_OUT = ['CS-', 'PSO', 'SOO', 'TDP', 'OPO']
const TRADES = ['BY-', 'SL+', 'OBY', 'CSL']
const OTHER_EXP = ['E01', 'E03', 'E09', 'E10', 'E12', 'E20']

/** Holdings split into statement buckets, per account, on its last holding date on or before `beg` and `end`. */
async function holdingBuckets(codes: string[], beg: string, end: string) {
  const res = await q1(
    `WITH h AS (
       SELECT ws_account_code a, holding_date d, security_type st, detailtypename dt, security_name sn, cost, mktvalue
         FROM ${HOLD} WHERE ws_account_code = ANY($1) AND holding_date <= $3),
     last AS (SELECT a, max(d) FILTER (WHERE d <= $2) d0, max(d) d1 FROM h GROUP BY a)
     SELECT h.a, h.d::text AS d, (h.d = last.d1) AS is_end, (h.d = last.d0) AS is_beg,
            CASE WHEN h.st = 'c' THEN (CASE WHEN h.sn = 'Cash/Bank Balance' THEN 'bank' ELSE 'recpay' END)
                 WHEN h.dt = 'Initial Margin' THEN (CASE WHEN h.st = 'f' THEN 'fmargin' ELSE 'omargin' END)
                 WHEN h.st = 'o' THEN 'opt' ELSE 'inv' END AS b,
            COALESCE(sum(h.cost), 0)::float8 AS cost, COALESCE(sum(h.mktvalue), 0)::float8 AS mv
       FROM h JOIN last ON last.a = h.a AND (h.d = last.d0 OR h.d = last.d1)
      GROUP BY 1, 2, 3, 4, 5`, [codes, beg, end])
  type B = { date: string | null; cash: boolean; inv: [number, number]; opt: [number, number]; omargin: number; fmargin: number; bank: number; recpay: number }
  const blank = (): B => ({ date: null, cash: false, inv: [0, 0], opt: [0, 0], omargin: 0, fmargin: 0, bank: 0, recpay: 0 })
  const out: Record<string, { beg: B; end: B }> = {}
  for (const r of res.rows) {
    const acc = (out[r.a] ||= { beg: blank(), end: blank() })
    for (const side of [r.is_beg ? acc.beg : null, r.is_end ? acc.end : null]) {
      if (!side) continue
      side.date = r.d
      if (r.b === 'inv' || r.b === 'opt') { side[r.b as 'inv' | 'opt'][0] += r.cost; side[r.b as 'inv' | 'opt'][1] += r.mv }
      else if (r.b === 'bank' || r.b === 'recpay') { side[r.b as 'bank' | 'recpay'] += r.mv; side.cash = true }
      else side[r.b as 'omargin' | 'fmargin'] += r.mv
    }
  }
  return out
}

/**
 * Nuvama-style P&L and balance sheet of `codes` (strategy account codes; several = summed, "All accounts") for the
 * period [from, to] (yyyy-mm-dd, inclusive). The balance sheet is as of `to`.
 */
export async function computePlbs(codes: string[], from: string, to: string): Promise<PlbsStatement> {
  const beg = addDays(from, -1)
  const [txRes, divRes, cgRes, tradeRes, payRes, msRes, holds, opoRes] = await Promise.all([
    // Transactions by type: in the period, before it, and up to `to`. OPI is dated by its settlement date (the day
    // the securities came in; trandate is the original purchase date of a migrated lot).
    q1(
      `WITH t AS (
         SELECT tran_type, net_amount, COALESCE(stt, 0) AS stt, (tran_type IN ('OPI', 'OPO') AND ${CONV}) AS conv,
                CASE WHEN tran_type = 'OPI' THEN COALESCE(set_date, trandate) ELSE trandate END AS d
           FROM ${TX} WHERE ws_account_code = ANY($1) AND trandate <= $3)
       SELECT tran_type, conv,
              COALESCE(sum(net_amount) FILTER (WHERE d >= $2 AND d <= $3), 0)::float8 AS p,
              COALESCE(sum(net_amount) FILTER (WHERE d < $2), 0)::float8 AS pre,
              COALESCE(sum(net_amount) FILTER (WHERE d <= $3), 0)::float8 AS upto,
              COALESCE(sum(stt) FILTER (WHERE d >= $2 AND d <= $3), 0)::float8 AS stt
         FROM t GROUP BY 1, 2`, [codes, from, to]),
    q1(
      `SELECT COALESCE(sum(amount) FILTER (WHERE ex_date >= $2 AND ex_date <= $3), 0)::float8 AS div,
              (SELECT max(ex_date)::text FROM pms_clients_tracker.pms_corporate_benefits) AS loaded_to
         FROM pms_clients_tracker.pms_corporate_benefits WHERE accountcode = ANY($1) AND type = 'Dividend'`, [codes, from, to]),
    q1(
      `SELECT COALESCE(sum(g.realized_gain) FILTER (WHERE g.sale_date >= $2 AND g.sale_date <= $3), 0)::float8 AS realised,
              min(g.as_of_date)::text AS as_of
         FROM pms_clients_tracker.pms_capital_gains g
        WHERE g.account_code = ANY($1)
          AND g.as_of_date = (SELECT max(x.as_of_date) FROM pms_clients_tracker.pms_capital_gains x WHERE x.account_code = g.account_code)`,
      [codes, from, to]),
    // Trades on or before `to` that settle after it.
    q1(
      `SELECT ws_account_code AS a, COALESCE(sum(net_amount) FILTER (WHERE tran_type IN ('SL+', 'CSL')), 0)::float8 AS recv,
              COALESCE(sum(net_amount) FILTER (WHERE tran_type IN ('BY-', 'OBY')), 0)::float8 AS pay
         FROM ${TX} WHERE ws_account_code = ANY($1) AND tran_type = ANY($3) AND trandate <= $2 AND set_date > $2 GROUP BY 1`, [codes, to, TRADES]),
    // Charges booked on or before `to` and not settled by then (latest expense statement import per account).
    q1(
      `SELECT account_code AS a, CASE WHEN detail ILIKE 'Custod%' THEN 'custodianPayable'
                   WHEN detail IN ('Management Fees', 'Performance Fees') THEN 'managementPayable' ELSE 'otherPayable' END AS k,
              COALESCE(sum(amount), 0)::float8 AS amt
         FROM pms_clients_tracker.pms_expense_statement e
        WHERE account_code = ANY($1) AND txn_date <= $2 AND (settlement_date IS NULL OR settlement_date > $2)
          AND as_of_date = (SELECT max(x.as_of_date) FROM pms_clients_tracker.pms_expense_statement x WHERE x.account_code = e.account_code)
        GROUP BY 1, 2`, [codes, to]),
    qMain(
      `SELECT account_code, min(report_date)::text AS f, max(report_date)::text AS l,
              (array_agg(portfolio_value ORDER BY report_date DESC) FILTER (WHERE report_date <= $3))[1]::float8 AS pv1,
              (array_agg(report_date::text ORDER BY report_date DESC) FILTER (WHERE report_date <= $3))[1] AS d1,
              (array_agg(portfolio_value ORDER BY report_date DESC) FILTER (WHERE report_date <= $2))[1]::float8 AS pv0,
              (array_agg(report_date::text ORDER BY report_date DESC) FILTER (WHERE report_date <= $2))[1] AS d0
         FROM public.pms_master_sheet WHERE account_code = ANY($1) GROUP BY 1`, [codes, beg, to]),
    holdingBuckets(codes, beg, to),
    // Securities transferred out in the period (their cost is looked up below, only when there are any).
    q1(
      `SELECT id, ws_account_code AS a, security_code AS sc, trandate::text AS d, qty::float8 AS qty, net_amount::float8 AS amt FROM ${TX}
        WHERE ws_account_code = ANY($1) AND tran_type = 'OPO' AND trandate >= $2 AND trandate <= $3 AND NOT (${CONV})`, [codes, from, to]),
  ])

  // ── transactions → income, expenses, capital ──
  const tx = (types: string[], col: 'p' | 'pre' | 'upto' | 'stt' = 'p', conv = false) =>
    txRes.rows.filter(r => types.includes(r.tran_type) && (conv || !r.conv)).reduce((s, r) => s + Number(r[col] || 0), 0)
  const lines: Lines = {}
  const notes: Record<string, string> = {}
  lines.interest = tx(['IN1', 'CSI'])
  lines.custodian = tx(['CUS'])
  lines.management = tx(['MGF', 'PRF'])
  lines.stt = tx(TRADES, 'stt') + tx(['STT', 'E21'])
  lines.other = tx(OTHER_EXP)
  // 'TDO' (tax deducted at source moved to the capital account, e.g. capital gains tax of a PIS / NRI account) is a
  // withdrawal too; its amount is negative. Its 'TDI' twin is the internal leg and is ignored.
  const out = (col: 'pre' | 'upto') => tx(CAPITAL_OUT, col) - tx(['TDO'], col)
  const capitalTo = tx(CAPITAL_IN, 'upto'), withdrawTo = out('upto')
  const netCapBeg = tx(CAPITAL_IN, 'pre') - out('pre'), netCapEnd = capitalTo - withdrawTo

  // ── realised: capital gains statement + securities transferred out ──
  const cg = cgRes.rows[0] || {}
  // Transfer value − cost of the lots, the cost taken from the last holding row of that security before the transfer
  // (scaled when only part of the holding went out). One pass over those securities' holding rows.
  let transferGain = 0
  if (opoRes.rows.length) {
    const hr = await q1(
      `SELECT ws_account_code AS a, security_code AS sc, holding_date::text AS d, cost::float8 AS cost, holding_qty::float8 AS hq FROM ${HOLD}
        WHERE ws_account_code = ANY($1) AND security_code = ANY($2) AND holding_date <= $3 AND security_type <> 'c'`,
      [[...new Set(opoRes.rows.map(o => o.a))], [...new Set(opoRes.rows.map(o => o.sc))], to])
    for (const o of opoRes.rows) {
      let best: Row | null = null
      for (const h of hr.rows) if (h.a === o.a && h.sc === o.sc && h.d < o.d && (!best || h.d > best.d)) best = h
      if (!best || best.cost == null) continue   // no holding on record before the transfer: nothing to measure against
      const share = best.hq ? Math.min(1, Math.abs(o.qty / best.hq)) : 1
      transferGain += o.amt - best.cost * share
    }
  }
  lines.realised = Number(cg.realised || 0) + transferGain
  if (Math.abs(transferGain) >= 0.5) notes.realised = 'Includes gains on securities transferred out of the account, at the transfer value'
  if (cg.as_of && to > cg.as_of) notes.realised = `Capital gains statement imported up to ${dmy(cg.as_of)}; later sales are not included`

  // ── holdings, value and the balance sheet, per account then summed ──
  const ms = new Map(msRes.rows.map(r => [r.account_code, r]))
  let eqEnd = 0, eqBegin = 0, optEnd = 0, optBegin = 0, invCost = 0, optCost = 0, omargin = 0, fmargin = 0
  let bank = 0, outstanding = 0, outstandingBeg = 0, pvEnd: number | null = null, pvBeg = 0, derivedBank = false
  const payables: Record<string, number> = { custodianPayable: 0, managementPayable: 0, otherPayable: 0 }
  const feesOf: Record<string, number> = {}
  for (const r of payRes.rows) { payables[r.k] += Number(r.amt); feesOf[r.a] = (feesOf[r.a] || 0) + Number(r.amt) }
  const tradesOf = new Map(tradeRes.rows.map(r => [r.a, { recv: Number(r.recv), pay: Number(r.pay) }]))
  const recvSale = tradeRes.rows.reduce((s, r) => s + Number(r.recv), 0), payPurch = tradeRes.rows.reduce((s, r) => s + Number(r.pay), 0)
  let firstDate: string | null = null, lastDate: string | null = null
  for (const code of codes) {
    const m = ms.get(code), h = holds[code]
    if (m) {
      firstDate = !firstDate || m.f < firstDate ? m.f : firstDate
      lastDate = !lastDate || m.l > lastDate ? m.l : lastDate
      if (m.pv1 != null) pvEnd = (pvEnd || 0) + m.pv1
      if (m.pv0 != null) pvBeg += m.pv0
    }
    const E = h?.end, B = h?.beg
    if (B && B.date) { eqBegin += B.inv[1] - B.inv[0]; optBegin += B.opt[1] - B.opt[0] }
    if (!E || !E.date) continue
    eqEnd += E.inv[1] - E.inv[0]; optEnd += E.opt[1] - E.opt[0]
    invCost += E.inv[0]; optCost += E.opt[0]; omargin += E.omargin; fmargin += E.fmargin
    const held = E.inv[1] + E.opt[1] + E.omargin + E.fmargin
    if (E.cash) {
      bank += E.bank
      // Outstanding dividend: the value not in any holding row, when the value and the holdings are the same day.
      const gap = m && m.pv1 != null && m.d1 === E.date ? m.pv1 - held - E.bank - E.recpay : 0
      if (gap >= 1) outstanding += gap
    } else {
      // No cash rows on this date: the bank balance is what the value leaves after everything else.
      const t = tradesOf.get(code) || { recv: 0, pay: 0 }
      if (m && m.pv1 != null) bank += m.pv1 - held - t.recv + t.pay + (feesOf[code] || 0)
      derivedBank = true
    }
    if (B && B.cash) {
      const gap = m && m.pv0 != null && m.d0 === B.date ? m.pv0 - (B.inv[1] + B.opt[1] + B.omargin + B.fmargin + B.bank + B.recpay) : 0
      if (gap >= 1) outstandingBeg += gap
    }
  }
  if (derivedBank) notes.bank = 'Derived from the portfolio value (Nuvama sends bank balances only from 5 Sep 2026); includes any dividend receivable'

  // ── dividend: corporate actions by ex-date + reinvested + still outstanding beyond the feed's last ex-date ──
  const div = divRes.rows[0] || {}
  const loadedTo: string | null = div.loaded_to || null
  lines.dividend = Number(div.div || 0) + tx(['RD0'])
  if (loadedTo && to > loadedTo) lines.dividend += outstanding
  if (loadedTo && beg > loadedTo) lines.dividend -= outstandingBeg
  if (loadedTo && to > loadedTo) notes.dividend = `By ex-date; dividends after ${dmy(loadedTo)} are the amount outstanding on ${dmy(to)}`

  lines.eqEnd = eqEnd; lines.eqBegin = eqBegin; lines.optEnd = optEnd; lines.optBegin = optBegin
  lines.capital = capitalTo; lines.withdrawals = withdrawTo
  // Reserves at the start: value − unrealised − net capital on the day before `from` (0 before the account began).
  const reservesBeg = pvBeg - (eqBegin + optBegin) - netCapBeg
  lines.reservesBegin = reservesBeg
  lines.payablePurchases = payPurch
  Object.assign(lines, payables)
  lines.investmentsAtCost = invCost; lines.optionsPosition = optCost; lines.optionsMargin = omargin
  if (Math.abs(fmargin) >= 0.005) lines.futuresMargin = fmargin
  lines.bank = bank; lines.receivableSale = recvSale
  if (outstanding >= 0.005) lines.outstandingDividend = outstanding
  for (const k of Object.keys(lines)) lines[k] = r2(lines[k])

  // Surplus implied by the value: Δ(value − unrealised − net capital) over the period.
  const expected = pvEnd == null ? null : (pvEnd - (eqEnd + optEnd) - netCapEnd) - reservesBeg
  return statementFromLines(lines, {
    accounts: codes, from, to, computed: true, note: PLBS_NOTE, coverage: { from: firstDate, to: lastDate },
    portfolioValue: pvEnd == null ? null : r2(pvEnd), expectedSurplus: expected, notes,
  })
}

/** P&L for a period (with the balance sheet at its end). */
export const computePnl = (codes: string[], from: string, to: string) => computePlbs(codes, from, to)
/** Balance sheet as of a date; its reserves split runs from the start of that financial year. */
export const computeBalanceSheet = (codes: string[], asOf: string) => computePlbs(codes, fyStart(asOf), asOf)

// ── stored Nuvama reports (scripts/import-nuvama-pnl.mjs → pms_clients_tracker.pms_pnl_balance_sheet) ──────────
/** Nuvama's own report for exactly this period, summed over `codes` when every account has one; else null. */
export async function storedPlbs(codes: string[], from: string, to: string): Promise<Lines | null> {
  try {
    const r = await q1(
      `SELECT account_code, lines FROM pms_clients_tracker.pms_pnl_balance_sheet
        WHERE account_code = ANY($1) AND period_from = $2 AND period_to = $3`, [codes, from, to])
    if (!r.rows.length || new Set(r.rows.map(x => x.account_code)).size < codes.length) return null
    const sum: Lines = {}
    for (const x of r.rows) for (const [k, v] of Object.entries(x.lines || {})) sum[k] = r2((sum[k] || 0) + Number(v || 0))
    return sum
  } catch (e: any) {
    if (e && e.code === '42P01') return null   // table not created yet (the import has not been run)
    throw e
  }
}
/** Periods with a stored Nuvama report for all of `codes` (newest first). */
export async function storedPlbsPeriods(codes: string[]): Promise<{ from: string; to: string }[]> {
  try {
    const r = await q1(
      `SELECT period_from::text AS f, period_to::text AS t FROM pms_clients_tracker.pms_pnl_balance_sheet
        WHERE account_code = ANY($1) GROUP BY 1, 2 HAVING count(DISTINCT account_code) = $2 ORDER BY 2 DESC, 1`, [codes, codes.length])
    return r.rows.map(x => ({ from: x.f, to: x.t }))
  } catch (e: any) {
    if (e && e.code === '42P01') return []
    throw e
  }
}

// ── App Store / Play Store reviewer (DEMO001 / DEMO002): a consistent made-up statement, no database reads ─────
const REVIEWER_BASE: Record<string, { value: number; scale: number }> = { DEMO001: { value: 3112400, scale: 1 }, DEMO002: { value: 2210900, scale: 0.71 } }
export function reviewerPlbs(codes: string[], from: string, to: string): PlbsStatement {
  const lines: Lines = {}
  const add = (k: string, v: number) => { lines[k] = r2((lines[k] || 0) + v) }
  let pv = 0
  for (const c of codes) {
    const b = REVIEWER_BASE[c] || REVIEWER_BASE.DEMO001, s = b.scale
    const L = {
      dividend: 8420 * s, interest: 3160 * s, realised: 214600 * s, custodian: 2310 * s, management: 37500 * s, stt: 3090 * s, other: 4720 * s,
      eqEnd: 412300 * s, eqBegin: 268100 * s, optEnd: -2140 * s, optBegin: 0, capital: 2500000 * s, withdrawals: 0,
      reservesBegin: 120400 * s, custodianPayable: 1180 * s, otherPayable: 2940 * s, payablePurchases: 0,
      optionsPosition: 12600 * s, optionsMargin: 96400 * s, receivableSale: 0,
    }
    for (const [k, v] of Object.entries(L)) add(k, v)
    const surplus = L.dividend + L.interest + L.realised - L.custodian - L.management - L.stt - L.other
    const liab = L.capital - L.withdrawals + L.reservesBegin + surplus + L.custodianPayable + L.otherPayable
    const bank = 212400 * s
    add('bank', bank)
    add('investmentsAtCost', liab - bank - L.optionsPosition - L.optionsMargin)
    pv += liab + L.eqEnd + L.optEnd - L.custodianPayable - L.otherPayable
  }
  const st = statementFromLines(lines, { accounts: codes, from, to, computed: true, note: PLBS_NOTE, coverage: { from: '2023-06-01', to: '2026-09-25' }, portfolioValue: r2(pv) })
  const expected = st.pnl.surplus
  return { ...st, reconciliation: { ...st.reconciliation, expected, diff: 0, note: 'The computed surplus agrees with the change in portfolio value (after unrealised gains and capital flows) within ₹1.' } }
}
