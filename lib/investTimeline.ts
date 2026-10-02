// When a client's payment is invested and when it shows in myQode. PMS works on T-1 data from Nuvama:
//   1. money reaches Qode about an hour after the payment (or at Razorpay's settlement time, when known);
//   2. it counts as received that day only on an NSE trading day before 4 pm IST, else from the next trading day;
//   3. it is deployed on the next trading day after that;
//   4. it shows in myQode on the trading day after deployment (Nuvama's data for that day is picked up then).
// e.g. paid Mon 1 pm → deployed Tue → visible Wed; paid Mon 3:30 pm (reaches Qode 4:30 pm) → Wed → Thu;
//      paid Fri 1 pm → Mon → Tue.
// Trading days = Monday–Friday minus NSE holidays, read from Upstox's public market-holidays API, refreshed every
// 12 hours and kept in app_notification_state so a failed fetch never loses them (weekends-only as a last resort).
import { query } from '@/lib/db'

const HOLIDAYS_URL = 'https://api.upstox.com/v2/market/holidays'
const SETTLE_MINUTES = 60
const CUTOFF_HOUR = 16   // 4 pm IST

let cache: { at: number; days: Set<string> } | null = null

async function loadHolidays(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < 12 * 3600000) return cache.days
  let days: string[] | null = null
  try {
    const r = await fetch(HOLIDAYS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    const j: any = r.ok ? await r.json() : null
    if (j?.status === 'success' && Array.isArray(j.data)) {
      days = j.data.filter((h: any) => Array.isArray(h.closed_exchanges) && h.closed_exchanges.includes('NSE')).map((h: any) => String(h.date).slice(0, 10))
    }
  } catch { /* use the stored copy */ }
  try {
    if (days && days.length) {
      // keep every year we have ever seen: the API only returns the current year
      const prev = (await query(`SELECT value FROM app_notification_state WHERE key = 'nse.holidays'`)).rows[0]?.value
      const merged = [...new Set([...(prev ? JSON.parse(prev) : []), ...days])].sort()
      await query(`INSERT INTO app_notification_state (key, value, updated_at) VALUES ('nse.holidays', $1, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(merged)])
      days = merged
    } else {
      const prev = (await query(`SELECT value FROM app_notification_state WHERE key = 'nse.holidays'`)).rows[0]?.value
      days = prev ? JSON.parse(prev) : []
    }
  } catch { days = days || [] }
  cache = { at: Date.now(), days: new Set(days || []) }
  return cache.days
}

const istParts = (t: Date) => { const x = new Date(t.getTime() + 330 * 60000); return { day: x.toISOString().slice(0, 10), hour: x.getUTCHours() } }
const addDays = (d: string, k: number) => new Date(Date.parse(d + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10)
const weekend = (d: string) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6 }

export type Timeline = { receivedAt: string; countsFrom: string; deployOn: string; visibleOn: string }

/** Expected dates for a payment made at `paidAt` (settledAt: when the money actually reached Qode, if known). */
export async function investTimeline(paidAt: Date | string, settledAt?: Date | string | null): Promise<Timeline> {
  const hol = await loadHolidays()
  const working = (d: string) => !weekend(d) && !hol.has(d)
  const next = (d: string) => { let x = addDays(d, 1); while (!working(x)) x = addDays(x, 1); return x }
  const received = settledAt ? new Date(settledAt) : new Date(new Date(paidAt).getTime() + SETTLE_MINUTES * 60000)
  const { day, hour } = istParts(received)
  const countsFrom = working(day) && hour < CUTOFF_HOUR ? day : next(day)
  const deployOn = next(countsFrom)
  return { receivedAt: received.toISOString(), countsFrom, deployOn, visibleOn: next(deployOn) }
}

/** "Tue 30 Sep" */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return `${WD[x.getUTCDay()]} ${x.getUTCDate()} ${MO[x.getUTCMonth()]}` }

/** "30 Sep" */
export const dayMonth = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCDate()} ${MO[x.getUTCMonth()]}` }
/** Notification wording, in plain words: "It will be invested by Tue 6 Oct and show in your portfolio from Wed 7 Oct." */
export const timelineText = (t: { deployOn: string; visibleOn: string }) =>
  `It will be invested by ${shortDate(t.deployOn)} and show in your portfolio from ${shortDate(t.visibleOn)}.`
/** The same once the dates have passed: "It was invested on Tue 6 Oct and is in your portfolio." */
export const timelineDoneText = (t: { deployOn: string }) => `It was invested on ${shortDate(t.deployOn)} and is in your portfolio.`
/** "We've received your ₹5 lakh" / "For Qode Growth Fund. It will be invested by …" (every money-received path) */
export const receivedNote = (amount: string, where: string, timeline: string) =>
  ({ title: `We’ve received your ${amount}`, body: `For ${where}. ${timeline}` })
