// App analytics joined to Zoho CRM and to the portfolio: for every client, where they came from (Investor_Source,
// and the broader Investor_Source_Bucket it belongs to),
// who at Qode looks after them (RM 1, else the record's owner), the partner who brought them, and their assets.
// So a group that needs chasing can be read by source and by the person who should make the call.
//
// How a client is matched to their Zoho Investors record, first hit wins:
//   1. the login email = the record's Email            2. = the record's Secondary_Email
//   3. the client's name = the record's Name           4. = the record's Legal_Name
// Names are compared without titles (Mr, Mrs, Ms, Dr, M/s), dots, case and extra spaces. A name that belongs to
// two Zoho records is never used (it would pick one at random). Unmatched clients are reported, not guessed.
// Zoho is read once and kept for 10 minutes; if it cannot be read, the page still loads without these columns.
import { query } from '@/lib/db'
import { zohoApiDomain, zohoFetch } from '@/lib/zoho'

export type ClientCrm = { source: string | null; bucket: string | null; rm: string | null; partner: string | null; matchedBy: 'email' | 'other email' | 'name' | 'legal name' | null }
type Rec = { source: string | null; bucket: string | null; rm: string | null; partner: string | null }

const TTL = 10 * 60 * 1000
let cache: { at: number; byEmail: Map<string, Rec>; byAlt: Map<string, Rec>; byName: Map<string, Rec | null>; byLegal: Map<string, Rec | null> } | null = null

const nameKey = (v: unknown) => String(v ?? '').toLowerCase().replace(/\./g, ' ').replace(/\b(mr|mrs|ms|miss|dr|shri|smt|m\/s)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

async function load() {
  if (cache && Date.now() - cache.at < TTL) return cache
  const byEmail = new Map<string, Rec>(), byAlt = new Map<string, Rec>(), byName = new Map<string, Rec | null>(), byLegal = new Map<string, Rec | null>()
  // a name seen on two records is marked null: not usable for matching
  const put = (m: Map<string, Rec | null>, k: string, r: Rec) => { if (k) m.set(k, m.has(k) ? null : r) }
  for (let page = 1; page <= 60; page++) {
    const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/Investors?fields=Email,Secondary_Email,Name,Legal_Name,Investor_Source,Investor_Source_Bucket,RM_Name,Owner,Primary_distributo&per_page=200&page=${page}`)
    if (res.status === 204) break
    if (!res.ok) throw new Error(`Zoho Investors listing failed: ${res.status}`)
    const body = (await res.json()) as { data?: any[]; info?: { more_records?: boolean } }
    for (const x of body.data ?? []) {
      const src = String(x.Investor_Source ?? '').trim()
      const r: Rec = {
        source: src && src !== '-None-' ? src : null,
        bucket: ((b: string) => (b && b !== '-None-' ? b : null))(String(x.Investor_Source_Bucket ?? '').trim()),
        rm: String(x.RM_Name?.name ?? '').trim() || String(x.Owner?.name ?? '').trim() || null,
        partner: String(x.Primary_distributo?.name ?? '').trim() || null,
      }
      const e = String(x.Email ?? '').trim().toLowerCase(), alt = String(x.Secondary_Email ?? '').trim().toLowerCase()
      if (e && !byEmail.has(e)) byEmail.set(e, r)
      if (alt && !byAlt.has(alt)) byAlt.set(alt, r)
      put(byName, nameKey(x.Name), r); put(byLegal, nameKey(x.Legal_Name), r)
    }
    if (!body.info?.more_records) break
  }
  cache = { at: Date.now(), byEmail, byAlt, byName, byLegal }
  return cache
}

/** Each client's Zoho details (by client id) and assets in rupees (latest portfolio value, summed over their accounts). */
export async function clientCrm(clients: { id: string; email: string; name: string; accounts: string[] }[]) {
  const [z, aumRows] = await Promise.all([
    load().catch(e => { console.error('[clientCrm] Zoho', (e as Error).message); return null }),
    query(`SELECT DISTINCT ON (account_code) account_code, portfolio_value::float8 AS v FROM public.pms_master_sheet
            WHERE account_code = ANY($1) ORDER BY account_code, report_date DESC`, [clients.flatMap(c => c.accounts)])
      .then(r => r.rows as { account_code: string; v: number }[]).catch(e => { console.error('[clientCrm] aum', (e as Error).message); return [] }),
  ])
  const value = new Map(aumRows.map(r => [r.account_code, Number(r.v) || 0]))
  const crm = new Map<string, ClientCrm>(), aum = new Map<string, number>()
  const perEmail = new Map<string, number>(); for (const c of clients) perEmail.set(c.email, (perEmail.get(c.email) || 0) + 1)
  for (const c of clients) {
    aum.set(c.id, c.accounts.reduce((s, a) => s + (value.get(a) || 0), 0))
    if (!z) continue
    const k = nameKey(c.name)
    const hit: [Rec | null | undefined, ClientCrm['matchedBy']][] = [[z.byEmail.get(c.email), 'email'], [z.byAlt.get(c.email), 'other email'], [z.byName.get(k), 'name'], [z.byLegal.get(k), 'legal name']]
    // Family members sharing one login: each is matched by their own name first, so they do not all take the email's record
    if ((perEmail.get(c.email) || 0) > 1) hit.push(...hit.splice(0, 2))
    const m = hit.find(x => x[0])
    crm.set(c.id, m ? { ...(m[0] as Rec), matchedBy: m[1] } : { source: null, bucket: null, rm: null, partner: null, matchedBy: null })
  }
  return { zoho: !!z, crm, aum }
}
