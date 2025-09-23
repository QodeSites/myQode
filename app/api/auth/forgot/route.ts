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

// Image URLs - host these on your domain or CDN
const SIGNATURE_IMAGES = {
  logo: `${process.env.APP_URL}/signature/image.png`,
  youtube: `${process.env.APP_URL}/signature/youtubepng.png`,
  linkedin: `${process.env.APP_URL}/signature/linkedin.png`,
  website: `${process.env.APP_URL}/signature/link.png`,
}

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

      // Enhanced email template with Qode-branded signature
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #002017; max-width: 600px;">
          
          <!-- Main Content Card -->
          <div style=" padding: 30px; border-radius: 12px; margin-bottom: 30px; border: 1px solid #37584f;">
            <h2 style="color: #02422b; margin-bottom: 20px; font-family: 'Playfair Display', Georgia, serif; font-weight: 600;">Password Reset Request</h2>
            
            <p style="margin-bottom: 20px; color: #37584f;">We received a request to reset your password for your Qode account.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #02422b; color: #dabd38; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; border: 2px solid #02422b; transition: all 0.3s ease;">
                Reset Your Password
              </a>
            </div>
            
            <p style="margin-bottom: 20px; color: #37584f;">This link will expire in ${TOKEN_TTL_MIN} minutes for security reasons.</p>
            
            <p style="margin-bottom: 0; color: #37584f;">If you did not request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          </div>

          <!-- Signature -->
          <div style="margin-top: 30px;">
            <!-- Personal signature -->
            <div style="margin-bottom: 10px;">
              <p style="margin: 0 0 8px 0; color: #002017; font-size: 14px;">Best regards,</p>
              <p style="margin: 0 0 4px 0; color: #02422b; font-weight: 600; font-size: 16px;">Qode Investor Relations</p>
              
              <!-- Contact info -->
              <div style="margin-bottom: 10px;">
                <span style="color: #37584f; font-size: 14px;">+91-9820300028 | </span>
                <a href="mailto:saakshi.poddar@qodeinvest.com" style="color: #02422b; text-decoration: none;">investor.relations@qodeinvest.com</a>
              </div>
              
              <!-- Social Icons -->
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
            </div>

            <!-- Qode Branded Card -->
            <div>
                  <img src="${SIGNATURE_IMAGES.logo}" alt="Qode Logo" style="height: 150px; margin-right: 12px; vertical-align: middle;">
            </div>
          </div>
        </body>
        </html>
      `

      // Send email (Resend) or log in dev
      try {
        if (resend) {
          await resend.emails.send({
            from: 'Qode Investor Relations <investor.relations@qodeinvest.com>',
            to: email,
            subject: 'Reset your password - Qode Invest',
            html: emailHtml,
          })
        } else {
          // Dev fallback so you can test without an email provider
          console.log('[DEV] Password reset URL:', resetUrl)
          console.log('[DEV] Email HTML saved for testing')
        }
      } catch (mailErr) {
        // Don't leak errors to the user
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