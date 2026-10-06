// POST /api/mobile/auth/verify-setup-otp
// Verifies a password-setup OTP before the user creates a password.
// Mirrors the web /api/auth/verify-setup-otp route under the mobile API namespace.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { otpMiss, isOtpLocked, clearWrongOtp, TOO_MANY_OTP } from '@/lib/mobileOtpAttempts';
import { logAuthEvent, osFrom } from '@/lib/authEvents';

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

    if (!rawEmail || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();
    if (isOtpLocked(email)) return NextResponse.json(TOO_MANY_OTP, { status: 429 });

    const result = await query(
      `SELECT clientid, clientcode, email, clientname
       FROM pms_clients_master
       WHERE LOWER(email) = $1
       AND password_setup_token = $2
       AND password_setup_expires > NOW()
       LIMIT 1`,
      [email, String(otp).trim()]
    );

    if (result.rows.length === 0) {
      const miss = await otpMiss(email);
      void logAuthEvent(request, { email, event: 'otp_failed', reason: miss.body.code === 'OTP_LOCKED' ? 'too_many' : miss.body.code === 'OTP_EXPIRED' ? 'expired' : 'wrong_code', platform: 'app', os: osFrom(body), meta: { flow: 'setup', step: 'verify' } });
      return NextResponse.json(miss.body, { status: miss.status });
    }
    void logAuthEvent(request, { email, event: 'otp_verified', platform: 'app', os: osFrom(body), meta: { flow: 'setup' } });

    return NextResponse.json({
      success: true,
      message: 'OTP verified successfully',
      clientname: result.rows[0].clientname,
    });
  } catch (error) {
    console.error('Mobile verify setup OTP error:', error);
    return NextResponse.json({ error: 'OTP verification failed' }, { status: 500 });
  }
}
