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
  activationDate: string | null // Zoho's funding/conversion milestone date
  investorSize: number | null
  investedAmount: number | null
  ownerName: string | null // RM/Investor Owner
  annualReviewStatus: string | null
}

type RawRecord = {
  source: string
  activated: boolean
  activationDate: string | null
  investorSize: number | null
  investedAmount: number | null
  ownerName: string | null
  annualReviewStatus: string | null
}

let sourceCache: { data: Map<string, ZohoInvestorRecord>; expiresAt: number } | null = null
let rawRecordsCache: { data: Array<{ email: string; source: string; activated: boolean; activationDate: string | null }>; expiresAt: number } | null = null
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1000

async function fetchInvestorRecords(): Promise<Map<string, ZohoInvestorRecord>> {
  if (sourceCache && sourceCache.expiresAt > Date.now()) return sourceCache.data

  const token = await getAccessToken()
  const domain = crmApiDomain()
  const rawByEmail = new Map<string, RawRecord[]>()
  const flatRawRecords: Array<{ email: string; source: string; activated: boolean; activationDate: string | null }> = []

  let page = 1
  let more = true
  while (more) {
    const res = await fetch(
      `${domain}/crm/v2/Investors?fields=Email,Investor_Source,Activation_Date,Investor_Size,Invested_Amount,Owner,Annual_Review_Status&per_page=200&page=${page}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: 'no-store' }
    )
    if (res.status === 204) break // no (more) records
    if (!res.ok) {
      throw new Error(`Zoho Investors listing failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as {
      data?: Array<{
        Email?: string
        Investor_Source?: string
        Activation_Date?: string
        Investor_Size?: number | string
        Invested_Amount?: number | string
        Owner?: { name?: string }
        Annual_Review_Status?: string
      }>
      info?: { more_records?: boolean }
    }
    for (const rec of data.data ?? []) {
      if (!rec.Email) continue
      const key = rec.Email.toLowerCase()
      if (!rawByEmail.has(key)) rawByEmail.set(key, [])
      const source = rec.Investor_Source || '-None-'
      const activated = Boolean(rec.Activation_Date)
      rawByEmail.get(key)!.push({
        source,
        activated,
        activationDate: rec.Activation_Date ?? null,
        investorSize: rec.Investor_Size != null ? parseFloat(String(rec.Investor_Size)) : null,
        investedAmount: rec.Invested_Amount != null ? parseFloat(String(rec.Invested_Amount)) : null,
        ownerName: rec.Owner?.name ?? null,
        annualReviewStatus: rec.Annual_Review_Status ?? null,
      })
      flatRawRecords.push({ email: key, source, activated, activationDate: rec.Activation_Date ?? null })
    }
    more = Boolean(data.info?.more_records)
    page += 1
  }

  // A handful of emails have multiple Zoho records under DIFFERENT sources
  // (e.g. one "Investor Referral" record and several "Personal Relation"
  // ones for the same person). Picking whichever happened to load first
  // made counts unstable across fetches. Instead: majority source wins
  // (ties broken by first-seen), and activated = true if ANY of their
  // records reached the milestone. For the other fields, prefer whichever
  // duplicate record is activated (most likely to be the "real"/complete one).
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
    const primary = recs.find(r => r.activated) ?? recs[0]
    map.set(email, {
      source: majoritySource,
      activated: recs.some(r => r.activated),
      recordCount: recs.length,
      activationDate: recs.map(r => r.activationDate).filter(Boolean).sort()[0] ?? null,
      investorSize: primary.investorSize,
      investedAmount: primary.investedAmount,
      ownerName: primary.ownerName,
      annualReviewStatus: primary.annualReviewStatus,
    })
  }

  sourceCache = { data: map, expiresAt: Date.now() + SOURCE_CACHE_TTL_MS }
  rawRecordsCache = { data: flatRawRecords, expiresAt: Date.now() + SOURCE_CACHE_TTL_MS }
  return map
}

async function fetchFlatRawRecords(): Promise<Array<{ email: string; source: string; activated: boolean; activationDate: string | null }>> {
  if (rawRecordsCache && rawRecordsCache.expiresAt > Date.now()) return rawRecordsCache.data
  await fetchInvestorRecords() // populates rawRecordsCache as a side effect
  return rawRecordsCache?.data ?? []
}

/** Every raw Zoho Investors record (email, source, activated) — not deduped. */
export async function getRawInvestorRecords(): Promise<Array<{ email: string; source: string; activated: boolean; activationDate: string | null }>> {
  return fetchFlatRawRecords()
}

/** Full per-email Zoho record — used for cross-cutting analytics (AUM, RM, activation timing). */
export async function getInvestorRecordMap(): Promise<Map<string, ZohoInvestorRecord>> {
  return fetchInvestorRecords()
}

/** email (lowercase) -> Investor_Source, for merging into per-client rows. */
export async function getInvestorSourceMap(): Promise<Map<string, string>> {
  const records = await fetchInvestorRecords()
  const map = new Map<string, string>()
  for (const [email, r] of records) map.set(email, r.source)
  return map
}

/**
 * Per-source totals, counted by RAW RECORD — not deduped by email.
 *
 * Zoho records genuinely represent distinct investor entities even when they
 * share an email address (e.g. a family office where several members' or
 * HUFs' separate accounts all list one shared contact email) — so counting
 * records is the accurate "how many real investors" number, not an inflated
 * one. This replaced an earlier email-deduped version that undercounted
 * families sharing an email.
 */
export async function getZohoSourceTotals(): Promise<
  Array<{ source: string; total: number; activated: number }>
> {
  const flat = await fetchFlatRawRecords()
  const bySource = new Map<string, { total: number; activated: number }>()
  for (const r of flat) {
    if (!bySource.has(r.source)) bySource.set(r.source, { total: 0, activated: 0 })
    const entry = bySource.get(r.source)!
    entry.total += 1
    if (r.activated) entry.activated += 1
  }
  return Array.from(bySource.entries())
    .map(([source, v]) => ({ source, total: v.total, activated: v.activated }))
    .sort((a, b) => b.total - a.total)
}
