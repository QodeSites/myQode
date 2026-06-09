// POST /api/mobile/auth/forgot
// Sends a password-reset email to the given address.
// Mirrors the web /api/auth/forgot route but lives under the mobile API namespace.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'
import { graphMailer, isGraphEmailConfigured } from '@/lib/graphEmail'

const resend = isGraphEmailConfigured() ? graphMailer : null

const APP_URL = process.env.APP_URL ?? 'https://myqode.qodeinvest.com'
const TOKEN_TTL_MIN = 60

const SIGNATURE_IMAGES = {
  logo: `${APP_URL}/signature/image.png`,
  youtube: `${APP_URL}/signature/youtubepng.png`,
  linkedin: `${APP_URL}/signature/linkedin.png`,
  website: `${APP_URL}/signature/link.png`,
}

export async function POST(req: NextRequest) {
  try {
    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const email: string | undefined = body?.email
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Check if user exists — but don't reveal this to the caller
    const userRes = await query(
      'SELECT email FROM pms_clients_master WHERE LOWER(email) = $1 LIMIT 1',
      [normalizedEmail]
    )

    if (userRes.rows.length > 0) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000)

      // Invalidate previous tokens for this email
      await query(
        `UPDATE password_reset_tokens SET used = TRUE WHERE LOWER(email) = $1 AND used = FALSE`,
        [normalizedEmail]
      )

      await query(
        `INSERT INTO password_reset_tokens (email, token_hash, expires_at, used)
         VALUES ($1, $2, $3, FALSE)`,
        [userRes.rows[0].email, tokenHash, expiresAt.toISOString()]
      )

      const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #002017; max-width: 600px;">
          <div style="padding: 30px; border-radius: 12px; margin-bottom: 30px; border: 1px solid #37584f;">
            <h2 style="color: #02422b; margin-bottom: 20px; font-family: 'Playfair Display', Georgia, serif; font-weight: 600;">Password Reset Request</h2>
            <p style="margin-bottom: 20px; color: #37584f;">We received a request to reset your password for your Qode account.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}"
                 style="background-color: #02422b; color: #dabd38; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; border: 2px solid #02422b;">
                Reset Your Password
              </a>
            </div>
            <p style="margin-bottom: 20px; color: #37584f;">This link will expire in ${TOKEN_TTL_MIN} minutes for security reasons.</p>
            <p style="margin-bottom: 0; color: #37584f;">If you did not request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          </div>
          <div style="margin-top: 30px;">
            <p style="margin: 0 0 8px 0; color: #002017; font-size: 14px;">Best regards,</p>
            <p style="margin: 0 0 4px 0; color: #02422b; font-weight: 600; font-size: 16px;">Qode Investor Relations</p>
            <div style="margin-bottom: 10px;">
              <span style="color: #37584f; font-size: 14px;">+91-9820300028 | </span>
              <a href="mailto:investor.relations@qodeinvest.com" style="color: #02422b; text-decoration: none;">investor.relations@qodeinvest.com</a>
            </div>
            <div style="margin-bottom: 10px;">
              <a href="https://qodeinvest.com" style="text-decoration: none; margin-right: 12px; display: inline-block;">
                <img src="${SIGNATURE_IMAGES.website}" alt="Website" style="width: 24px; height: 24px; vertical-align: middle;">
              </a>
              <a href="https://www.youtube.com/@qodeinvest" style="text-decoration: none; margin-right: 12px; display: inline-block;">
                <img src="${SIGNATURE_IMAGES.youtube}" alt="YouTube" style="width: 24px; height: 24px; vertical-align: middle;">
              </a>
              <a href="https://www.linkedin.com/company/qode-invest" style="text-decoration: none; display: inline-block;">
                <img src="${SIGNATURE_IMAGES.linkedin}" alt="LinkedIn" style="width: 24px; height: 24px; vertical-align: middle;">
              </a>
            </div>
            <div>
              <img src="${SIGNATURE_IMAGES.logo}" alt="Qode Logo" style="height: 150px; margin-right: 12px; vertical-align: middle;">
            </div>
          </div>
        </body>
        </html>
      `

      try {
        if (resend) {
          await resend.emails.send({
            from: 'Qode Investor Relations <investor.relations@qodeinvest.com>',
            to: userRes.rows[0].email,
            subject: 'Reset your password – myQode',
            html: emailHtml,
          })
        } else {
          console.log('[DEV] Password reset URL:', resetUrl)
        }
      } catch (mailErr) {
        console.error('Failed to send password reset email:', mailErr)
      }
    }

    // Always return a generic response — don't reveal whether the email exists
    return NextResponse.json({
      success: true,
      message: 'If that email exists, a reset link has been sent.',
    })
  } catch (err) {
    console.error('Mobile forgot password error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
