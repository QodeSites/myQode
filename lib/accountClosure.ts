// When a strategy account counts as closed. Nuvama rarely sets a maturity date, and a full withdrawal often leaves a
// few rupees behind (QAW00162: ₹1.91 after its last ₹6,030 went out on 23 Sep 2026), so "exactly ₹0" misses most.
// Closed = the last two values are both under CLOSED_BELOW and either both are ₹0 or money was withdrawn at some point.
// closedOn = the date of the last withdrawal (the money leaving), else the last day with a value.
// cutoff = the last day a closed account's figures run to (charts, returns, P&L, metrics, reports): the day before
// the money left. A full withdrawal is often booked over two days (QAW00162: ₹18.94 lakh on 22 Sep, when the NAV
// broke from 9.89 to 2.81, then the last ₹6,030 on 23 Sep), so it is the day before the NAV collapsed (fell by half
// in a day) when that happened within the month before the last withdrawal; else the day before the last
// withdrawal; with no withdrawal (the value simply went to ₹0), the last day with a value.
import pool from '@/lib/db'

export const CLOSED_BELOW = 100   // ₹
const COLLAPSE = 0.5              // a day's NAV under half the day before's: the money left that day
const COLLAPSE_WINDOW_DAYS = 31

export type Closure = { closed: boolean; closedOn: string | null; cutoff: string | null }   // dates: YYYY-MM-DD

const iso = (d: any) => (d == null ? null : (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : new Date(d)).toISOString().slice(0, 10))
/** The day before a date (YYYY-MM-DD). */
export const dayBeforeIso = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)

function cutoffOf(lastOut: string | null, lastValue: string | null, lastDay: string | null, collapse: string | null) {
  if (!lastOut) return lastValue || lastDay
  const near = collapse && collapse <= lastOut && Date.parse(lastOut) - Date.parse(collapse) <= COLLAPSE_WINDOW_DAYS * 86400000
  return dayBeforeIso(near ? collapse! : lastOut)
}

/** From an account's rows, oldest first: { report_date, portfolio_value, cash_in_out, nav? }. */
export function closureFromRows(rows: { report_date: any; portfolio_value: any; cash_in_out?: any; nav?: any }[]): Closure {
  if (rows.length < 2) return { closed: false, closedOn: null, cutoff: null }
  const v = (i: number) => Number(rows[i].portfolio_value) || 0
  const nav = (i: number) => Number(rows[i].nav) || 0
  const v1 = v(rows.length - 1), v2 = v(rows.length - 2)
  let lastOut = -1, lastValue = -1, collapse = -1
  rows.forEach((r, i) => {
    if ((Number(r.cash_in_out) || 0) < 0) lastOut = i
    if (v(i) >= CLOSED_BELOW) lastValue = i
    if (i > 0 && nav(i - 1) > 0 && rows[i].nav != null && nav(i) < nav(i - 1) * COLLAPSE) collapse = i
  })
  const closed = v1 < CLOSED_BELOW && v2 < CLOSED_BELOW && ((v1 === 0 && v2 === 0) || lastOut >= 0)
  if (!closed) return { closed: false, closedOn: null, cutoff: null }
  const at = lastOut >= 0 ? lastOut : lastValue >= 0 ? lastValue : rows.length - 1
  const d = (i: number) => (i >= 0 ? iso(rows[i].report_date) : null)
  return { closed: true, closedOn: d(at), cutoff: cutoffOf(d(lastOut), d(lastValue), d(rows.length - 1), d(collapse)) }
}

/** Closure for several account codes at once (pms_master_sheet codes, no ".0"). */
export async function closures(codes: string[]): Promise<Map<string, Closure>> {
  const out = new Map<string, Closure>()
  if (!codes.length) return out
  const r = await pool.query(
    `WITH r AS (
       SELECT account_code, report_date, portfolio_value::float8 AS v, COALESCE(cash_in_out, 0)::float8 AS cf, nav::float8 AS nav,
              LAG(nav::float8) OVER (PARTITION BY account_code ORDER BY report_date) AS prev_nav,
              ROW_NUMBER() OVER (PARTITION BY account_code ORDER BY report_date DESC) AS rn
         FROM public.pms_master_sheet WHERE account_code = ANY($1))
     SELECT account_code,
            max(v) FILTER (WHERE rn = 1) AS v1, max(v) FILTER (WHERE rn = 2) AS v2,
            max(report_date) FILTER (WHERE cf < 0) AS last_out,
            max(report_date) FILTER (WHERE v >= $2) AS last_value,
            max(report_date) FILTER (WHERE prev_nav > 0 AND nav < prev_nav * $3) AS collapse,
            max(report_date) AS last_day
       FROM r GROUP BY 1`, [codes, CLOSED_BELOW, COLLAPSE])
  for (const x of r.rows) {
    const v1 = x.v1 == null ? null : Number(x.v1), v2 = x.v2 == null ? null : Number(x.v2)
    const closed = v1 != null && v2 != null && v1 < CLOSED_BELOW && v2 < CLOSED_BELOW && ((v1 === 0 && v2 === 0) || x.last_out != null)
    out.set(x.account_code, closed
      ? { closed, closedOn: iso(x.last_out || x.last_value || x.last_day), cutoff: cutoffOf(iso(x.last_out), iso(x.last_value), iso(x.last_day), iso(x.collapse)) }
      : { closed, closedOn: null, cutoff: null })
  }
  return out
}

/** Where a closed account's figures stop (Closure.cutoff): every chart, return, P&L, metric and report runs to this
 *  day, so the closing itself (NAV collapsing toward 0, a −99.99% drawdown) is never drawn.
 *  { isClosed, closedAt: cutoff } or { isClosed: false, closedAt: null }. */
export async function closedCutoff(code: string): Promise<{ isClosed: boolean; closedAt: string | null }> {
  const c = (await closures([code])).get(code)
  return c && c.closed && c.cutoff ? { isClosed: true, closedAt: c.cutoff } : { isClosed: false, closedAt: null }
}
