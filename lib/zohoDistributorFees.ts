// Distributor revenue-sharing terms, sourced from Zoho CRM.
//
// WHY THIS EXISTS
// The fee calculator previously read `intermediary_fee_percentage` from
// pms_clients_master. That column is populated for 15 of 507 clients, and
// `parseFloat(null) || 0` turned the other 492 into a 0% share — so the fees
// page reported ₹0 distributor share for ~97% of the book while looking
// perfectly healthy.
//
// WHICH FIELD DRIVES THE SPLIT
// `Base_Distributor_Share` — the agreed % of the RACK RATE fee the distributor
// keeps, per their signed agreement. Not `Distributor_Net_Fee_Pct` on the
// Investors module, which is a trail-style rate on AUM and means something
// else entirely. `Distributor_Share_Category` is a display picklist ("65%")
// that mirrors the same number.
//
// Values in use today: 50 (Standard 50:50), 55 and 50 (Tiered), 60 and 65
// (Flat Custom Split).
import { getZohoAccessToken, zohoApiDomain } from '@/lib/zoho'

/** The revenue-sharing arrangement, per the signed agreement. */
export type RevenueSharingModel =
  | 'Standard 50:50'
  | 'Flat Custom Split'
  | 'Tiered'
  | 'Special Arrangement'
  | string

export interface DistributorShare {
  /** Distributor's email, lowercased — matches the portal login. */
  distributorEmail: string
  distributorName: string | null

  /**
   * Share of the RACK RATE fee, as a percentage (65 means 65%).
   * Null when unset in Zoho — deliberately distinct from a real 0%.
   */
  sharePct: number | null

  /** The picklist label, e.g. "65%" — shown where the exact wording matters. */
  shareCategory: string | null

  /** Standard 50:50 | Flat Custom Split | Tiered | Special Arrangement. */
  model: RevenueSharingModel | null

  /**
   * True when the performance-fee split uses the same rack-rate basis as the
   * fixed-fee split. Zoho's `Performance_Fee_Split_Basis` checkbox.
   *
   * Note this is a *basis* flag, not a separate rate: no distributor currently
   * has a performance split that differs from their fixed split. Part 7 of the
   * implementation plan flags that as an open question, so if a separate rate
   * ever appears it needs its own field rather than being inferred here.
   */
  perfFeeSplitOnRackRate: boolean

  /** 'Yes' | 'No' | null — whether they may discount the investor's fee. */
  discountAllowed: string | null

  /** Maximum discount % they are permitted to pass on, when allowed. */
  maxDiscountPct: number | null

  /** AUM breakpoints for Tiered arrangements — free text, needs a human. */
  tieredDetails: string | null
}

/** Cached briefly: a full-module read, and Zoho rate-limits API calls. */
let cache: { data: Map<string, DistributorShare>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Parses a share value into a number.
 *
 * Handles both the numeric field and the picklist string ("65%"). Returns null
 * for unset — distinct from 0%, which would be a real "earns nothing" rate.
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
 * null` is the idiomatic way to say "all rows" — and caps at 200 rows per call.
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
 * Fetches every distributor with an agreed share.
 *
 * Indexed by BOTH Email and Secondary_Email: a firm's CRM contact is often not
 * the address they log into the portal with — One Battalion is
 * jash@thepersonalcfo.in in Zoho but signs in as advisory@onebattalion.in.
 */
async function fetchAll(): Promise<Map<string, DistributorShare>> {
  const out = new Map<string, DistributorShare>()
  const PAGE = 200
  let offset = 0

  for (let page = 0; page < 50; page++) {
    const rows = await coql(
      `select Email, Secondary_Email, Name,
              Effective_Distributor_Split,
              Base_Distributor_Share, Effective_Revenue_Share, Distributor_Share_Category,
              Revenue_Sharing_Model, Performance_Fee_Split_Basis,
              Discount_Allowed, Max_Discount_Permitted, Tiered_Revenue_Details
         from Distributor
        where Base_Distributor_Share is not null
        limit ${offset}, ${PAGE}`,
    )

    for (const r of rows) {
      const primary = String(r.Email ?? '').trim().toLowerCase()
      const secondary = String(r.Secondary_Email ?? '').trim().toLowerCase()
      if (!primary && !secondary) continue   // unusable without a join key

      // Resolution order, most specific first.
      //
      // `Effective_Distributor_Split` is the field intended to replace the
      // hardcoded 50%, so it leads. It is NOT used alone: it is populated on
      // only 21 of 129 distributors, and is empty on both Tiered ones —
      // Nuarch (a ₹4.3 lakh/quarter book) and Finwin. Using it as the sole
      // source would drop those to a 0% share.
      //
      // Verified across every populated record: it agrees with the existing
      // resolution on all 20 that have both, so leading with it changes no
      // current payout, and it takes over automatically as it is filled in.
      const sharePct =
        parseSharePct(r.Effective_Distributor_Split) ??
        parseSharePct(r.Effective_Revenue_Share) ??
        parseSharePct(r.Base_Distributor_Share) ??
        parseSharePct(r.Distributor_Share_Category)

      const record: DistributorShare = {
        distributorEmail: primary || secondary,
        distributorName: r.Name ?? null,
        sharePct,
        shareCategory: r.Distributor_Share_Category ?? null,
        model: r.Revenue_Sharing_Model ?? null,
        perfFeeSplitOnRackRate: r.Performance_Fee_Split_Basis !== false,
        discountAllowed: r.Discount_Allowed ?? null,
        maxDiscountPct: parseSharePct(r.Max_Discount_Permitted),
        tieredDetails: r.Tiered_Revenue_Details ?? null,
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

/** Every distributor's terms, keyed by lowercased email. */
export async function getDistributorShares(): Promise<Map<string, DistributorShare>> {
  if (cache && cache.expiresAt > Date.now()) return cache.data
  const data = await fetchAll()
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  return data
}

/** Terms for one distributor, or null when Zoho has no record for them. */
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
