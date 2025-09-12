// app/api/bank-details/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import pool from '@/lib/db1';

export async function GET(request: NextRequest) {
  const client = await pool.connect();

  try {
    // Check authentication
    const cookieStore = await cookies();
    const authCookie = cookieStore.get('qode-auth');

    if (authCookie?.value !== '1') {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get nuvama_code from query parameters
    const { searchParams } = new URL(request.url);
    const nuvama_code = searchParams.get('nuvama_code');

    if (!nuvama_code) {
      return NextResponse.json(
        { error: 'nuvama_code is required' },
        { status: 400 }
      );
    }

    // Query the database for bank details
    const result = await client.query(
      'SELECT * FROM pms_clients_tracker.pms_clients_bank_details WHERE nuvama_code = $1',
      [nuvama_code]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'No bank details found for the provided nuvama_code' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      bankDetails: result.rows,
    });
  } catch (error) {
    console.error('Error fetching bank details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bank details' },
      { status: 500 }
    );
  } finally {
    client.release(); // Release the database client
  }
}