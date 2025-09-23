// /api/auth/send-otp/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'

// In-memory OTP storage (in production, use Redis or database)
const otpStorage = new Map<string, { otp: string; expiresAt: number; attempts: number }>()

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email?.trim()) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const emailLower = email.trim().toLowerCase()

    // Check if email exists in database
    const result = await query(
      'SELECT email FROM pms_clients_master WHERE email = $1 LIMIT 1',
      [emailLower]
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      )
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString()
    const expiresAt = Date.now() + (10 * 60 * 1000) // 10 minutes

    // Store OTP (in production, use secure storage)
    otpStorage.set(emailLower, {
      otp,
      expiresAt,
      attempts: 0
    })

    // TODO: Send email with OTP using your email service
    // For now, we'll just log it (remove in production)
    console.log(`OTP for ${emailLower}: ${otp}`)

    // In production, you would send an actual email here
    // Example with nodemailer or your email service:
    /*
    await sendEmail({
      to: emailLower,
      subject: 'Your myQode Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Your Verification Code</h2>
          <p>Use the following code to verify your email:</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
            ${otp}
          </div>
          <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `
    })
    */

    return NextResponse.json({
      success: true,
      message: 'OTP sent to your email'
    })

  } catch (error) {
    console.error('Send OTP error:', error)
    return NextResponse.json(
      { error: 'Failed to send OTP' },
      { status: 500 }
    )
  }
}