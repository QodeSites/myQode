// GET /api/admin/bo/analytics/clients (staff): the App analytics page, one row per client (lib/clientUsage.ts).
//   ?days=7|14|30|90        the period for "used it", pages and notifications (IST days, default 30)
//   ?email=<client email>   one client's activity log instead: what they opened, sign-ins, notifications
//   ?note=<category>|<title> who received one notification in the period
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
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
    return NextResponse.json({ ...data, clients: data.clients.map(c => ({ ...c, remindedAt: reminded.get(c.email) ?? null })) })
  } catch (e) {
    console.error('[bo/analytics/clients]', e)
    return NextResponse.json({ error: 'Could not load the analytics' }, { status: 500 })
  }
}
