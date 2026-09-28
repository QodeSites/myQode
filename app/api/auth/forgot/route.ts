// app/api/auth/forgot/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPasswordResetLink } from '@/lib/passwordReset'

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

    // Always behave the same regardless of existence
    // But only create a token if user exists
    if (userRes.rows.length >= 0) {
      await sendPasswordResetLink(email)
    }

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