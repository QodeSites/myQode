// app/api/admin/onboarding-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const result = await query(
      `SELECT 
        clientid, 
        clientcode, 
        clientname, 
        email, 
        onboarding_status,
        password_set_at,
        first_login_at,
        created_at
      FROM pms_clients_master 
      WHERE email IS NOT NULL 
      ORDER BY created_at DESC`
    );

    return NextResponse.json({
      success: true,
      clients: result.rows
    });

  } catch (error) {
    console.error('Onboarding status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

