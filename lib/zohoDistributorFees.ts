// Distributor revenue share, sourced from Zoho CRM.
//
// WHY THIS EXISTS
// The fee calculator previously read `intermediary_fee_percentage` from
// pms_clients_master. That column is populated for 15 of 507 clients, and
// `parseFloat(null) || 0` turned the other 492 into a 0% share — so the fees
// page reported ₹0 distributor share for ~97% of the book while looking
// perfectly healthy.
//
// WHICH FIELD, AND WHY IT MATTERS
// Zoho holds two numbers that both look like "the distributor percentage" but
// mean entirely different things:
//
//   Distributor.Distributor_Share_Category   e.g. "65%"   ← THIS ONE
//       A revenue-share slab: the fraction of the fee Qode bills the client
//       that the distributor keeps. Set per distributor (22 have it).
//
//   Investors.Distributor_Net_Fee_Pct        e.g. 0.98
//       A trail-style rate applied to AUM, set per investor (87 have it).
//
// 65% of a fee and 0.98% of AUM are not interchangeable — they produce very
// different amounts. The share is computed from Share_Category, per the
// business definition: share = total fees billed × category.
import { getZohoAccessToken, zohoApiDomain } from '@/lib/zoho'

export interface DistributorShare {
  /** Distributor's email, lowercased — matches the portal login. */
  distributorEmail: string
  distributorName: string | null
  /** Share of billed fees, as a percentage (65 means 65%). Null when the
   *  category is unset in Zoho — deliberately distinct from a real 0%. */
  sharePct: number | null
  /** The raw picklist value, e.g. "65%" — shown as-is where the exact label
   *  matters more than the parsed number. */
  shareCategory: string | null
}

/** Cached briefly: this is a full-module read and Zoho rate-limits API calls.
 *  Share categories change rarely, so minutes of staleness are harmless. */
let cache: { data: Map<string, DistributorShare>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Parses a share category into a number.
 *
 * The field is a picklist of strings ("65%"), not a number, so it needs
 * stripping before arithmetic. Returns null for unset — distinct from 0%,
 * which would be a real "this distributor earns nothing" rate.
 */
export function parseSharePct(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Runs a COQL query against Zoho CRM.
 *
 * COQL requires a WHERE clause even when you want everything — `where X is not
 * null` is the idiomatic way to say "all rows". It also caps at 200 rows per
 * call, hence the pagination in fetchAll.
 */
async function coql(selectQuery: string): Promise<any[]> {
  const token = await getZohoAccessToken()
  const res = await fetch(`${zohoApiDomain()}/crm/v3/coql`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ select_query: selectQuery }),
    cache: 'no-store',
  })

  if (res.status === 204) return []          // no rows
  if (!res.ok) {
    throw new Error(`Zoho COQL failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
  }

  const body = (await res.json()) as { data?: any[] }
  return body.data ?? []
}

/**
 * Fetches every distributor that has a share category set.
 *
 * Indexed by BOTH Email and Secondary_Email. A firm's CRM contact is often not
 * the address they log into the portal with — One Battalion is
 * jash@thepersonalcfo.in in Zoho but signs in as advisory@onebattalion.in —
 * and matching on the primary alone left them, and most others, unmapped.
 * Secondary_Email is where that portal address is already recorded.
 */
async function fetchAll(): Promise<Map<string, DistributorShare>> {
  const out = new Map<string, DistributorShare>()
  const PAGE = 200
  let offset = 0

  // Bounded to avoid an unbounded loop if Zoho ever misreports pagination.
  for (let page = 0; page < 50; page++) {
    const rows = await coql(
      `select Email, Secondary_Email, Name, Distributor_Share_Category, Base_Distributor_Share
         from Distributor
        where Distributor_Share_Category is not null
        limit ${offset}, ${PAGE}`,
    )

    for (const r of rows) {
      const primary = String(r.Email ?? '').trim().toLowerCase()
      const secondary = String(r.Secondary_Email ?? '').trim().toLowerCase()
      if (!primary && !secondary) continue   // unusable without a join key

      // Prefer the picklist category, falling back to the numeric field —
      // they agree wherever both are set, but the category is the field the
      // business maintains.
      const sharePct =
        parseSharePct(r.Distributor_Share_Category) ?? parseSharePct(r.Base_Distributor_Share)

      const record: DistributorShare = {
        distributorEmail: primary || secondary,
        distributorName: r.Name ?? null,
        sharePct,
        shareCategory: r.Distributor_Share_Category ?? null,
      }

      // Both addresses resolve to the same record. First write wins, so a
      // duplicate Zoho record cannot make the reported rate flip between
      // refreshes — and a secondary address never overwrites a primary one.
      for (const key of [primary, secondary]) {
        if (key && !out.has(key)) out.set(key, record)
      }
    }

    if (rows.length < PAGE) break
    offset += PAGE
  }

  return out
}

/** Every distributor share, keyed by lowercased email. */
export async function getDistributorShares(): Promise<Map<string, DistributorShare>> {
  if (cache && cache.expiresAt > Date.now()) return cache.data
  const data = await fetchAll()
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  return data
}

/** The share for one distributor, or null when Zoho has no category for them. */
export async function getShareForDistributor(
  distributorEmail: string | null | undefined,
): Promise<DistributorShare | null> {
  const key = String(distributorEmail ?? '').trim().toLowerCase()
  if (!key) return null
  const all = await getDistributorShares()
  return all.get(key) ?? null
}

/** Clears the cache — for tests, or a manual refresh after editing Zoho. */
export function clearDistributorShareCache(): void {
  cache = null
}
