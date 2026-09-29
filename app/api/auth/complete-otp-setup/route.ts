// app/api/auth/complete-otp-setup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { logAuthEvent } from '@/lib/authEvents';

export async function POST(request: NextRequest) {
  try {
    const { email, otp, newPassword, confirmPassword } = await request.json();

    if (!email || !otp || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumbers = /\d/.test(newPassword);
    const hasSpecialChar = /[!@#$%^&*(),.?\":{}|<>]/.test(newPassword);

    if (!hasUppercase || !hasLowercase || !hasNumbers || !hasSpecialChar) {
      return NextResponse.json(
        { error: 'Password must contain uppercase, lowercase, numbers, and special characters' },
        { status: 400 }
      );
    }

    // Verify OTP one more time
    const otpResult = await query(
      `SELECT clientid, clientcode, email
       FROM pms_clients_master 
       WHERE email = $1 
       AND password_setup_token = $2 
       AND password_setup_expires > NOW()`,
      [email, otp]
    );

    if (otpResult.rows.length === 0) {
      void logAuthEvent(request, { email, event: 'otp_failed', reason: 'wrong_code', platform: 'web', meta: { flow: 'setup', step: 'complete' } });
      return NextResponse.json(
        { error: 'Invalid or expired OTP' },
        { status: 400 }
      );
    }

    // Prevent using default password
    if (newPassword === 'Qode@123') {
      return NextResponse.json(
        { error: 'Please choose a different password than the default one' },
        { status: 400 }
      );
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password for ALL accounts with this email address
    const updateResult = await query(
      `UPDATE pms_clients_master 
       SET password = $1, 
           password_set_at = NOW(),
           onboarding_status = 'completed',
           password_setup_token = NULL,
           password_setup_expires = NULL,
           login_attempts = 0,
           locked_until = NULL,
           first_login_at = COALESCE(first_login_at, NOW())
       WHERE email = $2`,
      [hashedPassword, email]
    );

    void logAuthEvent(request, { email, event: 'password_set', platform: 'web', meta: { accounts: updateResult.rowCount, via: 'otp' } });
    return NextResponse.json({
      success: true,
      message: 'Password setup completed successfully',
      accountsUpdated: updateResult.rowCount
    });

  } catch (error) {
    console.error('Complete OTP setup error:', error);
    return NextResponse.json(
      { error: 'Password setup failed' },
      { status: 500 }
    );
  }
}