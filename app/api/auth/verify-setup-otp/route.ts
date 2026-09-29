// app/api/auth/verify-setup-otp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logAuthEvent } from '@/lib/authEvents';

export async function POST(request: NextRequest) {
  try {
    const { email, otp } = await request.json();

    if (!email || !otp) {
      return NextResponse.json(
        { error: 'Email and OTP are required' },
        { status: 400 }
      );
    }

    // Verify OTP
    const result = await query(
      `SELECT clientid, clientcode, email, clientname, password_setup_token, password_setup_expires
       FROM pms_clients_master 
       WHERE email = $1 
       AND password_setup_token = $2 
       AND password_setup_expires > NOW()`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      void logAuthEvent(request, { email, event: 'otp_failed', reason: 'wrong_code', platform: 'web', meta: { flow: 'setup', step: 'verify' } });
      return NextResponse.json(
        { error: 'Invalid or expired OTP' },
        { status: 400 }
      );
    }

    void logAuthEvent(request, { email, event: 'otp_verified', platform: 'web', meta: { flow: 'setup' } });
    return NextResponse.json({
      success: true,
      message: 'OTP verified successfully'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json(
      { error: 'OTP verification failed' },
      { status: 500 }
    );
  }
}