// When a strategy account counts as closed. Nuvama rarely sets a maturity date, and a full withdrawal often leaves a
// few rupees behind (QAW00162: ₹1.91 after its last ₹6,030 went out on 23 Sep 2026), so "exactly ₹0" misses most.
// Closed = the last two values are both under CLOSED_BELOW and either both are ₹0 or money was withdrawn at some point.
// closedOn = the date of the last withdrawal (the money leaving), else the last day with a value.
import pool from '@/lib/db'

export const CLOSED_BELOW = 100   // ₹

export type Closure = { closed: boolean; closedOn: string | null }   // closedOn: YYYY-MM-DD

const iso = (d: any) => (d == null ? null : (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : new Date(d)).toISOString().slice(0, 10))

/** From an account's rows, oldest first: { report_date, portfolio_value, cash_in_out }. */
export function closureFromRows(rows: { report_date: any; portfolio_value: any; cash_in_out?: any }[]): Closure {
  if (rows.length < 2) return { closed: false, closedOn: null }
  const v = (i: number) => Number(rows[i].portfolio_value) || 0
  const v1 = v(rows.length - 1), v2 = v(rows.length - 2)
  let lastOut = -1, lastValue = -1
  rows.forEach((r, i) => { if ((Number(r.cash_in_out) || 0) < 0) lastOut = i; if (v(i) >= CLOSED_BELOW) lastValue = i })
  const closed = v1 < CLOSED_BELOW && v2 < CLOSED_BELOW && ((v1 === 0 && v2 === 0) || lastOut >= 0)
  if (!closed) return { closed: false, closedOn: null }
  const at = lastOut >= 0 ? lastOut : lastValue >= 0 ? lastValue : rows.length - 1
  return { closed: true, closedOn: iso(rows[at].report_date) }
}

/** Closure for several account codes at once (pms_master_sheet codes, no ".0"). */
export async function closures(codes: string[]): Promise<Map<string, Closure>> {
  const out = new Map<string, Closure>()
  if (!codes.length) return out
  const r = await pool.query(
    `WITH r AS (
       SELECT account_code, report_date, portfolio_value::float8 AS v, COALESCE(cash_in_out, 0)::float8 AS cf,
              ROW_NUMBER() OVER (PARTITION BY account_code ORDER BY report_date DESC) AS rn
         FROM public.pms_master_sheet WHERE account_code = ANY($1))
     SELECT account_code,
            max(v) FILTER (WHERE rn = 1) AS v1, max(v) FILTER (WHERE rn = 2) AS v2,
            max(report_date) FILTER (WHERE cf < 0) AS last_out,
            max(report_date) FILTER (WHERE v >= $2) AS last_value,
            max(report_date) AS last_day
       FROM r GROUP BY 1`, [codes, CLOSED_BELOW])
  for (const x of r.rows) {
    const v1 = x.v1 == null ? null : Number(x.v1), v2 = x.v2 == null ? null : Number(x.v2)
    const closed = v1 != null && v2 != null && v1 < CLOSED_BELOW && v2 < CLOSED_BELOW && ((v1 === 0 && v2 === 0) || x.last_out != null)
    out.set(x.account_code, { closed, closedOn: closed ? iso(x.last_out || x.last_value || x.last_day) : null })
  }
  return out
}
