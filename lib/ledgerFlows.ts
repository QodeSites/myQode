// Recent Activity / Transactions list: the custodian's own money-movement entries, read straight from
// pms_clients_tracker.pms_transactions (the same table the Transactions report reads), and only the kinds the
// investor did on purpose (decided 8 Oct 2026):
//
//   positive  Corpus Deposits (CS+), Security in (OPI), Full Switch In (SII)
//   negative  Corpus Withdrawal (CS-), Security out (OPO), Full Switch Out (SOO)
//
// Nothing else: no TDS on payout, partial switches, fees, charges, interest, trades — and nothing within these six left out either.
// Amounts are as the custodian booked them.
//
// own: whether the investor made it himself (Recent Activity shows only these; totals and the Transactions page keep
// everything). Decided 8 Oct 2026: only money in and out of the investor's bank —
//   own      Corpus Deposit (CS+), its first per account labelled First Investment and "Top Up" memos Top-up;
//            Corpus Withdrawal (CS-)
//   not own  Security In / Out (OPI / OPO: shares moved in, corporate actions, MF→share changes), Full Switch In / Out,
//            a dividend booked as corpus in, and a CS± that the custodian paired with a same-day OPI / OPO of the
//            same amount (e.g. 7 Aug 2026, City Union Bank shares "switched in" against a ₹215.96 "Corpus Out").
// (Until 8 Oct this list was built from pms_master_sheet's daily net cash_in_out, labelled by matching it to these
// rows; a re-valued or unmatched day then went unexplained or missing.)
import { query as q1 } from '@/lib/db1'
import { query } from '@/lib/db'
import { getStrategyName } from '@/lib/strategyConfig'

const KINDS: Record<string, { label: string; sign: 1 | -1 }> = {
  'CS+': { label: 'Corpus Deposit', sign: 1 },
  OPI: { label: 'Security In', sign: 1 },
  SII: { label: 'Full Switch In', sign: 1 },
  'CS-': { label: 'Corpus Withdrawal', sign: -1 },
  OPO: { label: 'Security Out', sign: -1 },
  SOO: { label: 'Full Switch Out', sign: -1 },
}
const strat = (code: string) => { const n = getStrategyName(code); return n === 'Unknown Strategy' ? code : n }

export type LedgerFlow = {
  date: string              // YYYY-MM-DD
  amount: number            // signed: in positive, out negative
  type: 'inflow' | 'outflow'
  label: string             // the kind, as above
  detail: string            // the strategy
  code: string              // strategy account
  kind: string              // tran_type
  memo: string              // custodian's note
  own: boolean              // made by the investor (see above)
  formattedAmount: string
}

export const formatINR = (amount: number): string =>
  `${amount >= 0 ? '+' : '–'}₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Strategy accounts behind an id: a strategy code itself, or every account of an owner / group id. */
export async function accountsBehind(id: string): Promise<string[]> {
  if (/^Q[A-Z]{2}\d/i.test(id)) return [id.toUpperCase()]
  const plain = id.replace(/\.0+$/, '')
  const r = await query(
    `SELECT DISTINCT clientcode FROM pms_clients_master
      WHERE clientcode IS NOT NULL AND (ownerid IN ($1, $2) OR groupid IN ($1, $2))`, [plain, plain + '.0'])
  return r.rows.map((x: any) => x.clientcode)
}

/** The intentional money movements of these accounts, oldest first; `upTo` (YYYY-MM-DD) caps a closed account. */
export async function ledgerFlows(codes: string[], upTo?: string | null): Promise<LedgerFlow[]> {
  if (!codes.length) return []
  const r = await q1(
    `SELECT ws_account_code AS code, tran_type AS kind, trandate::text AS date, net_amount::float8 AS amt, COALESCE(descmemo, '') AS memo
       FROM pms_clients_tracker.pms_transactions
      WHERE ws_account_code = ANY($1) AND tran_type = ANY($2) ${upTo ? 'AND trandate <= $3' : ''}
      ORDER BY trandate, id`, upTo ? [codes, Object.keys(KINDS), upTo] : [codes, Object.keys(KINDS)])
  const rows = r.rows.map((x: any) => ({ ...x, abs: Math.round(Math.abs(Number(x.amt) || 0) * 100) }))
  // a corpus entry the custodian booked against a security moving in / out on the same day, for the same amount
  const sec = new Set(rows.filter((x: any) => x.kind === 'OPI' || x.kind === 'OPO').map((x: any) => `${x.code}|${x.date}|${x.abs}`))
  const firstIn = new Map<string, string>()   // account → date of its first corpus deposit
  for (const x of rows) if (x.kind === 'CS+' && !/dividend/i.test(x.memo) && !firstIn.has(x.code)) firstIn.set(x.code, x.date)
  const seenFirst = new Set<string>()
  return rows
    .map((x: any) => {
      const k = KINDS[x.kind], amount = k.sign * Math.abs(Number(x.amt) || 0)
      const cash = x.kind === 'CS+' || x.kind === 'CS-'
      const paired = cash && sec.has(`${x.code}|${x.date}|${x.abs}`)
      const dividend = x.kind === 'CS+' && /dividend/i.test(x.memo)
      const own = cash && !paired && !dividend
      let label = k.label
      if (own && x.kind === 'CS+') {
        if (firstIn.get(x.code) === x.date && !seenFirst.has(x.code)) { label = 'First Investment'; seenFirst.add(x.code) }
        else if (/top\s*-?\s*up/i.test(x.memo)) label = 'Top-up'
      }
      if (dividend) label = 'Dividend'
      return { date: x.date, amount, type: amount >= 0 ? 'inflow' : 'outflow', label, detail: strat(x.code),
        code: x.code, kind: x.kind, memo: x.memo, own, formattedAmount: formatINR(amount) } as LedgerFlow
    })
    .filter(f => Math.abs(f.amount) >= 0.005)
}
