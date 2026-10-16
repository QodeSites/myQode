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

// ── Referrals (14 Oct 2026) ─────────────────────────────────────────────────────────────────────────────────────
// A client refers someone from the app or web (Support › Referral Program): the referred person becomes a Lead with
// Lead Source "Investor Referral", and the Lead's Referring Investor (a lookup to the Investors module) points at the
// client who referred them — their Investor record, found by the logged-in client's email. A referred person who is
// already a Lead (same mobile, else same email) is not duplicated: the existing Lead gets the referrer when it has none.

const leadUrl = (id: string) => `https://crm.zoho.in/crm/org${process.env.ZOHO_CRM_ORG_ID || ''}/tab/Leads/${id}`

async function zohoRead(path: string): Promise<any> {
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/${path}`, { cache: 'no-store' })
  if (res.status === 204) return null
  const body: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message || `Zoho ${path.split('?')[0]} failed (${res.status})`)
  return body
}
async function zohoWrite(method: 'POST' | 'PUT', path: string, record: Record<string, unknown>): Promise<string> {
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/${path}`, {
    method, cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [record], trigger: ['workflow'] }),
  }, { write: true })
  const body: any = await res.json().catch(() => null)
  const d = body?.data?.[0]
  if (!res.ok || !d || d.status === 'error') {
    console.error('[zohoLeads] Zoho refused', method, path, JSON.stringify(d || body).slice(0, 500))
    throw new Error((d?.message || body?.message || `Zoho refused the lead (${res.status})`) + (d?.details?.api_name ? ` (${d.details.api_name})` : ''))
  }
  return String(d.details?.id || '')
}

/**
 * The referring client's Investor record: the one on this email. A family login has one per member — then the one
 * whose name matches the account the referral was made from (holderName), else the first.
 */
export async function findReferringInvestor(email: string, holderName?: string | null): Promise<{ id: string; name: string } | null> {
  const key = String(email || '').trim().toLowerCase()
  if (!key) return null
  const body = await zohoRead(`Investors/search?email=${encodeURIComponent(key)}&fields=Name,Legal_Name&per_page=50`)
  const list: any[] = body?.data || []
  if (!list.length) return null
  const norm = (s: unknown) => String(s || '').toLowerCase().replace(/^(mr|mrs|ms|miss|dr)\.?\s+/, '').replace(/[^a-z]/g, '')
  const want = norm(holderName)
  const hit = (want && list.find(x => norm(x.Legal_Name) === want || norm(x.Name) === want)) || list[0]
  return { id: String(hit.id), name: String(hit.Legal_Name || hit.Name || '') }
}

/** A Lead with this mobile (Phone or Mobile) or, failing that, this email: { id, referrer id or null }. */
async function findLead(phone: { e164: string; number: string } | null, email: string): Promise<{ id: string; referrer: string | null } | null> {
  const pick = (body: any) => { const d = body?.data?.[0]; return d ? { id: String(d.id), referrer: d.Referring_Investor?.id ? String(d.Referring_Investor.id) : null } : null }
  for (const p of phone ? [phone.e164, phone.number] : []) {
    const hit = pick(await zohoRead(`Leads/search?phone=${encodeURIComponent(p)}&fields=Referring_Investor`))
    if (hit) return hit
  }
  const e = String(email || '').trim().toLowerCase()
  return e ? pick(await zohoRead(`Leads/search?email=${encodeURIComponent(e)}&fields=Referring_Investor`)) : null
}

export type ReferralLead = {
  name: string; email: string; phone: string; note?: string | null; channel?: string | null
  referrer: { email: string; name?: string | null; accountId: string; holderName?: string | null }
}
export type ReferralLeadResult = { id: string; status: 'created' | 'existing'; url: string; referringInvestorId: string | null }

/** Find or create the referred person's Lead, linked to the referring client's Investor record. Throws when Zoho refuses. */
export async function upsertReferralLead(r: ReferralLead): Promise<ReferralLeadResult> {
  if (!hasZohoWriteToken()) throw new Error('ZOHO_CRM_WRITE_REFRESH_TOKEN is not set')
  const phone = normalisePhone(r.phone)
  const investor = await findReferringInvestor(r.referrer.email, r.referrer.holderName)
  if (!investor) console.warn('[zohoLeads] no Investor record for referrer', r.referrer.email, '- lead created without Referring Investor')
  const referrerName = investor?.name || r.referrer.name || r.referrer.email

  const existing = await findLead(phone, r.email)
  if (existing) {
    // known already: never a second Lead; give it the referrer if it has none
    if (investor && !existing.referrer) await zohoWrite('PUT', 'Leads', { id: existing.id, Referring_Investor: { id: investor.id } })
    return { id: existing.id, status: 'existing', url: leadUrl(existing.id), referringInvestorId: investor?.id || existing.referrer }
  }

  const parts = r.name.trim().split(/\s+/).filter(Boolean)
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const id = await zohoWrite('POST', 'Leads', {
    ...(parts.length > 1 ? { First_Name: parts[0] } : {}),
    Last_Name: parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || r.email,
    Email: r.email.trim().toLowerCase(),
    ...(phone ? { Phone: phone.e164, Mobile: phone.e164 } : {}),
    Lead_Source: 'Investor Referral',
    Lead_Status: 'Not Contacted',
    ...(investor ? { Referring_Investor: { id: investor.id } } : {}),
    Company: `Referred by ${referrerName}`,
    Description: `Referred on myQode ${r.channel || 'App'} by ${referrerName} (${r.referrer.accountId}, ${r.referrer.email}).`
      + (r.note ? `\nNote from the client: ${String(r.note).trim()}` : ''),
    Lead_Added_On: today,
    Next_Contact_Date: today,
  })
  return { id, status: 'created', url: leadUrl(id), referringInvestorId: investor?.id || null }
}

// A referral's status for Past Requests (lib/requestTracking.ts): the Lead's Lead Status exactly as Zoho has it,
// cached two minutes. Converted, Lost and Junk read as closed; the rest open. Null when the Lead cannot be read.
const leadCache = new Map<string, { at: number; s: { state: 'open' | 'on_hold' | 'closed'; label: string; updatedAt: string | null } | null }>()
export async function leadStatus(id: string) {
  if (!id) return null
  const hit = leadCache.get(id)
  if (hit && Date.now() - hit.at < 20_000) return hit.s
  let s: { state: 'open' | 'on_hold' | 'closed'; label: string; updatedAt: string | null } | null = null
  try {
    const d = (await zohoRead(`Leads/${id}?fields=Lead_Status,Modified_Time`))?.data?.[0]
    if (d) {
      const label = String(d.Lead_Status || '').trim()
      s = label ? { state: /convert|lost|junk|not qualified/i.test(label) ? 'closed' : 'open', label, updatedAt: d.Modified_Time || null } : null
    }
  } catch (e: any) { console.warn('[zohoLeads] lead', id, 'not read -', e?.message) }
  leadCache.set(id, { at: Date.now(), s })
  return s
}
