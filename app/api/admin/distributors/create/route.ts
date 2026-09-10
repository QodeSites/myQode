import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";

export async function POST(request: NextRequest) {
  // Admin-only. middleware.ts checks the cookie exists but defers
  // validation, so a forged cookie passes it — this validates the session.
  const __admin = await requireAdmin(request);
  if (!isAdminUser(__admin)) return __admin;

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

    // A distributor is identified by email everywhere else in this module —
    // resolveDistributorByEmail() takes the first match with LIMIT 1 — so a
    // second row on the same address would make which one wins arbitrary.
    const existing = await query(
      `SELECT clientname FROM public.pms_clients_master
        WHERE lower(btrim(email)) = lower(btrim($1))
          AND clientcode IS NULL
        LIMIT 1`,
      [email],
    );
    if (existing.rows?.length) {
      return NextResponse.json(
        {
          success: false,
          error: `A distributor with that email already exists (${existing.rows[0].clientname}).`,
        },
        { status: 409 },
      );
    }

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
      // The destructured value, which already defaults to QODE ADVISORS LLP
      // INT. This was the literal, so the form's Intermediary Name field was
      // collected and then silently discarded.
      intermediaryname,
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
