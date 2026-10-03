// app/api/auth/complete-password-setup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { logAuthEvent } from '@/lib/authEvents';

export async function POST(request: NextRequest) {
  try {
    const { identifier, currentPassword, newPassword, confirmPassword } = await request.json();

    if (!identifier || !currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'New passwords do not match' },
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

    // Find client by email
    const result = await query(
      `SELECT clientid, clientcode, password, onboarding_status
       FROM pms_clients_master 
       WHERE email = $1
       LIMIT 1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Email address not found' },
        { status: 404 }
      );
    }

    const client = result.rows[0];

    // Verify current password again
    // An account still on the shared default password (or none) must set its password through the emailed
    // code (login → verify-setup-otp). Accepting the default here let anyone who knew a client's email take the
    // account over.
    if (!client.password || client.password === 'Qode@123') {
      void logAuthEvent(request, { email: identifier, event: 'login_failed', reason: 'default_password_setup_refused', platform: 'web' });
      return NextResponse.json(
        { error: 'Please set your password with the code we email you.', code: 'PASSWORD_SETUP_REQUIRED' },
        { status: 403 }
      );
    }
    const currentPasswordValid = await bcrypt.compare(currentPassword, client.password);

    if (!currentPasswordValid) {
      void logAuthEvent(request, { email: identifier, event: 'login_failed', reason: 'wrong_password', platform: 'web', meta: { during: 'password_setup' } });
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    // Prevent setting the same password as current
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
           login_attempts = 0,
           locked_until = NULL,
           first_login_at = COALESCE(first_login_at, NOW())
       WHERE email = $2`,
      [hashedPassword, identifier]
    );

    void logAuthEvent(request, { email: identifier, event: 'password_set', platform: 'web', meta: { accounts: updateResult.rowCount, via: 'current_password' } });
    return NextResponse.json({
      success: true,
      message: 'Password setup completed successfully',
      accountsUpdated: updateResult.rowCount
    });

  } catch (error) {
    console.error('Complete password setup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
