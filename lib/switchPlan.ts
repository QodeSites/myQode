// Strategy switches from the myQode app, as Zoho Switch Plans (module Liquid_Fund_Holdings, "Switch Plans").
// Decided 12 Oct 2026: the app creates a Switch Plan, not a Strategy_Switch_Requests record. The plan is the parent;
// once Investor Relations verifies it, Zoho's own automation raises the switch request from it.
//
// What the app sends (Switch Scenario "Normal" only: one move now; staggered plans are not offered in the app yet):
//   Plan_Origin 'myQode App', Switch_Scenario 'Normal', Switch_Type, Verification_Status 'Pending',
//   Investor (lookup), Name and Investor_Name_Confirm = the investor's legal name, Email, Owner = their RM,
//   Amount_Parked ("Amount to Move") and Confirm_Amount = the total moving out, Number_of_Instalments 1.
//   Partial: Allocation_Method 'By Amount', <S>_From_Amount and <S>_To_Amount as the client entered them.
//   Full:    Allocation_Method 'By Percentage', Full_Switch_From_<S> ticked, <S>_From_Amount = what <S> holds,
//            <S>_To_Percent = the client's split (adds up to 100) and <S>_To_Amount = that share of the total,
//            Full_Switch_Confirm = the strategies moving out ("QAW" or "QAW, QTF"), Confirm_Percentage 100.
// The confirm fields are the module's re-type checks (its validation rules refuse a plan where they differ).
import { zohoApiDomain, zohoFetch } from '@/lib/zoho'

export const STRATS = ['QAW', 'QTF', 'QGF', 'QLF'] as const
export type Strat = typeof STRATS[number]
export const PLAN_MODULE = 'Liquid_Fund_Holdings'
const r2 = (v: number) => Math.round(v * 100) / 100

export type PlanInput = {
  investor: { id: string; legalName: string; email?: string | null; ownerId?: string | null }
  isFull: boolean
  from: Strat[]
  to: Strat[]
  fromAmt: (s: Strat) => number      // Partial: as entered; Full: what the strategy holds
  toAmt: (s: Strat) => number        // the rupees each target receives (adds up to the total moving out)
}

/**
 * The plan's Amount_in_Words, as Zoho's verification reads it (worked out against it, 12 Oct 2026): the amount
 * rounded to whole rupees, in lowercase Indian words (crore, lakh, thousand, hundred), with no "rupees", "only",
 * "and" or paise. "twenty five lakh", "one crore fifty thousand", "ninety nine lakh ninety nine thousand nine
 * hundred ninety nine" verify. Zoho compares it case- and space-insensitively to its own spelling of the amount.
 */
export function planAmountWords(amount: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  const two = (x: number) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''))
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x))
  const n = Math.round(Math.abs(amount))
  if (!n) return 'zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1_00_00_000), lakh = Math.floor((n % 1_00_00_000) / 1_00_000)
  const thousand = Math.floor((n % 1_00_000) / 1000), rest = n % 1000
  if (crore) parts.push(`${three(crore)} crore`)
  if (lakh) parts.push(`${two(lakh)} lakh`)
  if (thousand) parts.push(`${two(thousand)} thousand`)
  if (rest) parts.push(three(rest))
  // Zoho's check strips the spaces and then forgives plurals (LAKHS → LAKH, CRORES → CRORE, HUNDREDS → HUNDRED,
  // THOUSANDS → THOUSAND), so a unit word followed by one starting with S loses that S ("lakh seventeen" →
  // LAKHSEVENTEEN → LAKHEVENTEEN, which never matches). Writing the plural there gives it an S of its own to remove.
  const words = parts.join(' ').split(' ')
  // In capitals, as Zoho shows its expected words (the check ignores case; capitals are what IR reads, 13 Oct 2026).
  return words.map((w, i) => (['crore', 'lakh', 'thousand', 'hundred'].includes(w) && (words[i + 1] || '').startsWith('s') ? w + 's' : w)).join(' ').toUpperCase()
}

/** The Switch Plan record for a switch, as Zoho expects it. */
export function buildPlanRecord(p: PlanInput): Record<string, unknown> {
  const total = r2(p.from.reduce((t, s) => t + p.fromAmt(s), 0))
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)   // the date in India
  const rec: Record<string, unknown> = {
    Name: p.investor.legalName,
    Investor: { id: p.investor.id },
    Investor_Name_Confirm: p.investor.legalName,
    ...(p.investor.email ? { Email: p.investor.email } : {}),
    ...(p.investor.ownerId ? { Owner: { id: p.investor.ownerId } } : {}),
    Plan_Origin: 'myQode App',
    Switch_Scenario: 'Normal',
    Switch_Type: p.isFull ? 'Full Switch' : 'Partial Switch',
    Allocation_Method: p.isFull ? 'By Percentage' : 'By Amount',
    Verification_Status: 'Pending',
    Amount_Parked: total,
    Confirm_Amount: total,
    // Zoho's verification needs it on a partial switch (blank → "VERIFICATION FAILED: Amount in Words is blank").
    // A full switch verifies without it (SP-14, SP-15), so it is not sent there.
    ...(p.isFull ? {} : { Amount_in_Words: planAmountWords(total) }),
    Number_of_Instalments: 1,
    First_Deployment_Date: today,
  }
  for (const s of STRATS) {
    rec[`${s}_From_Amount`] = p.from.includes(s) ? r2(p.fromAmt(s)) : 0
    rec[`${s}_To_Amount`] = p.to.includes(s) ? r2(p.toAmt(s)) : 0
  }
  if (p.isFull) {
    // percentages to two decimals, the last target taking the rounding so they add up to exactly 100
    let used = 0
    p.to.forEach((s, i) => {
      const pct = i === p.to.length - 1 ? r2(100 - used) : r2(total > 0 ? (p.toAmt(s) / total) * 100 : 100 / p.to.length)
      used = r2(used + pct)
      rec[`${s}_To_Percent`] = pct
    })
    for (const s of STRATS) rec[`Full_Switch_From_${s}`] = p.from.includes(s)
    // Zoho's rule for a By Percentage plan: the From percentages add up to the To percentages (100) — a full switch
    // moves 100% of its source. The app's full switch has one source.
    for (const s of p.from) rec[`${s}_From_Percent`] = r2(100 / p.from.length)
    rec.Full_Switch_Confirm = p.from.join(', ')
    rec.Confirm_Percentage = 100
  }
  return rec
}

/** Create the plan in Zoho. trigger ['workflow'] runs the module's workflow rules, as a record made in the CRM. */
export async function createPlan(record: Record<string, unknown>, runWorkflows = true): Promise<string> {
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/${PLAN_MODULE}`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [record], trigger: runWorkflows ? ['workflow'] : [] }),
  }, { write: true })
  const body: any = await res.json().catch(() => null)
  const d = body?.data?.[0]
  if (!res.ok || !d || d.status === 'error') {
    console.error('[switchPlan] Zoho refused the plan', JSON.stringify(d || body).slice(0, 600))
    throw new Error((d?.message || body?.message || `Zoho refused the switch plan (${res.status})`) + (d?.details?.api_name ? ` (${d.details.api_name})` : ''))
  }
  const id = d.details?.id
  if (!id) throw new Error('Zoho did not return a switch plan id')
  return String(id)
}

const planCache = new Map<string, { at: number; s: PlanStatus | null }>()
export type PlanStatus = { state: 'open' | 'on_hold' | 'closed'; label: string; updatedAt: string | null }
/**
 * Where a plan stands, for the app's request tracking (lib/requestTracking.ts); cached two minutes. The label is
 * exactly what Zoho shows (asked 13 Oct 2026): the Holding Status (Active, Paused, Fully Deployed, Withdrawn, Merged)
 * once set, else the Verification Status (Pending, Verified, Mismatch Detected). The state only picks the pill's tone:
 * Fully Deployed / Withdrawn / Merged → closed; Paused / Mismatch Detected → on hold; else open. Null when unreadable.
 */
export async function planStatus(id: string): Promise<PlanStatus | null> {
  if (!id) return null
  const hit = planCache.get(id)
  if (hit && Date.now() - hit.at < 120_000) return hit.s
  let s: PlanStatus | null = null
  try {
    const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/${PLAN_MODULE}/${id}?fields=Verification_Status,Holding_Status,Modified_Time`, { cache: 'no-store' })
    const d: any = res.status === 204 ? null : (await res.json().catch(() => null))?.data?.[0]
    if (d) {
      const v = String(d.Verification_Status || ''), h = String(d.Holding_Status || ''), at = d.Modified_Time || null
      // the label is Zoho's own word for it: the Holding Status once the plan has one, else the Verification Status
      const label = h || v || 'Pending'
      const state: PlanStatus['state'] = h === 'Fully Deployed' || h === 'Withdrawn' || h === 'Merged' ? 'closed'
        : h === 'Paused' || v === 'Mismatch Detected' ? 'on_hold' : 'open'
      s = { state, label, updatedAt: at }
    }
  } catch (e: any) { console.warn('[switchPlan] plan', id, 'not read -', e?.message) }
  planCache.set(id, { at: Date.now(), s })
  return s
}

export type OpenPlan = {
  id: string; planNo: string | null; requestDate: string | null; switchType: string | null
  from: Strat[]; to: Strat[]
  fullFrom: Strat[]              // strategies this plan fully switches out of (Full_Switch_From_<S> ticked)
  live: boolean                  // Holding Status Active: what Zoho's validation checks a new plan against
}
/**
 * The plans still in progress for these investors: not yet verified, or verified and not yet fully carried out.
 * Fully Deployed, Withdrawn and Merged plans are finished. `live` marks the Active ones, which are the only ones
 * Zoho's validation rule (validation_rule.lfh_validate_confirmations) compares a new plan with.
 * A strategy counts as moving out when it has a From amount, a From percent or its Full Switch box — as in Zoho.
 */
export async function openPlans(investorIds: string[]): Promise<Record<string, OpenPlan[]>> {
  if (!investorIds.length) return {}
  const fields = ['Investor', 'Switch_Plan_No', 'Switch_Type', 'Holding_Status', 'Verification_Status', 'Created_Time',
    ...STRATS.flatMap((s) => [`Full_Switch_From_${s}`, `${s}_From_Amount`, `${s}_From_Percent`, `${s}_To_Amount`, `${s}_To_Percent`])]
  // COQL, not search: Zoho's search index takes a while to see a new record, COQL sees it at once.
  const ids = investorIds.map((id) => `'${String(id).replace(/[^0-9]/g, '')}'`).join(', ')
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v3/coql`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ select_query: `select id, ${fields.join(', ')} from ${PLAN_MODULE} where Investor in (${ids}) limit 200` }),
  })
  if (res.status === 204) return {}
  const text = await res.text()
  const body: any = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(body?.message || `Zoho ${PLAN_MODULE} query failed (${res.status})`)
  const out: Record<string, OpenPlan[]> = {}
  for (const r of (body?.data || []) as any[]) {
    const status = String(r.Holding_Status || '')
    if (['Fully Deployed', 'Withdrawn', 'Merged'].includes(status)) continue
    const id = String(r.Investor?.id || '')
    if (!id) continue
    const num = (v: unknown) => Number(v) || 0
    const fullFrom = STRATS.filter((s) => r[`Full_Switch_From_${s}`] === true)
    ;(out[id] = out[id] || []).push({
      id: String(r.id), planNo: r.Switch_Plan_No || null, requestDate: r.Created_Time ? String(r.Created_Time).slice(0, 10) : null,
      switchType: r.Switch_Type || null,
      from: STRATS.filter((s) => fullFrom.includes(s) || num(r[`${s}_From_Amount`]) > 0 || num(r[`${s}_From_Percent`]) > 0),
      to: STRATS.filter((s) => num(r[`${s}_To_Amount`]) > 0 || num(r[`${s}_To_Percent`]) > 0),
      fullFrom, live: status === 'Active',
    })
  }
  return out
}

/**
 * Zoho's duplicate rule, as in validation_rule.lfh_validate_confirmations: against each LIVE (Active) plan of the
 * same investor, for every strategy except Qode Liquid Fund that both move out of —
 *   either side a full switch out of it  → "A full switch out of <S> is already live for this investor."
 *   the live plan already moves it into one of this request's targets → "A live plan already moves <S> into <T>."
 * Anything else is allowed (a second partial switch out of a strategy into a different target goes through).
 * Returns Zoho's message, or null.
 */
export function liveConflict(mine: { from: Strat[]; fullFrom: Strat[]; to: Strat[] }, plans: OpenPlan[]): string | null {
  for (const p of plans.filter((x) => x.live)) {
    for (const c of STRATS) {
      if (c === 'QLF') continue
      if (!mine.from.includes(c) || !p.from.includes(c)) continue
      if (mine.fullFrom.includes(c) || p.fullFrom.includes(c)) return `A full switch out of ${c} is already live for this investor.`
      const t = mine.to.find((x) => p.to.includes(x))
      if (t) return `A live plan already moves ${c} into ${t}.`
    }
  }
  return null
}

/**
 * What the switch form should keep closed, from the live plans (the same rule as liveConflict):
 *   blockedFrom   a source with a full switch out of it already live: nothing more can move out of it
 *   blockedPairs  "QAW>QTF": a live plan already moves that source into that target
 * Qode Liquid Fund is never blocked (Zoho's rule leaves it out).
 */
export function liveBlocks(plans: OpenPlan[]): { blockedFrom: Strat[]; blockedPairs: string[] } {
  const live = plans.filter((x) => x.live)
  const blockedFrom = STRATS.filter((c) => c !== 'QLF' && live.some((p) => p.fullFrom.includes(c)))
  const pairs = new Set<string>()
  for (const p of live) for (const c of p.from) if (c !== 'QLF') for (const t of p.to) pairs.add(`${c}>${t}`)
  return { blockedFrom, blockedPairs: [...pairs] }
}
