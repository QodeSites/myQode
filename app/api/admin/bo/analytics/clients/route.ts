// GET /api/admin/bo/analytics/clients (staff): the App analytics page, one row per client (lib/clientUsage.ts).
//   ?days=7|14|30|90        the period for "used it", pages and notifications (IST days, default 30)
//   ?email=<client email>   one client's activity log instead: what they opened, sign-ins, notifications
//   ?note=<category>|<title> who received one notification in the period
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { clientCrm } from '@/lib/clientCrm'
import { clientLog, clientUsage, noteRecipients, people, remindedAt, sinceSql, staffViews } from '@/lib/clientUsage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  const sp = req.nextUrl.searchParams
  const days = [7, 14, 30, 90].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30
  try {
    const one = String(sp.get('email') || '').trim().toLowerCase(), note = sp.get('note')
    if (one || note) {
      const { byEmail } = await people()
      if (one) return NextResponse.json(await clientLog(one, byEmail.get(one) ?? null, await staffViews(byEmail)))
      return NextResponse.json(await noteRecipients(note!, sinceSql(days), byEmail))
    }
    const [data, reminded] = await Promise.all([clientUsage(days), remindedAt()])
    // Zoho CRM (lead source, relationship manager, partner) and assets, per client: lib/clientCrm.ts
    const { zoho, crm, aum } = await clientCrm(data.clients)
    return NextResponse.json({ ...data, zoho, clients: data.clients.map(c => ({ ...c, remindedAt: reminded.get(c.email) ?? null,
      source: crm.get(c.id)?.source ?? null, bucket: crm.get(c.id)?.bucket ?? null, rm: crm.get(c.id)?.rm ?? null, partner: crm.get(c.id)?.partner ?? null, inZoho: !!crm.get(c.id)?.matchedBy, aum: aum.get(c.id) ?? 0 })) })
  } catch (e) {
    console.error('[bo/analytics/clients]', e)
    return NextResponse.json({ error: 'Could not load the analytics' }, { status: 500 })
  }
}
