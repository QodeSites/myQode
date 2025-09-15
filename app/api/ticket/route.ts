import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db1'; // Assuming you have a query function for database access

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') ?? '100');
    const offset = Number(searchParams.get('offset') ?? '0');

    // Validate and sanitize parameters
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
      return NextResponse.json(
        { error: 'Invalid limit parameter. Must be a number between 1 and 1000.' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(offset) || offset < 0) {
      return NextResponse.json(
        { error: 'Invalid offset parameter. Must be a non-negative number.' },
        { status: 400 }
      );
    }

    // Ensure safe integer values
    const safeLimit = Math.floor(limit);
    const safeOffset = Math.floor(offset);

    // Query the database
    const rows = await query(
      `
      SELECT *
      FROM pms_clients_tracker.qode_microsite_inquiries
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [safeLimit, safeOffset]
    );

    // Optional: Get total count for pagination
    const countResult = await query(
      `
      SELECT COUNT(*) as total
      FROM pms_clients_tracker.qode_microsite_inquiries
      `
    );
    const totalCount = Number(countResult[0]?.total) || 0;

    return NextResponse.json(
      {
        results: rows,
        count: rows.length,
        total: totalCount,
        limit: safeLimit,
        offset: safeOffset,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('GET /ticket error:', {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });

    return NextResponse.json(
      {
        error: 'Failed to fetch website tickets',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      },
      { status: 500 }
    );
  }
}