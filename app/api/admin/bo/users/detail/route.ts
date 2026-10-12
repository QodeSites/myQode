// GET /api/admin/bo/users/detail?email= (staff): one user with accounts, logins, app info and audit trail.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, canAct, forbidden } from '@/lib/adminAuth'
import { getUserDetail, normEmail, userTypeOf, scopeOfType, typeForRole } from '@/lib/adminUsers'

export async function GET(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'staff')
  if (error) return error
  const email = normEmail(req.nextUrl.searchParams.get('email'))
  const only = typeForRole(admin!.role)
  if (only && email && (await userTypeOf(email)) !== only) return forbidden()
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  try {
    const detail = await getUserDetail(email)
    if (!detail) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (e) {
    console.error('[admin/bo/users/detail]', e)
    return NextResponse.json({ error: 'Could not load this user' }, { status: 500 })
  }
}
