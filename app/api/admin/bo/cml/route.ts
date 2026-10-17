// Admin → CML: every client's Client Master List in Qode's format (lib/cml.ts), by family group.
//
// GET (super / investors admins)                     → { groups: [{ groupId, groupName, clients: [{ clientId, name, codes,
//                                                         closed, cml: { uploadedAt } | null }] }], counts }
// GET ?client=<clientid>[&client=…]                 → printable HTML (Save as PDF), a page per client
// GET ?group=<groupid>                              → the same for every client of the group that has a CML
// The CML holds PAN, bank account and date of birth: only super and investors admins, and every download is audited.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit, forbidden } from '@/lib/adminAuth'
import { query } from '@/lib/db'
import { listCmlFiles, readCml, cmlHtml, type Cml } from '@/lib/cml'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const plain = (id: unknown) => String(id ?? '').trim().replace(/\.0+$/, '')
const strategy = (s: unknown) => String(s || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()

type Client = { clientId: string; name: string; groupId: string; groupName: string; codes: { code: string; strategy: string; closed: boolean }[]; closed: boolean }

async function clients(): Promise<Client[]> {
  const r = await query(
    `SELECT clientid, clientcode, trim(clientname) AS name, schemename, groupid, trim(groupname) AS groupname, ownerid,
            (maturity_date IS NOT NULL AND maturity_date <= NOW()) AS closed
       FROM pms_clients_master
      WHERE clientid IS NOT NULL AND clientcode IS NOT NULL AND clientcode ~* '^Q' AND clientcode !~* '^QTEST'
      ORDER BY groupname, clientname, clientcode`)
  const by = new Map<string, Client>()
  for (const x of r.rows as any[]) {
    const id = plain(x.clientid)
    const c: Client = by.get(id) || { clientId: id, name: x.name, groupId: plain(x.groupid) || 'owner:' + plain(x.ownerid), groupName: x.groupname || x.name, codes: [], closed: true }
    c.codes.push({ code: x.clientcode, strategy: strategy(x.schemename), closed: !!x.closed })
    c.closed = c.closed && !!x.closed
    by.set(id, c)
  }
  return [...by.values()]
}

export async function GET(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'staff')
  if (error) return error
  if (admin!.role !== 'super' && admin!.role !== 'investors') return forbidden()
  const sp = req.nextUrl.searchParams
  try {
    const [all, files] = await Promise.all([clients(), listCmlFiles()])
    const ids = sp.getAll('client').map(plain).filter(Boolean)
    const group = sp.get('group')
    if (ids.length || group) {
      const chosen = group ? all.filter(c => c.groupId === group) : all.filter(c => ids.includes(c.clientId))
      const withFile = chosen.filter(c => files.has(c.clientId))
      if (!withFile.length) return new NextResponse('No CML is on file for this selection.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      const docs: { cml: Cml; clientId: string; accounts: string }[] = []
      const failed: string[] = []
      for (const c of withFile) {
        try { docs.push({ cml: await readCml(files.get(c.clientId)!.key), clientId: c.clientId, accounts: c.codes.map(x => x.code).join(', ') }) }
        catch { failed.push(c.name) }
      }
      if (!docs.length) return new NextResponse(`The CML on file could not be read${failed.length ? ' (' + failed.join(', ') + ')' : ''}: it may be password-protected or a scan.`, { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      const title = group ? `CML · ${chosen[0]?.groupName || group}` : `CML · ${docs[0].cml.name || docs[0].clientId}`
      await audit(req, admin!, 'cml.download', group ? 'group:' + group : ids.join(','), { clients: docs.map(d => d.clientId), unreadable: failed })
      return new NextResponse(cmlHtml(docs, title), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })
    }

    const groups = new Map<string, { groupId: string; groupName: string; clients: any[] }>()
    for (const c of all) {
      const g = groups.get(c.groupId) || { groupId: c.groupId, groupName: c.groupName, clients: [] }
      const f = files.get(c.clientId)
      g.clients.push({ clientId: c.clientId, name: c.name, codes: c.codes, closed: c.closed, cml: f ? { uploadedAt: f.lastModified } : null })
      groups.set(c.groupId, g)
    }
    const list = [...groups.values()].sort((a, b) => a.groupName.localeCompare(b.groupName))
    const flat = list.flatMap(g => g.clients)
    return NextResponse.json({
      groups: list,
      counts: { groups: list.length, clients: flat.length, withCml: flat.filter(c => c.cml).length, missing: flat.filter(c => !c.cml && !c.closed).length },
    })
  } catch (e: any) {
    console.error('[admin/bo/cml]', e)
    return NextResponse.json({ error: 'Could not load the CMLs: ' + (e?.message || 'unknown error') }, { status: 502 })
  }
}
