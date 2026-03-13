// app/api/auth/complete-otp-setup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import axios, { AxiosError } from 'axios';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawEmail = body.email;
    const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
    const newPassword = body.newPassword;
    const confirmPassword = body.confirmPassword;

    if (!rawEmail || !otp || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }
    const email = String(rawEmail).trim().toLowerCase();

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      );
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

    const otpResult = await query(
      `SELECT clientid, clientcode, email
       FROM pms_clients_master 
       WHERE LOWER(TRIM(email)) = $1 
       AND password_setup_token = $2 
       AND password_setup_expires > NOW()`,
      [email, otp]
    );

    if (otpResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired OTP' },
        { status: 400 }
      );
    }

    if (newPassword === 'Qode@123') {
      return NextResponse.json(
        { error: 'Please choose a different password than the default one' },
        { status: 400 }
      );
    }

    const resolvedClientId =
      request.headers.get('x-client-id') ||
      request.headers.get('X-Client-Id') ||
      process.env.NEXT_PUBLIC_X_CLIENT_ID ||
      process.env.EXPO_PUBLIC_X_BACKEND_CLIENT_ID ||
      '';

    if (!process.env.API_AUTH_URL || !resolvedClientId) {
      return NextResponse.json(
        { error: 'Auth service not configured' },
        { status: 500 }
      );
    }

    try {
      await axios.post(
        `${process.env.API_AUTH_URL}/auth/set-password/`,
        { email, new_password: newPassword },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': resolvedClientId,
          },
        }
      );
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      const detail = axiosErr.response?.data?.detail;
      const status = axiosErr.response?.status;
      if (status === 400) {
        return NextResponse.json(
          { error: detail || 'Failed to set password' },
          { status: 400 }
        );
      }
      console.error('Auth set-password error:', axiosErr.message);
      return NextResponse.json(
        { error: 'Failed to set password' },
        { status: 502 }
      );
    }

    await query(
      `UPDATE pms_clients_master 
       SET password_set_at = NOW(),
           onboarding_status = 'completed',
           password_setup_token = NULL,
           password_setup_expires = NULL,
           login_attempts = 0,
           locked_until = NULL,
           first_login_at = COALESCE(first_login_at, NOW())
       WHERE LOWER(TRIM(email)) = $1`,
      [email]
    );

    return NextResponse.json({
      success: true,
      message: 'Password setup completed successfully',
    });
  } catch (error) {
    console.error('Complete OTP setup error:', error);
    return NextResponse.json(
      { error: 'Password setup failed' },
      { status: 500 }
    );
  }
}