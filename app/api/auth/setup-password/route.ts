// app/api/auth/setup-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Resend } from 'resend';

// Generate password setup link
export async function POST(request: NextRequest) {
  try {
    const { clientcode } = await request.json();

    if (!clientcode) {
      return NextResponse.json(
        { error: 'Client code is required' },
        { status: 400 }
      );
    }

    // Find client by clientcode
    const result = await query(
      'SELECT clientid, clientcode, email, clientname FROM pms_clients_master WHERE clientcode = $1',
      [clientcode]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
    }

    const client = result.rows[0];
    
    if (!client.email) {
      return NextResponse.json(
        { error: 'No email address found for this client' },
        { status: 400 }
      );
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in database
    await query(
      'UPDATE pms_clients_master SET password_setup_token = $1, password_setup_expires = $2 WHERE clientcode = $3',
      [token, expires, clientcode]
    );

    // Send setup email
    const setupLink = `${process.env.NEXTAUTH_URL}/auth/setup-password?token=${token}`;
    
    await sendSetupEmail(client.email, client.clientname, setupLink);

    return NextResponse.json({
      success: true,
      message: 'Password setup email sent successfully'
    });

  } catch (error) {
    console.error('Setup password error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}