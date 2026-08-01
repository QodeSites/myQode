// Investor CRM details, for the distributor portal.
//
// WHY THIS IS SAFE TO SHOW A DISTRIBUTOR
// This module returns a deliberately narrow slice of the Zoho Investors
// module: activation date, relationship manager, and onboarding status. It
// does NOT return notes, internal commentary, fee negotiations, or any other
// free-text field, because those are written for an internal audience and a
// distributor is an external party.
//
// Access control does not live here. The caller
// (app/api/distributor/clients) already filters clients by
// pms_clients_master.intermediaryname, so a distributor only ever asks about
// their own book. This module is a lookup by email and enforces nothing — do
// not call it with an unfiltered client list.
import { getZohoAccessToken, zohoApiDomain } from '@/lib/zoho'

export interface InvestorCrmDetail {
  /** Lowercased email — the join key against pms_clients_master. */
  email: string
  /** Zoho's funding/conversion milestone: when they became a funded client. */
  activationDate: string | null
  /** The Qode relationship manager who owns this investor. */
  relationshipManager: string | null
  /** e.g. "Completed", "Due" — null when Zoho has none set. */
  annualReviewStatus: string | null
}

let cache: { data: Map<string, InvestorCrmDetail>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

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

  if (res.status === 204) return []
  if (!res.ok) {
    throw new Error(`Zoho COQL failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
  }

  const body = (await res.json()) as { data?: any[] }
  return body.data ?? []
}

/**
 * Fetches CRM details for every investor sourced through a distributor.
 *
 * Scoped to `Investor_Source = 'Distributor'` rather than the whole module:
 * direct clients are not a distributor's business, and not fetching them at
 * all is a stronger guarantee than filtering them out afterwards.
 */
async function fetchAll(): Promise<Map<string, InvestorCrmDetail>> {
  const out = new Map<string, InvestorCrmDetail>()
  const PAGE = 200
  let offset = 0

  for (let page = 0; page < 50; page++) {
    // Owner must be selected as dotted sub-fields. Selecting `Owner` alone
    // returns an empty object in COQL (unlike the REST API, which returns
    // `{name, id}`), so the RM silently came back null.
    const rows = await coql(
      `select Email, Activation_Date, Annual_Review_Status,
              Owner.first_name, Owner.last_name
         from Investors
        where Investor_Source = 'Distributor'
        limit ${offset}, ${PAGE}`,
    )

    for (const r of rows) {
      const email = String(r.Email ?? '').trim().toLowerCase()
      if (!email) continue
      // Zoho holds duplicate investor records for some people; first seen wins
      // so the reported detail is stable across refreshes.
      if (out.has(email)) continue

      const rm = [r['Owner.first_name'], r['Owner.last_name']]
        .filter(Boolean)
        .join(' ')
        .trim()

      out.set(email, {
        email,
        activationDate: r.Activation_Date ?? null,
        relationshipManager: rm || null,
        annualReviewStatus: r.Annual_Review_Status ?? null,
      })
    }

    if (rows.length < PAGE) break
    offset += PAGE
  }

  return out
}

/** All distributor-sourced investor details, keyed by lowercased email. */
export async function getInvestorCrmDetails(): Promise<Map<string, InvestorCrmDetail>> {
  if (cache && cache.expiresAt > Date.now()) return cache.data
  const data = await fetchAll()
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  return data
}

/** Clears the cache — for tests, or a manual refresh after editing Zoho. */
export function clearInvestorCrmCache(): void {
  cache = null
}
