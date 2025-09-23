// app/api/auth/complete-password-setup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';

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
    let currentPasswordValid = false;
    if (client.password === 'Qode@123') {
      currentPasswordValid = currentPassword === 'Qode@123';
    } else {
      currentPasswordValid = await bcrypt.compare(currentPassword, client.password);
    }

    if (!currentPasswordValid) {
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
