// Money-weighted return (XIRR) from the daily pms_master_sheet series — shown next to the time-weighted NAV return.
// Pure functions only (no database): lib/factsheetCompute.ts and /api/mobile/portfolio/irr feed them rows.
//
// Sign convention (the INVESTOR's view, as Excel's XIRR):
//   money going into the portfolio (a positive pms_master_sheet.cash_in_out) is an investor OUTFLOW  → negative amount
//   money coming out (a negative cash_in_out: withdrawal, switch out, TDS on payouts) is an INFLOW   → positive amount
//   the portfolio value at the window start is treated as bought then                                  → negative amount
//   the portfolio value at the end is treated as received then                                         → positive amount
// A day's portfolio_value already includes that day's cash_in_out (the first row has value = cash_in_out, NAV 10), so a
// window starting on day s opens with the value on s and takes the flows dated after s up to and including the end.
// Year fraction = days / 365 (Excel's XIRR).
//
// Worked examples (checked by hand, see irrExamples() below):
//   -100 on 2024-01-01, +110 on 2024-12-31 (365 days)                    → 10.00 % a year
//   -100 on 2024-01-01, -100 on 2024-07-01, +220 on 2025-01-01          → 13.41 % a year
//     (100·1.1341^(366/365) + 100·1.1341^(184/365) = 113.45 + 106.55 = 220.00)
//   -100 on 2024-01-01, +105 on 2024-04-10 (100 days)                    → annual 19.5 %, period 5.00 % (not annualised)

export type Flow = { date: string; amount: number }   // date yyyy-mm-dd, amount in the investor's sign convention
export type DailyPoint = { date: string; value: number; flow: number }   // flow = cash_in_out (positive = money in)
export type IrrResult = { irr: number | null; annualised: boolean; from: string | null; to: string | null }

const DAY = 86400000
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY)
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY)
/** Same calendar day `months` earlier, clamped to the month's last day (as in lib/factsheetCompute.ts). */
export const monthsBack = (d: string, months: number) => {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 - months, dd = +d.slice(8, 10)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return fromMs(Date.UTC(y, m, Math.min(dd, last)))
}

/**
 * Annual internal rate of return of dated cash flows (Excel XIRR): the r with Σ amount_i / (1+r)^(days_i/365) = 0,
 * days counted from the earliest flow. Newton's method from `guess`, with a bisection fallback when Newton leaves
 * (-1, ∞) or does not converge. Null when there is not at least one negative and one positive flow, or no root.
 */
export function xirr(flows: Flow[], guess = 0.1): number | null {
  const fs = flows.filter(f => Number.isFinite(f.amount) && f.amount !== 0)
  if (!fs.some(f => f.amount < 0) || !fs.some(f => f.amount > 0)) return null
  const t0 = Math.min(...fs.map(f => toMs(f.date)))
  const ts = fs.map(f => (toMs(f.date) - t0) / DAY / 365)
  const scale = Math.max(...fs.map(f => Math.abs(f.amount)))
  const as = fs.map(f => f.amount / scale)   // scale-free tolerance
  const npv = (r: number) => as.reduce((s, a, i) => s + a * Math.pow(1 + r, -ts[i]), 0)
  const dnpv = (r: number) => as.reduce((s, a, i) => s - ts[i] * a * Math.pow(1 + r, -ts[i] - 1), 0)

  // Newton
  let r = guess
  for (let i = 0; i < 100; i++) {
    const f = npv(r), d = dnpv(r)
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break
    const next = r - f / d
    if (!Number.isFinite(next) || next <= -1) break
    if (Math.abs(next - r) < 1e-10) return Math.abs(npv(next)) < 1e-7 ? next : null
    r = next
  }

  // Bisection on (-1, hi], widening hi until the NPV changes sign.
  let lo = -0.999999, hi = 1
  let flo = npv(lo), fhi = npv(hi)
  while (flo * fhi > 0 && hi < 1e6) { hi *= 4; fhi = npv(hi) }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid)
    if (Math.abs(fm) < 1e-12 || hi - lo < 1e-12) return mid
    if (flo * fm < 0) { hi = mid; fhi = fm } else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

/**
 * XIRR of `flows` as shown to the investor: annualised when the flows span a year or more, otherwise the return over
 * the period itself ((1+r)^(days/365) - 1, `annualised: false`). Null under 30 days or when there is no root.
 */
export function periodIrr(flows: Flow[]): { irr: number | null; annualised: boolean } {
  const dates = flows.filter(f => f.amount).map(f => f.date).sort()
  if (dates.length < 2) return { irr: null, annualised: false }
  const span = daysBetween(dates[0], dates[dates.length - 1])
  if (span < 30) return { irr: null, annualised: span >= 365 }
  const r = xirr(flows)
  if (r == null) return { irr: null, annualised: span >= 365 }
  return span >= 365 ? { irr: r, annualised: true } : { irr: Math.pow(1 + r, span / 365) - 1, annualised: false }
}

/** Last point on or before `d` in an ascending series (null when none). */
function pointAt(series: DailyPoint[], d: string): DailyPoint | null {
  let lo = 0, hi = series.length - 1, ans = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (series[mid].date <= d) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  return ans < 0 ? null : series[ans]
}

/**
 * Sum of several accounts' daily series into one: flows on the same date add up; each account's value is carried
 * forward from its own last row (0 before its first row), so accounts reporting on different days still add up.
 * Each input must be ascending by date.
 */
export function sumSeries(seriesList: DailyPoint[][]): DailyPoint[] {
  const list = seriesList.filter(s => s.length)
  if (list.length === 1) return list[0]
  const dates = [...new Set(list.flatMap(s => s.map(p => p.date)))].sort()
  const idx = list.map(() => -1)
  return dates.map(date => {
    let value = 0, flow = 0
    list.forEach((s, k) => {
      while (idx[k] + 1 < s.length && s[idx[k] + 1].date <= date) {
        idx[k]++
        if (s[idx[k]].date === date) flow += s[idx[k]].flow
      }
      if (idx[k] >= 0) value += s[idx[k]].value
    })
    return { date, value, flow }
  })
}

/**
 * Investor cash flows of `series` over a window and their XIRR.
 *   start = null  since inception: the flows from the first row (whose value is its own cash_in_out), plus any
 *                 value the first row holds beyond its flow as an opening balance on the day before.
 *   start = date  the value on `start` (0 on the day before inception) as the opening outflow, then the flows dated
 *                 after `start`. Null when `start` is earlier than the day before the first row (not enough history).
 * The end is `end` (default: the last row) with the value on that day as the closing inflow.
 */
export function windowFlows(series: DailyPoint[], start: string | null, end?: string): { flows: Flow[]; from: string; to: string } | null {
  if (!series.length) return null
  const first = series[0]
  const to = end || series[series.length - 1].date
  const endPoint = pointAt(series, to)
  if (!endPoint || to < first.date) return null
  const flows: Flow[] = []
  let from: string
  if (start == null) {
    from = first.date
    const opening = first.value - first.flow
    if (opening > 0.5) flows.push({ date: addDays(first.date, -1), amount: -opening })
    for (const p of series) if (p.date <= to && p.flow) flows.push({ date: p.date, amount: -p.flow })
  } else {
    if (start < addDays(first.date, -1)) return null
    from = start
    const open = pointAt(series, start)
    if (open && open.value) flows.push({ date: start, amount: -open.value })
    for (const p of series) if (p.date > start && p.date <= to && p.flow) flows.push({ date: p.date, amount: -p.flow })
  }
  if (endPoint.value) flows.push({ date: to, amount: endPoint.value })
  return { flows, from, to }
}

/** IRR of a window of `series` (see windowFlows), in the display form of periodIrr. */
export function windowIrr(series: DailyPoint[], start: string | null, end?: string): IrrResult {
  const w = windowFlows(series, start, end)
  if (!w) return { irr: null, annualised: false, from: start, to: end || null }
  // Measured from the first money at work (the opening value, or the first investment) to the end.
  const firstFlow = w.flows.reduce((m, f) => (f.date < m ? f.date : m), w.to)
  const span = daysBetween(firstFlow, w.to)
  if (span < 30) return { irr: null, annualised: false, from: w.from, to: w.to }
  const r = xirr(w.flows)
  if (r == null) return { irr: null, annualised: span >= 365, from: w.from, to: w.to }
  return span >= 365
    ? { irr: r, annualised: true, from: w.from, to: w.to }
    : { irr: Math.pow(1 + r, span / 365) - 1, annualised: false, from: w.from, to: w.to }
}

/** The worked examples in the header, for a quick check: every `got` should equal its `want` (percent, 2 dp). */
export function irrExamples() {
  const pc = (x: number | null) => (x == null ? null : Math.round(x * 10000) / 100)
  return [
    { name: 'one year, +10%', want: 10, got: pc(xirr([{ date: '2024-01-01', amount: -100 }, { date: '2024-12-31', amount: 110 }])) },
    { name: 'top-up mid-year', want: 13.41, got: pc(xirr([{ date: '2024-01-01', amount: -100 }, { date: '2024-07-01', amount: -100 }, { date: '2025-01-01', amount: 220 }])) },
    { name: '100 days, +5% (period)', want: 5, got: pc(periodIrr([{ date: '2024-01-01', amount: -100 }, { date: '2024-04-10', amount: 105 }]).irr) },
    { name: 'under 30 days', want: null, got: pc(periodIrr([{ date: '2024-01-01', amount: -100 }, { date: '2024-01-20', amount: 101 }]).irr) },
    { name: 'no inflow', want: null, got: pc(xirr([{ date: '2024-01-01', amount: -100 }, { date: '2024-06-01', amount: -50 }])) },
  ]
}
