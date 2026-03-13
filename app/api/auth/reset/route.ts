// app/api/auth/reset/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'
import axios, { AxiosError } from 'axios'

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json()

    if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'Token and newPassword are required' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 })
    }

    const hasUppercase = /[A-Z]/.test(newPassword)
    const hasLowercase = /[a-z]/.test(newPassword)
    const hasNumbers = /\d/.test(newPassword)
    const hasSpecialChar = /[!@#$%^&*(),.?\":{}|<>]/.test(newPassword)

    if (!hasUppercase || !hasLowercase || !hasNumbers || !hasSpecialChar) {
      return NextResponse.json(
        { error: 'Password must contain uppercase, lowercase, numbers, and special characters' },
        { status: 400 }
      )
    }

    if (newPassword === 'Qode@123') {
      return NextResponse.json(
        { error: 'Please choose a different password than the default one' },
        { status: 400 }
      )
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const tokRes = await query(
      `SELECT email, expires_at, used
         FROM password_reset_tokens
        WHERE token_hash = $1
        LIMIT 1`,
      [tokenHash]
    )

    if (tokRes.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 })
    }

    const { email, expires_at, used } = tokRes.rows[0] as {
      email: string
      expires_at: string | Date
      used: boolean
    }

    if (used) {
      return NextResponse.json({ error: 'Token already used' }, { status: 400 })
    }

    const isExpired = new Date(expires_at).getTime() < Date.now()
    if (isExpired) {
      return NextResponse.json({ error: 'Token expired' }, { status: 400 })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const resolvedClientId =
      req.headers.get('x-client-id') ||
      req.headers.get('X-Client-Id') ||
      process.env.EXPO_PUBLIC_X_CLIENT_ID ||
      process.env.EXPO_PUBLIC_X_BACKEND_CLIENT_ID ||
      ''

    if (!process.env.API_AUTH_URL || !resolvedClientId) {
      return NextResponse.json({ error: 'Auth service not configured' }, { status: 500 })
    }

    try {
      await axios.post(
        `${process.env.API_AUTH_URL}/auth/set-password/`,
        { email: normalizedEmail, new_password: newPassword },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': resolvedClientId,
          },
        }
      )
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      if (axiosErr.response?.status === 400) {
        return NextResponse.json(
          { error: axiosErr.response?.data?.detail || 'Failed to reset password' },
          { status: 400 }
        )
      }
      console.error('Auth set-password error:', axiosErr.message)
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 502 })
    }

    await query(
      `UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1`,
      [tokenHash]
    )

    await query(
      `UPDATE password_reset_tokens SET used = TRUE WHERE email = $1 AND used = FALSE`,
      [normalizedEmail]
    )

    return NextResponse.json({ success: true, message: 'Password has been reset successfully' })
  } catch (err) {
    console.error('Reset password error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}