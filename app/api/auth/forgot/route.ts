// app/api/auth/forgot/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPasswordResetLink, allowResetMail } from '@/lib/passwordReset'
import { logAuthEvent } from '@/lib/authEvents'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Check if user exists (don't reveal result to client)
    const userRes = await query(
      'SELECT email FROM pms_clients_master WHERE email = $1 LIMIT 1',
      [email]
    )

    // Always behave the same regardless of existence, but only create a token and send mail for a real account,
    // at most once a minute and 5 times an hour per email, shared with the app (the reply never says which).
    if (userRes.rows.length > 0 && allowResetMail(email)) {
      await sendPasswordResetLink(userRes.rows[0].email)
    }

    // Analytics only: the caller still gets the same generic answer either way.
    void logAuthEvent(req, { email: userRes.rows.length ? email : null, event: 'password_reset_requested', platform: 'web', meta: { known: userRes.rows.length > 0 } })

    // Always return generic response
    return NextResponse.json({
      success: true,
      message: 'If that email exists, a reset link has been sent.'
    })
  } catch (err) {
    console.error('Forgot password error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}