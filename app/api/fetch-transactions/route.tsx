import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db'; // Adjust path to your db.ts file

interface Transaction {
  id: number;
  order_id: string;
  client_id: string;
  nuvama_code: string;
  client_name: string;
  amount: number;
  currency: string;
  payment_type: 'ONE_TIME' | 'SIP';
  payment_status: string;
  payment_session_id: string | null;
  cf_order_id: string | null;
  cf_subscription_id: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  total_installments: number | null;
  next_charge_date: string | null;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nuvama_code = searchParams.get('nuvama_code');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const sort = searchParams.get('sort')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Validate nuvama_code
    if (!nuvama_code) {
      return NextResponse.json(
        {
          success: false,
          error: 'Nuvama code is required',
          error_code: 'MISSING_NUVAMA_CODE',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid limit. Must be a number between 1 and 100.',
          error_code: 'INVALID_LIMIT',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
    if (isNaN(offset) || offset < 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid offset. Must be a non-negative number.',
          error_code: 'INVALID_OFFSET',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Query transactions by nuvama_code
    const result = await pool.query<Transaction>(
      `SELECT 
        id, order_id, client_id, nuvama_code, client_name, amount, currency, 
        payment_type, payment_status, payment_session_id, cf_order_id, 
        cf_subscription_id, account_number, ifsc_code, frequency, 
        start_date, end_date, total_installments, next_charge_date, 
        created_at, updated_at, canceled_at
      FROM payment_transactions 
      WHERE nuvama_code = $1
      ORDER BY created_at ${sort}
      LIMIT $2 OFFSET $3`,
      [nuvama_code, limit, offset]
    );

    // Mask account_number in response
    const transactions = result.rows.map((tx) => ({
      ...tx,
      account_number: tx.account_number ? `***${tx.account_number.slice(-4)}` : null,
    }));

    // Group transactions by type for better response structure
    const oneTimeTransactions = transactions.filter((tx) => tx.payment_type === 'ONE_TIME');
    const sipTransactions = transactions.filter((tx) => tx.payment_type === 'SIP');

    return NextResponse.json({
      success: true,
      data: {
        nuvama_code,
        total_count: result.rowCount,
        one_time_transactions: oneTimeTransactions,
        sip_transactions: sipTransactions,
        pagination: {
          limit,
          offset,
          returned_count: transactions.length,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching transactions by nuvama_code:', {
      message: error.message,
      stack: error.stack,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch transactions',
        error_code: 'FETCH_TRANSACTIONS_FAILED',
        message: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}