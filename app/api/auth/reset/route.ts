// app/api/auth/reset/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json()

    if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'Token and newPassword are required' }, { status: 400 })
    }

    // Password validation (matching your login mechanism)
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

    // Find a valid token
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

    // Hash password with bcrypt (matching your login mechanism - 12 salt rounds)
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Update user password
    const upd = await query(
      `UPDATE pms_clients_master
          SET password = $1
        WHERE email = $2`,
      [hashedPassword, email]
    )

    if ((upd as any).rowCount === 0) {
      // No user? Mark token used anyway to avoid token reuse
      await query(
        `UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1`,
        [tokenHash]
      )
      return NextResponse.json({ error: 'No user found for token' }, { status: 400 })
    }

    // Invalidate this token
    await query(
      `UPDATE password_reset_tokens
          SET used = TRUE
        WHERE token_hash = $1`,
      [tokenHash]
    )

    // Invalidate all other outstanding tokens for this email
    await query(
      `UPDATE password_reset_tokens
          SET used = TRUE
        WHERE email = $1 AND used = FALSE`,
      [email]
    )

    return NextResponse.json({ success: true, message: 'Password has been reset successfully' })
  } catch (err) {
    console.error('Reset password error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}