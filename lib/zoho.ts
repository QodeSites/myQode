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
