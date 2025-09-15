// app/api/auth/reset/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'

// TODO (recommended): switch to bcrypt
// import bcrypt from 'bcrypt'

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json()

    if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'Token and newPassword are required' }, { status: 400 })
    }

    // Basic password sanity checks (adjust to your policy)
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
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

    // ===== IMPORTANT =====
    // Your current login SQL compares plaintext passwords. To stay compatible, we’ll store plaintext here.
    // CHANGE THIS to bcrypt hash as soon as you update the login logic.
    const passwordToStore = newPassword

    // // Recommended (after you migrate login to bcrypt):
    // const saltRounds = 12
    // const passwordToStore = await bcrypt.hash(newPassword, saltRounds)

    // Update user password
    const upd = await query(
      `UPDATE pms_clients_master
          SET password = $1
        WHERE email = $2`,
      [passwordToStore, email]
    )

    if ((upd as any).rowCount === 0) {
      // No user? Mark token used anyway to avoid token reuse
      await query(
        `UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1`,
        [tokenHash]
      )
      return NextResponse.json({ error: 'No user found for token' }, { status: 400 })
    }

    // Invalidate this token (and, optionally, all other active tokens for this email)
    await query(
      `UPDATE password_reset_tokens
          SET used = TRUE
        WHERE token_hash = $1`,
      [tokenHash]
    )

    // Optional: also invalidate any other outstanding tokens for this email
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
