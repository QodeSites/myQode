// Which portal account (client code) belongs to each investor in a partner's book — shared by the web partner route
// (app/api/distributor/journey) and the app's (lib/mobileDistributor.ts) so the two can never disagree.
//
// Matched by the investor's CRM email first, then by Zoho's Legal_Name, then by the CRM name: the CRM contact is
// often not the account holder (Jayesh Kantilal Sanghvi in Zoho, account QGF00262 in Heeta Jayesh Sanghvi's name with
// another email). Always scoped to THIS partner's own book (intermediaryname = partner's clientname): a client filed
// under another intermediary is never linked, whatever the name or email says.
import { query } from '@/lib/db'

const nameKey = (n: unknown) =>
  String(n ?? '').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr|shri|smt)\.?\s+/g, '').replace(/[^a-z]+/g, ' ').trim()

export async function partnerClientCodes(partnerName: string | null | undefined) {
  const byEmail = new Map<string, string>(), byName = new Map<string, string>()
  if (partnerName) {
    const r = await query(
      `SELECT lower(trim(email)) AS email, clientcode, clientname FROM pms_clients_master
        WHERE intermediaryname = $1 AND clientcode IS NOT NULL`, [partnerName])
    for (const row of r.rows ?? []) {
      // several accounts of one person: the first opens their view
      if (row.email && !byEmail.has(row.email)) byEmail.set(row.email, String(row.clientcode))
      const k = nameKey(row.clientname)
      if (k && !byName.has(k)) byName.set(k, String(row.clientcode))
    }
  }
  return (c: { email?: string | null; legalName?: string | null; name?: string | null }) =>
    byEmail.get(String(c.email ?? '').trim().toLowerCase()) ?? byName.get(nameKey(c.legalName)) ?? byName.get(nameKey(c.name)) ?? null
}
