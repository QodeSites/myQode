// app/api/auth/forgot/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'

// Optional: use Resend if you already have it
import { Resend } from 'resend'
const resendKey = process.env.RESEND_API_KEY
const resend = resendKey ? new Resend(resendKey) : null

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000' // e.g. https://myqode.qodeinvest.com
const TOKEN_TTL_MIN = 60 // token valid for 60 minutes

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Check if user exists (don’t reveal result to client)
    const userRes = await query(
      'SELECT email FROM pms_clients_master WHERE email = $1 LIMIT 1',
      [email]
    )

    // Always behave the same regardless of existence
    // But only create a token if user exists
    if (userRes.rows.length > 0) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000)

      // Optionally invalidate previous tokens for this email
      await query(
        `UPDATE password_reset_tokens
           SET used = TRUE
         WHERE email = $1 AND used = FALSE`,
        [email]
      )

      await query(
        `INSERT INTO password_reset_tokens (email, token_hash, expires_at, used)
         VALUES ($1, $2, $3, FALSE)`,
        [email, tokenHash, expiresAt.toISOString()]
      )

      const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`

      // Send email (Resend) or log in dev
      try {
        if (resend) {
          await resend.emails.send({
            from: 'Support <support@qodeinvest.com>',
            to: email,
            subject: 'Reset your password',
            html: `
              <p>We received a request to reset your password.</p>
              <p><a href="${resetUrl}">Click here</a> to reset your password. This link expires in ${TOKEN_TTL_MIN} minutes.</p>
              <p>If you did not request this, you can ignore this email.</p>
            `,
          })
        } else {
          // Dev fallback so you can test without an email provider
          console.log('[DEV] Password reset URL:', resetUrl)
        }
      } catch (mailErr) {
        // Don’t leak errors to the user
        console.error('Failed to send password reset email:', mailErr)
      }
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
