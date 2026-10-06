// What each cash flow was. The portfolio's cash flows (pms_master_sheet.cash_in_out) carry only a date and a net
// amount, so the app could only say "Invested" or "Withdrawal" — a ₹1,000 top-up and a ₹1,559 tax deduction looked
// like any other. Nuvama's transactions say what moved: a top-up, a switch between strategies, tax deducted, securities
// transferred. Each flow is matched to those rows by amount, within a few days of its date (the value series and the
// transaction can be dated a day or two apart), and gets a label and a detail line:
//
//   { label: 'Top-up', detail: 'Qode Growth Fund' }           { label: 'Moved from Qode Liquid Fund', detail: 'Qode Growth Fund' }
//   { label: 'Tax deducted (TDS)', detail: 'on interest income' }   { label: 'Securities transferred in', detail: … }
//
// Best effort: a flow with no matching rows keeps no label and the app falls back to "Invested" / "Withdrawal".
import { query as q1 } from '@/lib/db1'
import { query } from '@/lib/db'
import { getStrategyName } from '@/lib/strategyConfig'

type Flow = { date: string | Date; amount: number; [k: string]: any }
type Tx = { a: string; t: string; d: string; amt: number; memo: string; signed: number; used?: boolean }

const IN = ['CS+', 'PSI', 'SII', 'OPI'], OUT = ['CS-', 'PSO', 'SOO', 'OPO', 'TDP', 'TDO']
const CONV = /change in asset type/i
const DAY = 86400000
const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10)
const ms = (d: string) => Date.parse(d + 'T00:00:00Z')
const strat = (code: string) => { const n = getStrategyName(code); return n === 'Unknown Strategy' ? code : n }

/** Strategy accounts behind an id: a strategy code itself, or every account of an owner / group id. */
export async function accountsBehind(id: string): Promise<string[]> {
  if (/^Q[A-Z]{2}\d/i.test(id)) return [id.toUpperCase()]
  const plain = id.replace(/\.0+$/, '')
  const r = await query(
    `SELECT DISTINCT clientcode FROM pms_clients_master
      WHERE clientcode IS NOT NULL AND (ownerid IN ($1, $2) OR groupid IN ($1, $2))`, [plain, plain + '.0'])
  return r.rows.map((x: any) => x.clientcode)
}

export async function labelFlows<T extends Flow>(codes: string[], flows: T[]): Promise<(T & { label?: string; detail?: string })[]> {
  if (!codes.length || !flows.length) return flows
  try {
    const r = await q1(
      `SELECT ws_account_code AS a, tran_type AS t, trandate::text AS d, net_amount::float8 AS amt, COALESCE(descmemo, '') AS memo
         FROM pms_clients_tracker.pms_transactions
        WHERE ws_account_code = ANY($1) AND tran_type = ANY($2)`, [codes, [...IN, ...OUT]])
    const txs: Tx[] = r.rows
      .filter((x: any) => !((x.t === 'OPI' || x.t === 'OPO') && CONV.test(x.memo)))
      .map((x: any) => ({ ...x, signed: (OUT.includes(x.t) ? -1 : 1) * Math.abs(Number(x.amt) || 0) }))

    // A switch whose other leg is in this same set is internal to it (the aggregate nets it out): pair them so a
    // switch in can say where it came from.
    const counterpart = (x: Tx) => txs.find(y => y !== x && y.a !== x.a && Math.abs(Math.abs(y.amt) - Math.abs(x.amt)) < 0.01 &&
      Math.abs(ms(y.d) - ms(x.d)) <= 3 * DAY && ((x.t === 'PSI' || x.t === 'SII') ? (y.t === 'PSO' || y.t === 'SOO') : (y.t === 'PSI' || y.t === 'SII')))
    // Each strategy's first money in ("First investment"); Nuvama's own "Initial Cashflow" note also appears on later
    // top-ups, so it isn't used.
    const firstIn = new Set<Tx>()
    for (const code of new Set(txs.map(x => x.a))) {
      const f = txs.filter(x => x.a === code && x.t === 'CS+').sort((a, b) => a.d.localeCompare(b.d))[0]
      if (f) firstIn.add(f)
    }

    const describe = (rows: Tx[]): { label: string; detail?: string } => {
      const kinds = [...new Set(rows.map(x => x.t))]
      const where = [...new Set(rows.map(x => strat(x.a)))].join(', ')
      if (kinds.length === 1) {
        const x = rows[0]
        switch (x.t) {
          case 'CS+': return { label: firstIn.has(x) ? 'First investment' : 'Top-up', detail: where }
          case 'CS-': return { label: 'Withdrawal', detail: where }
          case 'PSI': case 'SII': { const c = counterpart(x); return { label: c ? `Moved from ${strat(c.a)}` : 'Switch in', detail: where } }
          case 'PSO': case 'SOO': { const c = counterpart(x); return { label: c ? `Moved to ${strat(c.a)}` : 'Switch out', detail: where } }
          case 'OPI': return { label: 'Securities transferred in', detail: where }
          case 'OPO': return { label: 'Securities transferred out', detail: where }
          case 'TDP': return { label: 'Tax deducted (TDS)', detail: /interest/i.test(x.memo) ? 'on interest income' : where }
          case 'TDO': return { label: 'Tax withheld', detail: where }
        }
      }
      if (kinds.every(k => k === 'TDP' || k === 'TDO')) return { label: 'Tax deducted (TDS)', detail: 'on interest income' }
      if (kinds.every(k => k === 'CS+')) return { label: rows.every(x => firstIn.has(x)) ? 'First investment' : 'Top-up', detail: where }
      return { label: rows.reduce((s, x) => s + x.signed, 0) >= 0 ? 'Money in' : 'Money out', detail: where }
    }

    return flows.map(f => {
      const d = iso(f.date), amt = Number(f.amount) || 0
      const near = txs.filter(x => !x.used && Math.abs(ms(x.d) - ms(d)) <= 5 * DAY && Math.sign(x.signed) === Math.sign(amt))
        .sort((a, b) => Math.abs(ms(a.d) - ms(d)) - Math.abs(ms(b.d) - ms(d)))
      const tol = Math.max(1, Math.abs(amt) * 0.001)
      // one row of that amount; else the rows of a single day that add up to it (e.g. TDS on three accounts)
      let pick: Tx[] | null = null
      const one = near.find(x => Math.abs(x.signed - amt) <= tol)
      if (one) pick = [one]
      else {
        const byDay = new Map<string, Tx[]>()
        for (const x of near) byDay.set(x.d, [...(byDay.get(x.d) || []), x])
        for (const rows of byDay.values()) if (Math.abs(rows.reduce((s, x) => s + x.signed, 0) - amt) <= tol) { pick = rows; break }
        if (!pick && Math.abs(near.reduce((s, x) => s + x.signed, 0) - amt) <= tol && near.length) pick = near
      }
      if (!pick) return f
      pick.forEach(x => { x.used = true })
      return { ...f, ...describe(pick) }
    })
  } catch (e) {
    console.warn('[cashflowLabels] not labelled:', (e as any)?.message)
    return flows
  }
}

/**
 * Leaves out small movements the app shouldn't list: tax deducted at source (TDS on interest income, ₹100s each
 * quarter) and anything under ₹1,000. Done here so every app version gets it without a build. They also drop out of the
 * app's "Total contributions / withdrawals" (it adds up this same list), which is right for TDS — tax, not a withdrawal.
 * Statements, reports, NAV and returns don't use this list.
 */
export const MINOR_FLOW_LIMIT = 1000
export const withoutMinorFlows = <T extends { amount: number; label?: string }>(flows: T[]): T[] =>
  flows.filter((f) => !/^tax (deducted|withheld)/i.test(String(f.label || '')) && Math.abs(Number(f.amount) || 0) >= MINOR_FLOW_LIMIT)
