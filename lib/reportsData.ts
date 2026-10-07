// Report queries shared by the mobile routes (app/api/mobile/reports/*, JWT) and the web routes
// (app/api/reports/*, signed web session): one implementation, so the app and the website always agree.
// Each returns { status, body }; callers wrap it in NextResponse.json(body, { status }).
import { query } from '@/lib/db1'
import { page, isoDate, n, day, fyRange, TXN_GROUPS, HIDDEN_FROM_ALL, groupOf, directionOf, accountHolder } from '@/lib/mobileReports'
import { computeFactsheet, factsheetCoverage } from '@/lib/factsheetCompute'
import { computePlbs, fyStart, storedPlbs, storedPlbsPeriods, statementFromLines, PLBS_NOTE } from '@/lib/plbsCompute'
import { query as queryMain } from '@/lib/db'

export type ReportResult = { status: number; body: any }
const R = (body: any, init?: { status?: number }): ReportResult => ({ status: init?.status ?? 200, body })
const CG = 'pms_clients_tracker.pms_capital_gains'
const EX = 'pms_clients_tracker.pms_expense_statement'
// Financial year (Apr–Mar) of sale_date, in SQL.
const FY = `(CASE WHEN extract(month FROM sale_date) >= 4 THEN extract(year FROM sale_date) ELSE extract(year FROM sale_date) - 1 END)::int`

export async function transactionsReport(accountId: string, params: URLSearchParams): Promise<ReportResult> {

  const group = params.get('group') || 'all'
  if (group !== 'all' && group !== 'other' && !TXN_GROUPS[group]) return R({ error: 'Unknown group' }, { status: 400 })
  const from = isoDate(params.get('from')), to = isoDate(params.get('to'))
  const { limit, offset } = page(params, 50, params.get('export') === '1' ? 5000 : 200)   // export=1: the whole list for a PDF

  // Shared WHERE for the list: account + dates + group. Securities transferred in ('OPI', Security in) are dated by
  // the day they reached the account (settlement date), as Nuvama's statement does; their trade date is the
  // original purchase elsewhere.
  const D = `(CASE WHEN tran_type = 'OPI' THEN COALESCE(set_date, trandate) ELSE trandate END)`
  const where = ['ws_account_code = $1'], args: any[] = [accountId]
  if (from) { args.push(from); where.push(`${D} >= $${args.length}`) }
  if (to) { args.push(to); where.push(`${D} <= $${args.length}`) }
  const dateWhere = [...where], dateArgs = [...args]
  // The PDF export (export=1) lists Initial Margin too, as Nuvama's transaction statement does; the screen hides it.
  const exporting = params.get('export') === '1'
  if (group === 'all') { args.push(exporting ? HIDDEN_FROM_ALL.filter(c => c !== 'IML') : HIDDEN_FROM_ALL); where.push(`NOT (tran_type = ANY($${args.length}))`) }
  else if (group === 'other') { args.push(Object.values(TXN_GROUPS).flatMap(g => g.codes)); where.push(`NOT (tran_type = ANY($${args.length}))`) }
  else { args.push(TXN_GROUPS[group].codes); where.push(`tran_type = ANY($${args.length})`) }

  try {
    const [list, sums, latest] = await Promise.all([
      query(
        `SELECT id, ${D} AS trandate, set_date, tran_type, tran_desc, security_name, qty, rate, net_amount, exchg, brokerage, stt,
                security_type_description, detailtypename,
                COALESCE(brokerage,0) + COALESCE(servicetax,0) + COALESCE(stt,0) + COALESCE(total_trxnfee,0) + COALESCE(total_trxnfee_stax,0) AS charges,
                txn_ref_no, descmemo
           FROM pms_clients_tracker.pms_transactions
          WHERE ${where.join(' AND ')}
          ORDER BY ${D} DESC, id DESC
          LIMIT ${limit + 1} OFFSET ${offset}`, args),
      query(
        `SELECT tran_type, count(*)::int AS c, COALESCE(sum(net_amount),0) AS amt
           FROM pms_clients_tracker.pms_transactions WHERE ${dateWhere.join(' AND ')} GROUP BY tran_type`, dateArgs),
      query(`SELECT max(trandate) AS d, min(trandate) AS f FROM pms_clients_tracker.pms_transactions WHERE ws_account_code = $1`, [accountId]),
    ])

    const summary = Object.keys(TXN_GROUPS).map(g => ({ group: g, label: TXN_GROUPS[g].label, count: 0, amount: 0 }))
    // Money in / out is the client's own money: top-ups and withdrawals, plus securities transferred in / out
    // (not the MF-to-shares re-typing pairs). Switches between strategies are reported apart (switchIn / switchOut):
    // counted as money in and out they doubled a family's figures (Mittle family: ₹15.71 Cr switched on 2 Mar 2026
    // showed as ₹17.96 Cr "taken out" against ₹2.24 Cr of real withdrawals). Across all accounts the two legs of an
    // internal switch cancel.
    let moneyIn = 0, moneyOut = 0, switchIn = 0, switchOut = 0
    for (const r of sums.rows) {
      const s = summary.find(x => x.group === groupOf(r.tran_type))
      if (s) { s.count += r.c; s.amount += Number(r.amt) }
      const a = Math.abs(Number(r.amt))
      if (r.tran_type === 'CS+') moneyIn += a
      else if (r.tran_type === 'CS-') moneyOut += a
      else if (r.tran_type === 'PSI' || r.tran_type === 'SII') switchIn += a
      else if (r.tran_type === 'PSO' || r.tran_type === 'SOO') switchOut += a
    }
    const moved = await query(
      `SELECT COALESCE(sum(abs(net_amount)) FILTER (WHERE tran_type = 'OPI'), 0)::float8 AS sin, COALESCE(sum(abs(net_amount)) FILTER (WHERE tran_type = 'OPO'), 0)::float8 AS sout
         FROM pms_clients_tracker.pms_transactions WHERE ${dateWhere.join(' AND ')} AND tran_type IN ('OPI', 'OPO') AND COALESCE(descmemo, '') NOT ILIKE 'Change in Asset type%'`, dateArgs)
    moneyIn += Number(moved.rows[0]?.sin || 0); moneyOut += Number(moved.rows[0]?.sout || 0)

    const rows = list.rows.slice(0, limit)
    const holder = await accountHolder(accountId)
    return R({
      holder, accountId, asOf: day(latest.rows[0]?.d), group, from, to, summary, moneyIn, moneyOut, switchIn, switchOut,
      coverage: { from: day(latest.rows[0]?.f), to: day(latest.rows[0]?.d) },   // earliest and latest dates on record
      items: rows.map(r => ({
        id: r.id, date: day(r.trandate), settleDate: day(r.set_date), code: r.tran_type, type: r.tran_desc,
        group: groupOf(r.tran_type), direction: directionOf(r.tran_type),
        security: r.security_name || null, qty: n(r.qty), rate: n(r.rate), amount: n(r.net_amount), charges: n(r.charges),
        ref: r.txn_ref_no || null, notes: r.descmemo || null,
        // for the statement PDF (Nuvama's layout): exchange (blank for off-market entries), brokerage and STT apart,
        // and the asset class it is grouped under ("Shares - Listed", "Options - Index", …)
        exchange: r.exchg && r.exchg !== 'DIR' ? r.exchg : null, brokerage: n(r.brokerage), stt: n(r.stt),
        assetClass: [r.security_type_description, r.detailtypename].filter(Boolean).join(' - ') || null,
        // Nuvama's "Settlement Amount": STT added to a purchase and taken off a sale (it is not in net_amount)
        settlement: n(Number(r.net_amount || 0) + (directionOf(r.tran_type) === 'out' ? 1 : directionOf(r.tran_type) === 'in' ? -1 : 0) * Number(r.stt || 0)),
      })),
      hasMore: list.rows.length > limit,
    })
  } catch (err) {
    console.error('[mobile/reports/transactions]', err)
    return R({ error: 'Could not load transactions' }, { status: 500 })
  }
}

export async function capitalGainsReport(accountId: string, params: URLSearchParams): Promise<ReportResult> {
  const { limit, offset } = page(params, 50, params.get('export') === '1' ? 5000 : 200)   // export=1: the whole list for a PDF
  const term = params.get('term') === 'ST' || params.get('term') === 'LT' ? params.get('term') : null

  try {
    const asOfRes = await query(`SELECT max(as_of_date) AS d FROM ${CG} WHERE account_code = $1`, [accountId])
    const asOf = asOfRes.rows[0]?.d
    if (!asOf) return R({ accountId, asOf: null, fy: null, years: [], summary: null, items: [], hasMore: false })

    const yearsRes = await query(
      `SELECT ${FY} AS y,
              COALESCE(sum(realized_gain) FILTER (WHERE term = 'ST'), 0) AS st,
              COALESCE(sum(realized_gain) FILTER (WHERE term = 'LT'), 0) AS lt,
              count(*)::int AS lots
         FROM ${CG} WHERE account_code = $1 AND as_of_date = $2 GROUP BY 1 ORDER BY 1 DESC`, [accountId, asOf])
    const years = yearsRes.rows.map(r => ({ fy: `${r.y}-${String((r.y + 1) % 100).padStart(2, '0')}`, st: n(r.st), lt: n(r.lt), total: Number(r.st) + Number(r.lt), lots: r.lots }))
    // A from / to range (sale date) takes precedence over a financial year.
    const from = isoDate(params.get('from')), to = isoDate(params.get('to'))
    const cov = (await query(`SELECT min(sale_date) AS f, max(sale_date) AS t FROM ${CG} WHERE account_code = $1 AND as_of_date = $2`, [accountId, asOf])).rows[0]
    const coverage = { from: day(cov?.f), to: day(cov?.t) }
    const reqFy = params.get('fy')
    const fy = from || to ? null : years.find(y => y.fy === reqFy)?.fy ?? years[0]?.fy ?? null
    if (!fy && !from && !to) return R({ accountId, asOf: day(asOf), fy: null, years, coverage, summary: null, items: [], hasMore: false })
    const [start, end] = fy ? fyRange(fy) : [from || '1900-01-01', to || '2999-12-31']

    const base = [accountId, asOf, start, end]
    const termSql = term ? ` AND term = $5` : ''
    const [cat, lots] = await Promise.all([
      query(
        `SELECT category,
                COALESCE(sum(realized_gain) FILTER (WHERE term = 'ST'), 0) AS st,
                COALESCE(sum(realized_gain) FILTER (WHERE term = 'LT'), 0) AS lt,
                COALESCE(sum(effective_gain_lt) FILTER (WHERE term = 'LT'), 0) AS lt_taxable
           FROM ${CG} WHERE account_code = $1 AND as_of_date = $2 AND sale_date BETWEEN $3 AND $4
          GROUP BY category ORDER BY category`, base),
      query(
        `SELECT sale_date, purchase_date, security_name, security_type, category, sale_qty, sale_rate, sale_amount,
                purchase_rate, purchase_amount, effective_cost, realized_gain, effective_gain_lt, term, days_held
           FROM ${CG} WHERE account_code = $1 AND as_of_date = $2 AND sale_date BETWEEN $3 AND $4${termSql}
          ORDER BY ${params.get('export') === '1' ? 'category, security_name, sale_date' : 'sale_date DESC, id DESC'} LIMIT ${limit + 1} OFFSET ${offset}`, term ? [...base, term] : base),
    ])
    const byCategory = cat.rows.map(r => ({ category: r.category, st: n(r.st), lt: n(r.lt), ltTaxable: n(r.lt_taxable) }))
    const st = byCategory.reduce((s, c) => s + (c.st || 0), 0), lt = byCategory.reduce((s, c) => s + (c.lt || 0), 0)
    const ltTaxable = byCategory.reduce((s, c) => s + (c.ltTaxable || 0), 0)

    const holder = await accountHolder(accountId)
    return R({
      holder, accountId, asOf: day(asOf), fy, from, to, coverage, term, years,
      summary: { st, lt, ltTaxable, total: st + lt, byCategory },
      items: lots.rows.slice(0, limit).map(r => ({
        saleDate: day(r.sale_date), purchaseDate: day(r.purchase_date), security: r.security_name, securityType: r.security_type,
        category: r.category, qty: n(r.sale_qty), saleRate: n(r.sale_rate), saleAmount: n(r.sale_amount),
        purchaseRate: n(r.purchase_rate), purchaseAmount: n(r.purchase_amount), cost: n(r.effective_cost), gain: n(r.realized_gain),
        ltTaxable: r.term === 'LT' ? n(r.effective_gain_lt) : null, term: r.term, daysHeld: n(r.days_held),
      })),
      hasMore: lots.rows.length > limit,
    })
  } catch (err) {
    console.error('[mobile/reports/capital-gains]', err)
    return R({ error: 'Could not load capital gains' }, { status: 500 })
  }
}

export async function expensesReport(accountId: string, params: URLSearchParams): Promise<ReportResult> {
  const { limit, offset } = page(params, 50, params.get('export') === '1' ? 5000 : 200)   // export=1: the whole list for a PDF
  const type = params.get('type')

  try {
    const head = await query(
      `SELECT as_of_date, strategy, period_from, period_to FROM ${EX} WHERE account_code = $1 ORDER BY as_of_date DESC LIMIT 1`, [accountId])
    const h = head.rows[0]
    if (!h) return R({ accountId, asOf: null, strategy: null, period: null, paid: 0, payable: 0, byType: [], items: [], hasMore: false })

    const from = isoDate(params.get('from')), to = isoDate(params.get('to'))
    const base: any[] = [accountId, h.as_of_date]
    let rangeSql = ''
    if (from) { base.push(from); rangeSql += ` AND txn_date >= $${base.length}` }
    if (to) { base.push(to); rangeSql += ` AND txn_date <= $${base.length}` }
    const [types, list] = await Promise.all([
      query(
        `SELECT detail, status, COALESCE(sum(amount),0) AS amt, count(*)::int AS c
           FROM ${EX} WHERE account_code = $1 AND as_of_date = $2${rangeSql} GROUP BY detail, status`, base),
      query(
        `SELECT txn_date, settlement_date, detail, notes, amount, status
           FROM ${EX} WHERE account_code = $1 AND as_of_date = $2${rangeSql}${type ? ` AND detail = $${base.length + 1}` : ''}
          ORDER BY txn_date DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`, type ? [...base, type] : base),
    ])
    let paid = 0, payable = 0
    const byTypeMap = new Map<string, { type: string; amount: number; count: number }>()
    for (const r of types.rows) {
      const amt = Number(r.amt)
      r.status === 'payable' ? (payable += amt) : (paid += amt)
      const t = byTypeMap.get(r.detail) || { type: r.detail, amount: 0, count: 0 }
      t.amount += amt; t.count += r.c; byTypeMap.set(r.detail, t)
    }

    const holder = await accountHolder(accountId)
    return R({
      holder, accountId, asOf: day(h.as_of_date), strategy: h.strategy, period: { from: day(h.period_from), to: day(h.period_to) }, from, to,
      type, paid, payable, byType: [...byTypeMap.values()].sort((x, y) => y.amount - x.amount),
      items: list.rows.slice(0, limit).map(r => ({
        date: day(r.txn_date), settleDate: day(r.settlement_date), type: r.detail, notes: r.notes, amount: n(r.amount), status: r.status,
      })),
      hasMore: list.rows.length > limit,
    })
  } catch (err) {
    console.error('[mobile/reports/expenses]', err)
    return R({ error: 'Could not load expenses' }, { status: 500 })
  }
}

// Fact sheet. A stored Nuvama snapshot (pms_factsheet) is served when one exists for exactly the requested date (or,
// with no date, the latest snapshot); any other date is computed by Qode from the NAV series, holdings and cash flows
// (lib/factsheetCompute.ts), flagged `computed: true`. `dates` lists the stored snapshots; `coverage` is the range a
// fact sheet can be computed for (the account's first to latest NAV date).
export const COMPUTED_FACTSHEET_NOTE =
  "Computed by Qode from Nuvama transaction and holdings data. Benchmark returns use the price index; Nuvama's fact sheet uses the total-return index."
export async function factsheetReport(accountId: string, params: URLSearchParams): Promise<ReportResult> {

  try {
    const date = isoDate(params.get('date'))
    const [datesRes, coverage, stored] = await Promise.all([
      query(`SELECT DISTINCT as_of_date FROM pms_clients_tracker.pms_factsheet WHERE account_code = $1 ORDER BY as_of_date DESC`, [accountId]),
      factsheetCoverage(accountId),
      query(
        `SELECT * FROM pms_clients_tracker.pms_factsheet WHERE account_code = $1${date ? ' AND as_of_date = $2' : ''} ORDER BY as_of_date DESC LIMIT 1`,
        date ? [accountId, date] : [accountId]),
    ])
    const dates = datesRes.rows.map(x => day(x.as_of_date))
    // "Latest" is the newest day with data: Nuvama's stored fact sheet only when it is that day, otherwise computed
    // (an upload from a few days ago must not hide the days since).
    const r = !date && coverage.to && dates[0] && coverage.to > dates[0] ? null : stored.rows[0]
    if (r) {
      const holder = await accountHolder(accountId)
      return R({
        holder, accountId, asOf: day(r.as_of_date), dates, date, coverage, computed: false, strategy: r.strategy, inceptionDate: day(r.inception_date),
        contribution: n(r.contribution), withdrawal: n(r.withdrawal), profitLoss: n(r.profit_loss),
        portfolioValue: n(r.portfolio_value), valueDate: day(r.value_date),
        returns: r.returns, sectors: r.sectors || [], holdings: r.holdings || [],
      })
    }

    const asOf = date || coverage.to
    if (!asOf || !coverage.from || asOf < coverage.from) return R({ accountId, asOf: null, dates, date, coverage })
    const [c, holder] = await Promise.all([computeFactsheet(accountId, asOf), accountHolder(accountId)])
    if (!c) return R({ accountId, asOf: null, dates, date, coverage })
    return R({ holder, accountId, dates, date, coverage, ...c, strategy: c.strategy ?? holder.strategy, note: COMPUTED_FACTSHEET_NOTE })
  } catch (err) {
    console.error('[mobile/reports/factsheet]', err)
    return R({ error: 'Could not load the fact sheet' }, { status: 500 })
  }
}

// Profit and loss account - Balance sheet (Nuvama's "ProfitLossAccount" layout; lib/plbsCompute.ts). accountId is one
// strategy account code or a comma list (the "All accounts" view: every line summed). A Nuvama report stored by
// scripts/import-nuvama-pnl.mjs for exactly this period (and every account) is served as is; any other period is
// computed by Qode, flagged `computed: true` with the note. `periods` lists the stored Nuvama periods; `coverage` is
// the range of dates on record (first to latest portfolio value). ?from=&to= (default: this financial year to the
// latest value date; both clamped to the dates on record, so an early `from` means since inception); the balance
// sheet is as of `to`. No statement (asOf null) when the period is entirely outside the dates on record.
// From: the first portfolio value or the first money / securities brought in, whichever is earlier (a migrated
// account's securities can come in a day or two before its first value). To: the latest portfolio value or the
// latest transaction, whichever is later (a closed account's value series stops on the closing day, but its final
// payouts and charges are booked in the days after).
async function plbsCoverage(codes: string[]) {
  const [ms, tx] = await Promise.all([
    queryMain(`SELECT min(report_date)::text AS f, max(report_date)::text AS t FROM public.pms_master_sheet WHERE account_code = ANY($1)`, [codes]),
    query(
      `SELECT min(CASE WHEN tran_type = 'OPI' THEN COALESCE(set_date, trandate) ELSE trandate END)
                FILTER (WHERE tran_type IN ('CS+', 'PSI', 'SII', 'OPI'))::text AS f,
              max(trandate)::text AS t
         FROM pms_clients_tracker.pms_transactions WHERE ws_account_code = ANY($1)`, [codes]),
  ])
  const min = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a || b)
  const max = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a || b)
  const m = ms.rows[0] || {}, t = tx.rows[0] || {}
  if (!m.t) return { from: null, to: null }   // no portfolio value on record: nothing to state
  return { from: min(m.f ?? null, t.f ?? null), to: max(m.t ?? null, t.t ?? null) }
}
async function plbsReport(codes: string[], from: string | null, to: string | null): Promise<ReportResult> {
  try {
    const [coverage, periods] = await Promise.all([plbsCoverage(codes), storedPlbsPeriods(codes)])
    if (!coverage.to || !coverage.from) return R({ accountId: codes.join(','), accounts: codes, asOf: null, from, to, coverage, periods })
    if (from && to && from > to) return R({ error: 'The From date must be on or before the To date.' }, { status: 400 })
    // Clamp to the dates on record: a period may start before the first value (= since inception) and end after the
    // latest one (e.g. "this FY" to today), which is the same statement as the one on the latest value date.
    const end = !to || to > coverage.to ? coverage.to : to
    let start = from || fyStart(end)
    if (start < coverage.from) start = coverage.from
    if (end < coverage.from || start > end)
      return R({ accountId: codes.join(','), accounts: codes, asOf: null, from, to, coverage, periods })
    const holder = codes.length === 1 ? await accountHolder(codes[0]) : null
    const stored = await storedPlbs(codes, start, end)
    const body = stored
      ? statementFromLines(stored, { accounts: codes, from: start, to: end, computed: false, note: null, coverage })
      : await computePlbs(codes, start, end)
    return R({ ...body, holder, periods, coverage })
  } catch (err) {
    console.error('[reports/pnl]', err)
    return R({ error: 'Could not load the profit and loss account' }, { status: 500 })
  }
}
const codesOf = (accountId: string) => [...new Set(accountId.split(',').map(s => s.trim()).filter(Boolean))]
export const pnlReport = (accountId: string, params: URLSearchParams) =>
  plbsReport(codesOf(accountId), isoDate(params.get('from')), isoDate(params.get('to')))
/** Balance sheet as of ?date= (default the latest value date); its P&L runs from the start of that financial year. */
export const balanceSheetReport = (accountId: string, params: URLSearchParams) => {
  const date = isoDate(params.get('date'))
  return plbsReport(codesOf(accountId), date ? fyStart(date) : null, date)
}
export { PLBS_NOTE }
