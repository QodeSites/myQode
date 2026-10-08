// Recent Activity / Transactions list: the custodian's own money-movement entries, read straight from
// pms_clients_tracker.pms_transactions (the same table the Transactions report reads), and only the kinds the
// investor did on purpose (decided 8 Oct 2026):
//
//   positive  Corpus Deposits (CS+), Security in (OPI), Full Switch In (SII)
//   negative  Corpus Withdrawal (CS-), Security out (OPO), Full Switch Out (SOO)
//
// Nothing else: no TDS on payout, partial switches, fees, charges, interest, trades — and nothing within these six left out either.
// Amounts are as the custodian booked them.
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
  return r.rows
    .map((x: any) => {
      const k = KINDS[x.kind], amount = k.sign * Math.abs(Number(x.amt) || 0)
      return { date: x.date, amount, type: amount >= 0 ? 'inflow' : 'outflow', label: k.label, detail: strat(x.code),
        code: x.code, kind: x.kind, memo: x.memo, formattedAmount: formatINR(amount) } as LedgerFlow
    })
    .filter(f => Math.abs(f.amount) >= 0.005)
}
