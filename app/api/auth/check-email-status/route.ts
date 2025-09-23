// app/api/auth/check-email-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }

    // Find client by email
    const result = await query(
      `SELECT clientid, clientcode, email, clientname, password, onboarding_status, 
              login_attempts, locked_until
       FROM pms_clients_master 
       WHERE email = $1 
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Email address not found. Please contact support if you believe this is an error.' },
        { status: 404 }
      );
    }

    const client = result.rows[0];

    // Check if account is locked
    if (client.locked_until && new Date(client.locked_until) > new Date()) {
      const lockTime = Math.ceil((new Date(client.locked_until).getTime() - Date.now()) / (1000 * 60));
      return NextResponse.json(
        { error: `Account is temporarily locked. Please try again in ${lockTime} minutes.` },
        { status: 423 }
      );
    }

    // Check if user has set up password
    const hasPassword = client.password !== 'Qode@123' && client.onboarding_status === 'completed';

    return NextResponse.json({
      success: true,
      hasPassword,
      clientname: client.clientname,
      onboarding_status: client.onboarding_status,
      message: hasPassword 
        ? 'Please enter your password to continue' 
        : 'Please set up your secure password to continue'
    });

  } catch (error) {
    console.error('Check email status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}