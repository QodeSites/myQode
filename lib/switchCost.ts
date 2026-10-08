// NOT USED since 8 Oct 2026: invested amounts count switches at their value on the day, as the custodian books them
// (decided by Sanket for every account; see app/api/mobile/portfolio/performance/route.ts). Kept for reference.
//
// Switches between a member's own strategy accounts, at cost.
//
// A switch moves money from one of the member's accounts to another at its value on the day. Counted as the
// custodian books it, the receiving account's "amount invested" includes the gain the money had already made in the
// account it came from, so the account's own total returns understate (QGF00133: ₹55,40,326 came in from two closed
// accounts whose owner had put in ₹52,49,655; the ₹2,90,671 gained there vanished from the account's returns, and the
// member's combined view — which counts only outside money — showed a different "invested" figure).
//
// Here every switch is re-valued at cost: a switch in adds what the money originally cost in the account it left
// (that account's net invested just before, pro rata for a partial switch); a switch out removes the same share of
// this account's own cost. Outside deposits and withdrawals are untouched. With this, an account's invested amount
// and total returns add up across a member's accounts to the member's combined figures.
import pool from '@/lib/db'
import { query as query1 } from '@/lib/db1'
import { closures } from '@/lib/accountClosure'

const IN = ['PSI', 'SII'], OUT = ['PSO', 'SOO']
const iso = (d: any) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString() : String(d)).slice(0, 10)

export type SwitchAdjustment = {
  date: string              // YYYY-MM-DD
  amount: number            // the value moved, as booked (positive in, negative out)
  cost: number              // what that money cost (positive in, negative out)
  adjust: number            // cost − amount: what to add to the booked cash flows
  from?: string[]           // a switch in: the accounts it came from
}

// An account's net invested (Σ cash_in_out) and portfolio value just before a date.
async function costBefore(code: string, date: string): Promise<{ cost: number; value: number }> {
  const r = await pool.query(
    `SELECT COALESCE((SELECT sum(cash_in_out)::float8 FROM public.pms_master_sheet WHERE account_code = $1 AND report_date < $2), 0) AS cost,
            COALESCE((SELECT portfolio_value::float8 FROM public.pms_master_sheet WHERE account_code = $1 AND report_date < $2 AND portfolio_value > 0 ORDER BY report_date DESC LIMIT 1), 0) AS value`,
    [code, date])
  return { cost: Number(r.rows[0]?.cost || 0), value: Number(r.rows[0]?.value || 0) }
}
// The share of an account's cost that `amount` of its value represents (all of it when the whole value moved).
const costShare = (amount: number, c: { cost: number; value: number }) => (c.value > 0 && amount < c.value * 0.995 ? c.cost * (amount / c.value) : c.cost)

/** The switch adjustments for one strategy account (pms_master_sheet code), oldest first. Empty when it never switched. */
export async function switchAdjustments(accountId: string): Promise<SwitchAdjustment[]> {
  const own = await pool.query(`SELECT ownerid FROM pms_clients_master WHERE clientcode = $1`, [accountId])
  const ownerId = own.rows[0]?.ownerid
  if (!ownerId) return []
  const sib = await pool.query(`SELECT clientcode FROM pms_clients_master WHERE ownerid = $1 AND clientcode <> $2`, [ownerId, accountId])
  const siblings: string[] = sib.rows.map((r: any) => r.clientcode)
  const tx = await query1(
    `SELECT ws_account_code AS code, trandate, tran_type, net_amount::float8 AS amt
       FROM pms_clients_tracker.pms_transactions
      WHERE ws_account_code = ANY($1) AND tran_type = ANY($2) ORDER BY trandate`,
    [[accountId, ...siblings], [...IN, ...OUT]])
  const rows = tx.rows.map((r: any) => ({ code: r.code, date: iso(r.trandate), type: r.tran_type, amt: Math.abs(Number(r.amt) || 0) }))
  // Money switched into an account that is closed is not capital moved but money spent (it settles the closed
  // account's last charges, e.g. TDS): cost 0 on both sides, as the member's combined view treats it.
  const closedMap = await closures([accountId, ...siblings])
  const isClosed = (code: string) => !!closedMap.get(code)?.closed
  const out: SwitchAdjustment[] = []
  for (const t of rows.filter(r => r.code === accountId)) {
    if (IN.includes(t.type)) {
      // the money came from the siblings that switched out the same day, at what it cost them
      const sources = rows.filter(r => r.code !== accountId && r.date === t.date && OUT.includes(r.type))
      let cost = 0
      if (isClosed(accountId)) cost = 0
      else {
        for (const s of sources) cost += costShare(s.amt, await costBefore(s.code, s.date))
        const totalOut = sources.reduce((a, s) => a + s.amt, 0)
        if (sources.length && totalOut > 0) cost *= Math.min(1, t.amt / totalOut)   // this account's share, if several received
        else cost = t.amt                                                              // no matching source: as booked
      }
      out.push({ date: t.date, amount: t.amt, cost, adjust: cost - t.amt, from: sources.map(s => s.code) })
    } else {
      // money left for a sibling: remove the same share of this account's own cost — unless every receiver is a
      // closed account, in which case the money was spent there and stays in this account's cost
      const receivers = rows.filter(r => r.code !== accountId && r.date === t.date && IN.includes(r.type)).map(r => r.code)
      if (!receivers.length) continue
      const cost = receivers.every(isClosed) ? 0 : costShare(t.amt, await costBefore(accountId, t.date))
      out.push({ date: t.date, amount: -t.amt, cost: -cost, adjust: -cost + t.amt })
    }
  }
  return out
}

/** Σ adjust up to a date (inclusive), to add to a sum of booked cash flows. */
export const switchAdjustTotal = (adj: SwitchAdjustment[], upTo?: string | null) =>
  adj.filter(a => !upTo || a.date <= upTo).reduce((s, a) => s + a.adjust, 0)
