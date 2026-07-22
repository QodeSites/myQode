// Minimal Zoho CRM client for admin-side lookups ("View in Zoho" links).
// Shares the same Zoho CRM org as new-qode-website — credentials copied from
// there (ZOHO_CRM_CLIENT_ID/SECRET/REFRESH_TOKEN, ZOHO_DATA_CENTER).
//
// Only what's needed for read-only search-by-email + building a direct
// record URL. No lead/contact creation here (that lives in new-qode-website).

const DATA_CENTER = process.env.ZOHO_DATA_CENTER || 'in'
const ORG_ID = process.env.ZOHO_CRM_ORG_ID || ''

// Module API name -> UI tab identifier (from /crm/v2/settings/modules
// module_name field — differs from api_name for custom modules).
export const ZOHO_MODULE_TABS: Record<string, string> = {
  Investors: 'CustomModule1',
  Distributor: 'CustomModule5',
}

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const res = await fetch(`https://accounts.zoho.${DATA_CENTER}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_CRM_REFRESH_TOKEN!,
      client_id: process.env.ZOHO_CRM_CLIENT_ID!,
      client_secret: process.env.ZOHO_CRM_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    throw new Error(`Zoho token refresh failed: ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cachedToken.token
}

function crmApiDomain(): string {
  return `https://www.zohoapis.${DATA_CENTER}`
}

/**
 * Search a Zoho CRM module by email and return the record's direct UI URL,
 * or null if no record matches.
 */
export async function findZohoRecordUrlByEmail(
  moduleApiName: 'Investors' | 'Distributor',
  email: string
): Promise<string | null> {
  if (!ORG_ID) throw new Error('ZOHO_CRM_ORG_ID not set')

  const token = await getAccessToken()
  const domain = crmApiDomain()

  const res = await fetch(
    `${domain}/crm/v2/${moduleApiName}/search?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: 'no-store' }
  )

  if (res.status === 204) return null // no matching record
  if (!res.ok) {
    throw new Error(`Zoho search failed (${moduleApiName}): ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as { data?: Array<{ id: string }> }
  const recordId = data.data?.[0]?.id
  if (!recordId) return null

  const tab = ZOHO_MODULE_TABS[moduleApiName]
  return `https://crm.zoho.${DATA_CENTER}/crm/org${ORG_ID}/tab/${tab}/${recordId}`
}

// ── Bulk Investor_Source + Activation_Date lookup ────────────────────────────
// Investor_Source is a picklist field on the Investors module (values like
// "Whatsapp", "Website", "Google Ads", "Distributor", etc.). Activation_Date
// is Zoho's own "reached the funding/conversion milestone" marker — this is
// what the "Investor Funding Conversion" CRM dashboard component counts, and
// it does NOT mean "has a real myQode account" (that's a separate, smaller
// overlap we compute against pms_clients_master).
//
// Cached in-memory for a few minutes — this is a full-module listing, not
// worth re-fetching on every dashboard load, and Zoho API calls are
// rate-limited. Raw records are deduped by email (Zoho has some duplicate
// records per person) before being cached.

export interface ZohoInvestorRecord {
  source: string
  activated: boolean
  recordCount: number // how many raw Zoho records collapsed into this one person
}

let sourceCache: { data: Map<string, ZohoInvestorRecord>; expiresAt: number } | null = null
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1000

async function fetchInvestorRecords(): Promise<Map<string, ZohoInvestorRecord>> {
  if (sourceCache && sourceCache.expiresAt > Date.now()) return sourceCache.data

  const token = await getAccessToken()
  const domain = crmApiDomain()
  const rawByEmail = new Map<string, Array<{ source: string; activated: boolean }>>()

  let page = 1
  let more = true
  while (more) {
    const res = await fetch(
      `${domain}/crm/v2/Investors?fields=Email,Investor_Source,Activation_Date&per_page=200&page=${page}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: 'no-store' }
    )
    if (res.status === 204) break // no (more) records
    if (!res.ok) {
      throw new Error(`Zoho Investors listing failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as {
      data?: Array<{ Email?: string; Investor_Source?: string; Activation_Date?: string }>
      info?: { more_records?: boolean }
    }
    for (const rec of data.data ?? []) {
      if (!rec.Email) continue
      const key = rec.Email.toLowerCase()
      if (!rawByEmail.has(key)) rawByEmail.set(key, [])
      rawByEmail.get(key)!.push({
        source: rec.Investor_Source || '-None-',
        activated: Boolean(rec.Activation_Date),
      })
    }
    more = Boolean(data.info?.more_records)
    page += 1
  }

  // A handful of emails have multiple Zoho records under DIFFERENT sources
  // (e.g. one "Investor Referral" record and several "Personal Relation"
  // ones for the same person). Picking whichever happened to load first
  // made counts unstable across fetches. Instead: majority source wins
  // (ties broken by first-seen), and activated = true if ANY of their
  // records reached the milestone.
  const map = new Map<string, ZohoInvestorRecord>()
  for (const [email, recs] of rawByEmail) {
    const counts = new Map<string, number>()
    for (const r of recs) counts.set(r.source, (counts.get(r.source) ?? 0) + 1)
    let majoritySource = recs[0].source
    let bestCount = 0
    for (const [source, count] of counts) {
      if (count > bestCount) {
        bestCount = count
        majoritySource = source
      }
    }
    map.set(email, {
      source: majoritySource,
      activated: recs.some(r => r.activated),
      recordCount: recs.length,
    })
  }

  sourceCache = { data: map, expiresAt: Date.now() + SOURCE_CACHE_TTL_MS }
  return map
}

/** email (lowercase) -> Investor_Source, for merging into per-client rows. */
export async function getInvestorSourceMap(): Promise<Map<string, string>> {
  const records = await fetchInvestorRecords()
  const map = new Map<string, string>()
  for (const [email, r] of records) map.set(email, r.source)
  return map
}

/**
 * Per-source totals straight from Zoho (deduped by email), independent of
 * whether that person has a matching account in myQode. Used to reconcile
 * against myQode's own per-source counts.
 */
export async function getZohoSourceTotals(): Promise<
  Array<{ source: string; zohoTotal: number; zohoActivated: number; duplicateEmails: number; rawRecords: number }>
> {
  const records = await fetchInvestorRecords()
  const bySource = new Map<string, { total: number; activated: number; duplicateEmails: number; rawRecords: number }>()
  for (const r of records.values()) {
    if (!bySource.has(r.source)) bySource.set(r.source, { total: 0, activated: 0, duplicateEmails: 0, rawRecords: 0 })
    const entry = bySource.get(r.source)!
    entry.total += 1
    entry.rawRecords += r.recordCount
    if (r.activated) entry.activated += 1
    if (r.recordCount > 1) entry.duplicateEmails += 1
  }
  return Array.from(bySource.entries())
    .map(([source, v]) => ({
      source,
      zohoTotal: v.total,
      zohoActivated: v.activated,
      duplicateEmails: v.duplicateEmails,
      rawRecords: v.rawRecords,
    }))
    .sort((a, b) => b.zohoTotal - a.zohoTotal)
}
