// app/api/auth/check-password-status/route.ts
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
        { error: 'Email address not found' },
        { status: 404 }
      );
    }

    const client = result.rows[0];

    // Check if account is locked
    if (client.locked_until && new Date(client.locked_until) > new Date()) {
      const lockTime = Math.ceil((new Date(client.locked_until).getTime() - Date.now()) / (1000 * 60));
      return NextResponse.json(
        { 
          error: `Account locked. Try again in ${lockTime} minutes.`,
          locked: true,
          lockTime 
        },
        { status: 423 }
      );
    }

    // Determine if password is set up
    const isPasswordSet = client.password !== 'Qode@123' && client.onboarding_status === 'completed';

    return NextResponse.json({
      success: true,
      isPasswordSet,
      clientName: client.clientname,
      requiresSetup: !isPasswordSet,
      onboardingStatus: client.onboarding_status
    });

  } catch (error) {
    console.error('Check password status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}