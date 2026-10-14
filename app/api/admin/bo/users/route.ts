// GET /api/admin/bo/users (staff): portal users, one per login email. See docs/admin-backoffice-api.md.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { listUsers, typeForRole } from '@/lib/adminUsers'

export async function GET(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'staff')
  if (error) return error
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json(await listUsers({
      q: sp.get('q') || '',
      type: typeForRole(admin!.role) || sp.get('type') || 'all',   // an investors / partners admin sees only their side
      status: sp.get('status') || 'all',
      page: Number(sp.get('page') || 1),
      limit: Number(sp.get('limit') || 50),
      sort: sp.get('sort') || 'recent',
      scope: sp.get('scope') || 'all',   // 'current': without closed and test investor logins
    }))
  } catch (e) {
    console.error('[admin/bo/users]', e)
    return NextResponse.json({ error: 'Could not load users' }, { status: 500 })
  }
}
