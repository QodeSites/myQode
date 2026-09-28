// POST /api/admin/bo/users/unlock { email } (super): clears failed attempts and the lockout.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { normEmail, readJson, unlockUser } from '@/lib/adminUsers'

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  try {
    const rows = await unlockUser(email)
    if (!rows) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    await audit(req, admin!, 'user.unlock', email, { rows })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/bo/users/unlock]', e)
    return NextResponse.json({ error: 'Could not unlock this user' }, { status: 500 })
  }
}
