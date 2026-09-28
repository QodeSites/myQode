// POST /api/admin/bo/users/reset-link { email } (super): emails the standard password reset link.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { normEmail, readJson, storedEmail } from '@/lib/adminUsers'
import { sendPasswordResetLink } from '@/lib/passwordReset'

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  try {
    const stored = await storedEmail(email)
    if (!stored) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const sent = await sendPasswordResetLink(stored)
    await audit(req, admin!, 'user.reset_link', email, { sent })
    if (!sent) return NextResponse.json({ error: 'The reset email could not be sent. Please try again.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/bo/users/reset-link]', e)
    return NextResponse.json({ error: 'Could not send the reset link' }, { status: 500 })
  }
}
