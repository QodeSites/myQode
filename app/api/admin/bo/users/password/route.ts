// POST /api/admin/bo/users/password { email, password } (super): sets the user's portal password.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit, canAct, forbidden } from '@/lib/adminAuth'
import { normEmail, passwordError, readJson, setUserPassword, userTypeOf, scopeOfType, typeForRole } from '@/lib/adminUsers'

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super', ['investors', 'partners'])
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  { const t = email ? await userTypeOf(email) : null; if (t && !canAct(admin, scopeOfType(t))) return forbidden() }   // investors admins act on investors, partners admins on partners
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  const bad = passwordError(body.password)
  if (bad) return NextResponse.json({ error: bad, code: 'WEAK_PASSWORD' }, { status: 400 })
  try {
    const rows = await setUserPassword(email, body.password)
    if (!rows) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    await audit(req, admin!, 'user.set_password', email, { rows })
    return NextResponse.json({ ok: true, rows })
  } catch (e) {
    console.error('[admin/bo/users/password]', e)
    return NextResponse.json({ error: 'Could not set the password' }, { status: 500 })
  }
}
