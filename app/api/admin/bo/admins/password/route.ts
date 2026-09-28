// POST /api/admin/bo/admins/password { email, password } (super): sets a backoffice admin's password.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit, isBackofficeAdmin, setAdminPassword } from '@/lib/adminAuth'
import { normEmail, passwordError, readJson } from '@/lib/adminUsers'

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (!isBackofficeAdmin(email)) return NextResponse.json({ error: 'This email is not a backoffice admin', code: 'NOT_ADMIN' }, { status: 400 })
  const bad = passwordError(body.password)
  if (bad) return NextResponse.json({ error: bad, code: 'WEAK_PASSWORD' }, { status: 400 })
  try {
    await setAdminPassword(email, body.password)
    await audit(req, admin!, 'admin.set_password', email)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/bo/admins/password]', e)
    return NextResponse.json({ error: 'Could not set the password' }, { status: 500 })
  }
}
