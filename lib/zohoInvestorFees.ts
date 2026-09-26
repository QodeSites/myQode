// Per-investor fee terms, sourced from Zoho CRM.
//
// The rack rate is the fee in the signed PMS agreement. It is the basis for
// the Qode/distributor split — see lib/feeEngine.ts for why that matters.
// `Actual_Fee_Charged` is what the investor is really billed, which differs
// from the rack rate only where the distributor has given a discount.
//
// FIELD NAMES DIFFER FROM THE PLAN
// The implementation plan (Part 3, Section C) proposed `Rack_Rate_Perf_Fee`,
// `Fee_Option` and `Linked_Distributor`. What actually exists in Zoho is
// `Rack_Rate_Performance_Fee`, `Fees_Structure` (a free-text multiselect) and
// `Primary_distributo`. The names below are the real ones — verified against
// the live module, not the plan.
import { zohoApiDomain, zohoFetch } from '@/lib/zoho'

export interface InvestorFeeTerms {
  /** Lowercased email — the join key against pms_clients_master. */
  email: string
  name: string | null

  /** Contractual rack rate fixed fee %, per the signed agreement. */
  rackFixedFeePct: number | null
  /** Contractual rack rate performance fee %. */
  rackPerfFeePct: number | null
  /** Hurdle rate above which performance fees apply. */
  hurdlePct: number | null

  /** What the investor is actually billed — lower than rack if discounted. */
  actualFeeChargedPct: number | null
  /** Zoho's explicit flag that a discount was passed on. */
  discountApplied: boolean

  /** Free-text label, e.g. "Hybrid - (1.5% Fixed + 15% Performance...)". */
  feesStructureLabel: string | null

  /**
   * The discounted rates, where the CRM records them explicitly.
   *
   * Populated on only 2 of 95 investors, and on both it exactly equals
   * `Actual_Fee_Charged` — so it is a redundant duplicate rather than a new
   * source. Kept as a fallback for the fixed leg, and as the ONLY source for a
   * discounted performance rate, which `Actual_Fee_Charged` cannot express.
   */
  discountedFixedFeePct: number | null
  discountedPerfFeePct: number | null

  /**
   * Zoho's pre-computed net PERFORMANCE rate for the distributor — the share
   * of the performance fee they keep. On a 15% rack performance fee at a 50%
   * split this reads 7.5.
   *
   * Populated on 86 of 95 records, and like its fixed-fee counterpart it is
   * stale where a custom split was agreed later: 6 records still hold values
   * computed at 50% for distributors now on 55% or 65%. Used as a cross-check,
   * never as the source of a payout.
   */
  zohoNetPerfFeePct: number | null

  /**
   * Zoho's own pre-computed net rate for the distributor, on client AUM, after
   * any discount. For a 2.5% rack rate at a 50% split with a 0.9% discount
   * this reads 0.35.
   *
   * NOT used as the source of any payout. Verified against all 87 populated
   * records: 10 disagree with the contracted split — Funds India and One
   * Battalion rows still hold values computed at 50% despite their 60% and 65%
   * agreements, and two rows carry 10 and 13 against a 0% rack rate. Taking it
   * at face value would underpay those distributors by ~₹49,900 a year.
   *
   * So it serves as a cross-check: the portal computes the rate itself and
   * flags a divergence, rather than trusting a field that was populated before
   * the custom splits were agreed and never refreshed.
   */
  zohoNetFeePct: number | null

  /** The distributor this investor is attributed to, from Zoho's own lookup. */
  distributorId: string | null
  distributorName: string | null
}

let cache: { data: Map<string, InvestorFeeTerms>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * A normalised name, used as a secondary join key.
 *
 * Prefixed so it can never collide with an email key in the same map — an
 * investor literally named "user@example.com" would otherwise shadow a real
 * address.
 */
function nameJoinKey(name: unknown): string | null {
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return n ? `name:${n}` : null
}

function toPct(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

async function coql(selectQuery: string): Promise<any[]> {
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v3/coql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ select_query: selectQuery }),
    cache: 'no-store',
  })

  if (res.status === 204) return []
  if (!res.ok) {
    throw new Error(`Zoho COQL failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
  }
  const body = (await res.json()) as { data?: any[] }
  return body.data ?? []
}

/**
 * Fetches fee terms for every investor attributed to a distributor.
 *
 * Scoped to `Primary_distributo is not null` rather than the whole module:
 * direct clients are not a distributor's business, and not fetching them is a
 * stronger guarantee than filtering them out later.
 */
async function fetchAll(): Promise<Map<string, InvestorFeeTerms>> {
  const out = new Map<string, InvestorFeeTerms>()
  const PAGE = 200
  let offset = 0

  for (let page = 0; page < 50; page++) {
    // Lookup fields must be selected as dotted sub-fields. Selecting
    // `Primary_distributo` alone returns an EMPTY object in COQL (unlike the
    // REST API, which returns `{name, id}`) — every row silently came back
    // with no distributor attached.
    const rows = await coql(
      `select Email, Name,
              Rack_Rate_Fixed_Fee, Rack_Rate_Performance_Fee, Rack_Rate_Hurdle,
              Actual_Fee_Charged, Fee_Discount_Applied, Fees_Structure,
              Discounted_Fixed_Fee, Discounted_Performance_Fee,
              Distributor_Net_Fee_Pct, Distributor_Net_Perf_Fee_Pct,
              Primary_distributo.id, Primary_distributo.Name
         from Investors
        where Primary_distributo is not null
        limit ${offset}, ${PAGE}`,
    )

    for (const r of rows) {
      const email = String(r.Email ?? '').trim().toLowerCase()
      if (!email) continue
      // Zoho holds duplicate investor records for some people; first seen wins
      // so the reported terms are stable across refreshes.
      if (out.has(email)) continue

      // Fees_Structure is a multiselect, so Zoho returns an array.
      const structure = Array.isArray(r.Fees_Structure)
        ? r.Fees_Structure[0] ?? null
        : r.Fees_Structure ?? null

      const terms: InvestorFeeTerms = {
        email,
        name: r.Name ?? null,
        rackFixedFeePct: toPct(r.Rack_Rate_Fixed_Fee),
        rackPerfFeePct: toPct(r.Rack_Rate_Performance_Fee),
        hurdlePct: toPct(r.Rack_Rate_Hurdle),
        actualFeeChargedPct: toPct(r.Actual_Fee_Charged),
        discountApplied: r.Fee_Discount_Applied === true,
        feesStructureLabel: structure,
        discountedFixedFeePct: toPct(r.Discounted_Fixed_Fee),
        discountedPerfFeePct: toPct(r.Discounted_Performance_Fee),
        zohoNetFeePct: toPct(r.Distributor_Net_Fee_Pct),
        zohoNetPerfFeePct: toPct(r.Distributor_Net_Perf_Fee_Pct),
        distributorId: r['Primary_distributo.id'] ?? null,
        distributorName: r['Primary_distributo.Name'] ?? null,
      }

      out.set(email, terms)

      // Also key on the investor's name.
      //
      // The CRM and the portfolio system hold DIFFERENT email addresses for
      // some investors — Baiju Shyam Shah is shyam.juhu@gmail.com in Zoho and
      // baijucrochet@gmail.com in the portfolio DB. An email-only join finds
      // nothing for them, so the engine sees no rack rate, treats the
      // discounted fee as the rack fee, and misses the discount entirely. That
      // overpaid one distributor ~₹10,900 a year.
      //
      // Safe as a FALLBACK only, and only because every one of the 95 names in
      // this module is unique — verified, not assumed. The lookup tries email
      // first and reaches this key only when that misses, so a name collision
      // could never override a good email match.
      const nameKey = nameJoinKey(r.Name)
      if (nameKey && !out.has(nameKey)) out.set(nameKey, terms)
    }

    if (rows.length < PAGE) break
    offset += PAGE
  }

  return out
}

/**
 * Every distributor-sourced investor's fee terms.
 *
 * Keyed by BOTH lowercased email and `name:<normalised name>`. Use
 * `lookupInvestorTerms` rather than indexing this directly — it applies the
 * email-before-name precedence the two key types depend on.
 */
export async function getInvestorFeeTerms(): Promise<Map<string, InvestorFeeTerms>> {
  if (cache && cache.expiresAt > Date.now()) return cache.data
  const data = await fetchAll()
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  return data
}

/**
 * Finds an investor's fee terms by email, falling back to their name.
 *
 * Email is authoritative: it is the identifier both systems are supposed to
 * agree on, and a match there is unambiguous. The name fallback exists only
 * because two accounts hold a different address in each system, which silently
 * cost the correct discount on one of them.
 *
 * The order matters and is enforced here rather than at each call site, so a
 * caller cannot accidentally let a name match win over an email match.
 */
export function lookupInvestorTerms(
  terms: Map<string, InvestorFeeTerms>,
  email: string | null | undefined,
  name: string | null | undefined,
): InvestorFeeTerms | undefined {
  const e = String(email ?? '').trim().toLowerCase()
  if (e) {
    const byEmail = terms.get(e)
    if (byEmail) return byEmail
  }
  const nameKey = nameJoinKey(name)
  return nameKey ? terms.get(nameKey) : undefined
}

/** Clears the cache — for tests, or a manual refresh after editing Zoho. */
export function clearInvestorFeeCache(): void {
  cache = null
}
