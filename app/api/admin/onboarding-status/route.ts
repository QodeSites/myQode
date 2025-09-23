// app/api/admin/onboarding-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Get all clients from pipeline data with their onboarding status
    const result = await query(
      `SELECT 
        clientid, 
        clientcode, 
        clientname, 
        email, 
        COALESCE(onboarding_status, 'pending') as onboarding_status,
        password_set_at,
        first_login_at,
        created_at,
        updated_at,
        groupname,
        ownername
      FROM pms_clients_master 
      WHERE email IS NOT NULL AND email != ''
      ORDER BY 
        CASE 
          WHEN onboarding_status = 'pending' THEN 1
          WHEN onboarding_status = 'email_sent' THEN 2  
          WHEN onboarding_status = 'completed' THEN 3
          ELSE 4
        END,
        created_at DESC`
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