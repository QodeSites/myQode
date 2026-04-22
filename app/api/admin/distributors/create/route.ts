import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    // Validate required fields
    if (!data.clientname || !data.email) {
      return NextResponse.json({ success: false, error: 'Client Name and Email are required' }, { status: 400 });
    }

    const {
      clientname,
      email,
      salutation = 'Mr',
      firstname = clientname,
      lastname = null,
      intermediaryname = 'QODE ADVISORS LLP INT',
      intermediary_fee_percentage = 50.00
    } = data;

    // Exact requested query to create distributor, but parametrized and dynamic
    const text = `
      INSERT INTO public.pms_clients_master (
          clientname, clienttype, email,
          username, salutation, firstname, lastname,
          created_at, password, head_of_family,
          onboarding_status, login_attempts, login_count,
          intermediaryname, intermediary_fee_percentage
      )
      VALUES (
          $1, 'DISTRIBUTORS', $2,
          $1, $3, $4, $5,
          NOW(), '$2b$12$hoRM6AnYwOC512BoBbXqIen7sA/Ju7clpnb.YN7m.aDxEGCESJyO2', FALSE,
          'pending', 0, 0,
          $6, $7
      ) RETURNING id, clientname, email;
    `;

    const values = [
      clientname,
      email,
      salutation,
      firstname,
      lastname,
      'QODE ADVISORS LLP INT',
      intermediary_fee_percentage
    ];

    const result = await query(text, values);

    return NextResponse.json({
      success: true,
      message: 'Distributor user created successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error creating distributor:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create distributor', details: error.message },
      { status: 500 }
    );
  }
}
