// The "raw data" workbook for one investor (GET /api/admin/bo/users/raw-data): everything needed to recompute their
// returns by hand in Excel. Same layout as the one first built for Yogita Agrawal on 9 Oct 2026:
//
//   Calculation        per owner (all their accounts together) and per account: every cash flow from the daily sheet
//                      (investor's view: money in negative), the same flows bought/sold in Nifty 50, today's value, then
//                      XIRR, Nifty XIRR, alpha, money in, values today and CAGR from NAV — all live Excel formulas
//   <code> daily       pms_master_sheet: date, NAV, portfolio value, cash in/out (owner rows use the owner id as code);
//                      when the first NAV isn't 10, a NAV 10 row the day before inception leads, as on the dashboard
//   Nifty 50           tblresearch_new closes from a little before the first daily row
//   Custodian ledger   pms_transactions: deposits, withdrawals, switches, fees, TDS, interest, dividends
//
// Accounts are every client code on the investor's login email (open and closed); owners are their owner ids.
import { query } from '@/lib/db'
import { query as q1 } from '@/lib/db1'
import { query as q2 } from '@/lib/db2'
import { day } from '@/lib/mobileReports'
import { Workbook, type Sheet } from '@/lib/xlsxFormulas'

const STRATEGY: Record<string, string> = { QAW: 'All Weather', QGF: 'Growth Fund', QTF: 'Tactical Fund', QLF: 'Liquid Fund', QFH: 'Future Horizons' }
const LEDGER_TYPES = ['CS+', 'CS-', 'PSI', 'PSO', 'SII', 'SOO', 'OPI', 'OPO', 'TDP', 'TDO', 'TDI', 'MGF', 'IN1', 'DIV']
const ownerCode = (v: unknown) => String(v ?? '').trim().replace(/\.0+$/, '')
const date = (s: string) => new Date(s + 'T00:00:00Z')
const dayBefore = (s: string) => { const d = date(s); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

export async function buildRawDataWorkbook(email: string): Promise<{ name: string; file: Buffer } | null> {
  const acc = (await query(
    `SELECT clientcode, clientname, ownerid, maturity_date,
            NULLIF(trim(concat_ws(' ', firstname, middlename, lastname)), '') AS person
       FROM pms_clients_master WHERE lower(trim(email)) = $1 AND clientcode IS NOT NULL
      ORDER BY head_of_family DESC NULLS LAST, clientcode`, [email.trim().toLowerCase()])).rows as any[]
  if (!acc.length) return null
  const name = acc[0].person || acc[0].clientname || email
  const accounts = acc.map(a => ({
    code: String(a.clientcode), closed: !!a.maturity_date && new Date(a.maturity_date) <= new Date(),
  }))
  const owners = [...new Set(acc.map(a => ownerCode(a.ownerid)).filter(Boolean))]

  // Daily rows per code: owners first (all accounts together), then each account.
  const codes = [...owners, ...accounts.map(a => a.code)]
  const dailyRows = (await query(
    `SELECT account_code, report_date, nav::float8 AS nav, portfolio_value::float8 AS value, cash_in_out::float8 AS cf
       FROM public.pms_master_sheet WHERE account_code = ANY($1::text[]) ORDER BY account_code, report_date`, [codes])).rows as any[]
  const daily = new Map<string, { d: string; nav: number | null; v: number | null; cf: number }[]>()
  for (const r of dailyRows) {
    if (!daily.has(r.account_code)) daily.set(r.account_code, [])
    daily.get(r.account_code)!.push({ d: day(r.report_date)!, nav: r.nav, v: r.value, cf: r.cf || 0 })
  }
  const withData = codes.filter(c => daily.get(c)?.length)
  const first = withData.map(c => daily.get(c)![0].d).sort()[0]

  const nifty = first ? (await q2(
    `SELECT date, nav::float8 AS nav FROM public.tblresearch_new
      WHERE indices = 'NIFTY 50' AND date >= ($1::date - 10) ORDER BY date`, [first])).rows.map((x: any) => ({ d: day(x.date)!, v: x.nav as number })) : []
  const ledger = (await q1(
    `SELECT ws_account_code AS c, trandate::text AS d, tran_type AS t, net_amount::float8 AS a, COALESCE(descmemo, '') AS m
       FROM pms_clients_tracker.pms_transactions
      WHERE ws_account_code = ANY($1::text[]) AND tran_type = ANY($2::text[]) ORDER BY trandate, ws_account_code`,
    [accounts.map(a => a.code), LEDGER_TYPES])).rows as any[]

  const wb = new Workbook()
  const calc = wb.sheet('Calculation', [38, 22, 16, 18, 22, 12], false)
  const header = (ws: Sheet, cols: string[]) => cols.forEach((h, i) => ws.set(1, i + 1, h, 'header'))

  // The performance page's NAV chart starts at 10: when the first NAV isn't exactly 10 it prepends a NAV 10 row the
  // day before inception (app/(protected)/portfolio/performance/page.tsx). Same here, with no value or cash flow.
  const lastRow: Record<string, number> = {}, firstRow: Record<string, number> = {}, synthetic: Record<string, boolean> = {}
  for (const c of withData) {
    const ws = wb.sheet(`${c} daily`, [12, 10, 18, 16])
    header(ws, ['Date', 'NAV', 'Portfolio value (₹)', 'Cash in/out (₹)'])
    const rows = daily.get(c)!
    synthetic[c] = Number(rows[0].nav) !== 10
    if (synthetic[c]) { ws.set(2, 1, date(dayBefore(rows[0].d)), 'date'); ws.set(2, 2, 10, 'nav') }
    firstRow[c] = synthetic[c] ? 3 : 2
    rows.forEach((x, i) => {
      const r = firstRow[c] + i
      ws.set(r, 1, date(x.d), 'date'); ws.set(r, 2, x.nav, 'nav'); ws.set(r, 3, x.v, 'money'); ws.set(r, 4, x.cf, 'signed')
    })
    lastRow[c] = firstRow[c] + rows.length - 1
  }
  const nf = wb.sheet('Nifty 50', [12, 14])
  header(nf, ['Date', 'Nifty 50 close'])
  nifty.forEach((x, i) => { nf.set(i + 2, 1, date(x.d), 'date'); nf.set(i + 2, 2, x.v, 'money') })
  const NL = nifty.length + 1
  const lg = wb.sheet('Custodian ledger', [11, 12, 7, 16, 60])
  header(lg, ['Account', 'Date', 'Type', 'Amount (₹)', 'Memo'])
  ledger.forEach((x, i) => {
    lg.set(i + 2, 1, x.c); lg.set(i + 2, 2, date(String(x.d).slice(0, 10)), 'date'); lg.set(i + 2, 3, x.t); lg.set(i + 2, 4, x.a, 'money'); lg.set(i + 2, 5, x.m)
  })
  lg.set(ledger.length + 3, 1, 'Types: CS+ deposit · CS- withdrawal · PSI/PSO partial switch in/out · SII/SOO switch in/out · OPI/OPO opening in/out · TDP/TDO/TDI TDS · MGF management fee · IN1 interest · DIV dividend', 'note')

  // ── Calculation ──
  calc.set(1, 1, `${name}: XIRR, Nifty on the same cash flows, CAGR, from the raw data`, 'title')
  calc.set(2, 1, "Flows link to the daily sheets (Cash in/out, sign flipped to the investor's view: money in negative, money out positive) plus the latest value; every result is an Excel formula.", 'note')
  const label = (c: string) => owners.includes(c)
    ? `Owner ${c} (all ${accounts.length} account${accounts.length === 1 ? '' : 's'})`
    : `${c} ${STRATEGY[c.slice(0, 3)] || ''}${accounts.find(a => a.code === c)?.closed ? ' (closed)' : ''}`.trim()
  const nifAt = (r: number) => NL > 1 ? `=INDEX('Nifty 50'!$B$2:$B$${NL},MATCH(A${r},'Nifty 50'!$A$2:$A$${NL},1))` : null
  let r = 4
  for (const c of withData) {
    const rows = daily.get(c)!.map((x, i) => ({ src: i + firstRow[c], cf: x.cf })).filter(x => x.cf !== 0)
    if (!rows.length) continue
    const sh = `'${c} daily'`, last = lastRow[c]
    calc.set(r++, 1, label(c), 'title')
    ;['Date', 'Flow (investor view, ₹)', 'Nifty 50 that day', 'Nifty units bought (+) / sold (−)', 'Same flows in Nifty (₹)', 'Source row in daily sheet']
      .forEach((h, i) => calc.set(r, i + 1, h, 'header'))
    const top = ++r
    for (const x of rows) {
      calc.set(r, 1, `=${sh}!A${x.src}`, 'date')
      calc.set(r, 2, `=-${sh}!D${x.src}`, 'signed')
      calc.set(r, 3, nifAt(r), 'money')
      calc.set(r, 4, `=-B${r}/C${r}`, 'nav')
      calc.set(r, 5, `=B${r}`, 'signed')
      calc.set(r, 6, x.src)
      r++
    }
    // The latest value closes the flows (positive: what the investor would get back today).
    calc.set(r, 1, `=${sh}!A${last}`, 'boldDate')
    calc.set(r, 2, `=${sh}!C${last}`, 'boldMoney')
    calc.set(r, 3, nifAt(r), 'boldMoney')
    calc.set(r, 4, '(latest value)', 'note')
    calc.set(r, 5, `=SUM(D${top}:D${r - 1})*C${r}`, 'boldMoney')
    calc.set(r, 6, last)
    const end = r
    r += 2
    const results: [string, string, 'resultPct' | 'resultMoney' | 'resultText'][] = [
      ['XIRR, your money (a year)', `=XIRR(B${top}:B${end},A${top}:A${end})`, 'resultPct'],
      ['XIRR, same money in Nifty 50 (a year)', `=XIRR(E${top}:E${end},A${top}:A${end},-0.1)`, 'resultPct'],
      ['Alpha (difference)', `=B${r}-B${r + 1}`, 'resultPct'],
      ['Money put in (₹)', `=-SUMIF(B${top}:B${end - 1},"<0")`, 'resultMoney'],
      ['Value today (₹)', `=B${end}`, 'resultMoney'],
      ['Same money in Nifty today (₹)', `=E${end}`, 'resultMoney'],
      ['First NAV / last NAV', `=TEXT(${sh}!B2,"0.0000") & " → " & TEXT(${sh}!B${last},"0.0000")`, 'resultText'],
      // Base date: the NAV 10 row when there is one, else the day before the first row (whose NAV is already 10).
      ['CAGR from NAV (Returns %)', `=(${sh}!B${last}/10)^(365.25/(${sh}!A${last}-${synthetic[c] ? `${sh}!A2` : `(${sh}!A2-1)`}))-1`, 'resultPct'],
    ]
    for (const [lab, f, st] of results) { calc.set(r, 1, lab, 'bold'); calc.set(r, 2, f, st); r++ }
    calc.set(r, 1, "CAGR uses NAV 10 on the day before inception (the app's rule); XIRR uses Excel's 365-day year; the Nifty XIRR starts from a guess of −10% (Excel's default 10% can stall at 0%).", 'note')
    r += 3
  }
  if (r === 4) calc.set(4, 1, 'No cash flows recorded yet for these accounts.', 'note')

  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'investor'
  return { name: `${slug}-raw-data-${new Date().toISOString().slice(0, 10)}.xlsx`, file: wb.toBuffer() }
}
