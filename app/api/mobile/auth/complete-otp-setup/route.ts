// POST /api/mobile/auth/complete-otp-setup
// Completes password setup after OTP verification: validates strength, hashes the
// password, and clears the OTP for all accounts sharing the email.
// Mirrors the web /api/auth/complete-otp-setup route under the mobile API namespace.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const rawEmail: string | undefined = body?.email;
    const otp: string | undefined = body?.otp;
    const newPassword: string | undefined = body?.newPassword;
    const confirmPassword: string | undefined = body?.confirmPassword;

    if (!rawEmail || !otp || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }

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

    if (newPassword === 'Qode@123') {
      return NextResponse.json(
        { error: 'Please choose a different password than the default one' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();

    // Re-verify OTP before committing the new password
    const otpResult = await query(
      `SELECT clientid, clientcode, email
       FROM pms_clients_master
       WHERE LOWER(email) = $1
       AND password_setup_token = $2
       AND password_setup_expires > NOW()
       LIMIT 1`,
      [email, String(otp).trim()]
    );

    if (otpResult.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
    }

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
       WHERE LOWER(email) = $2`,
      [hashedPassword, email]
    );

    return NextResponse.json({
      success: true,
      message: 'Password setup completed successfully',
      accountsUpdated: updateResult.rowCount,
    });
  } catch (error) {
    console.error('Mobile complete OTP setup error:', error);
    return NextResponse.json({ error: 'Password setup failed' }, { status: 500 });
  }
}
