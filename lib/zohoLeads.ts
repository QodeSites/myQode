// Zoho CRM Leads for app sign-ups (decided 13 Oct 2026): someone new to Qode signs up in the app or on the web with
// name, email and mobile number to preview a sample portfolio. A mobile number not yet in the CRM's Leads becomes
// a new Lead (fields as the website's contact form, new-qode-website lib/zoho.ts createCrmLead); a number already
// there creates nothing. Reads use the app's read-only CRM token; the create uses the write token (lib/zoho.ts),
// whose scope must include ZohoCRM.modules.leads.CREATE (see app/api/auth/zoho/authorize ?write=switch).
import { zohoApiDomain, zohoFetch, hasZohoWriteToken } from '@/lib/zoho'

/** "+91 98765 43210", "09876543210", "9876543210" → { cc: '91', number: '9876543210', e164: '+919876543210' } */
export function normalisePhone(raw: string): { cc: string; number: string; e164: string } | null {
  const s = String(raw || '').trim()
  const intl = s.match(/^\+(\d{1,4})[\s-]*([\d\s-]{6,})$/)
  const cc = intl ? intl[1] : '91'
  let number = (intl ? intl[2] : s).replace(/\D/g, '')
  if (!intl) number = number.replace(/^(91|0)(?=\d{10}$)/, '')
  if (cc === '91' ? !/^[6-9]\d{9}$/.test(number) : !/^\d{6,15}$/.test(number)) return null
  return { cc, number, e164: `+${cc}${number}` }
}

/** The id of a Lead with this phone or mobile number, or null. Zoho's phone search matches Phone and Mobile. */
export async function findLeadByPhone(e164: string, number: string): Promise<string | null> {
  for (const p of [e164, number]) {
    const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/Leads/search?phone=${encodeURIComponent(p)}`, { cache: 'no-store' })
    if (res.status === 204) continue
    const body: any = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.message || `Zoho Leads search failed (${res.status})`)
    const id = body?.data?.[0]?.id
    if (id) return String(id)
  }
  return null
}

export type SignupLead = { name: string; email: string; phone: { e164: string; number: string }; channel?: string | null }

/** Create the Lead. Throws when Zoho refuses (the caller decides whether that blocks the sign-up). */
export async function createSignupLead(s: SignupLead): Promise<string> {
  if (!hasZohoWriteToken()) throw new Error('ZOHO_CRM_WRITE_REFRESH_TOKEN is not set')
  const parts = s.name.trim().split(/\s+/).filter(Boolean)
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || s.email
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const record: Record<string, unknown> = {
    ...(parts.length > 1 ? { First_Name: parts[0] } : {}),
    Last_Name: lastName,
    Email: s.email,
    Phone: s.phone.e164,
    Mobile: s.phone.e164,
    // where they signed up: the web app or the phone app (asked 13 Oct 2026); unknown → the web app, the only public sign-up page
    Lead_Source: s.channel === 'App' ? 'myQode Mobile App' : 'myQode Web App',
    Lead_Status: 'Not Contacted',
    Company: 'myQode App Sign-up',
    Description: `Signed up on myQode ${s.channel || 'App'} (mobile number verified by OTP); asked to be contacted by the team.`,
    Lead_Added_On: today,
    Next_Contact_Date: today,
  }
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/Leads`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [record], trigger: ['workflow'] }),
  }, { write: true })
  const body: any = await res.json().catch(() => null)
  const d = body?.data?.[0]
  if (!res.ok || !d || d.status === 'error') {
    console.error('[zohoLeads] Zoho refused the lead', JSON.stringify(d || body).slice(0, 500))
    throw new Error((d?.message || body?.message || `Zoho refused the lead (${res.status})`) + (d?.details?.api_name ? ` (${d.details.api_name})` : ''))
  }
  return String(d.details?.id || '')
}
