import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db1';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const client = await pool.connect();

  try {
    // Parse request body
    const requestBody = await request.json();
    const {
      to,
      subject,
      html,
      from,
      fromName,
      inquiry_type,
      nuvama_code,
      client_id,
      user_email,
      priority = 'normal',
      ...inquirySpecificData // All other fields go into the JSON data column
    } = requestBody;

    console.log('Received inquiry request:', {
      to,
      subject,
      inquiry_type,
      nuvama_code,
      client_id,
      user_email,
      priority,
      inquirySpecificData
    });

    // Validate required fields
    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required email fields: to, subject, html' },
        { status: 400 }
      );
    }

    // If inquiry data is provided, validate it
    if (inquiry_type) {
      if (!nuvama_code || !user_email) {
        return NextResponse.json(
          { error: 'Missing required inquiry fields: nuvama_code, user_email' },
          { status: 400 }
        );
      }

      // Validate inquiry_type
      const validInquiryTypes = ['strategy', 'discussion', 'switch', 'withdrawal', 'feedback', 'testimonial'];
      if (!validInquiryTypes.includes(inquiry_type)) {
        return NextResponse.json(
          { error: `Invalid inquiry_type. Must be one of: ${validInquiryTypes.join(', ')}` },
          { status: 400 }
        );
      }
    }

    let inquiryId = null;

    // Only insert into database if inquiry_type is provided
    if (inquiry_type) {
      // Start a transaction
      await client.query('BEGIN');

      // Insert inquiry into the database
      const insertQuery = `
        INSERT INTO pms_clients_tracker.qode_microsite_inquiries (
          type, nuvama_code, client_id, user_email, subject, status, priority, data, 
          email_to, email_from, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING id
      `;
      const values = [
        inquiry_type,
        nuvama_code,
        client_id || null,
        user_email,
        subject,
        'pending', // Default status
        priority,
        JSON.stringify(inquirySpecificData), // Store inquiry-specific fields as JSON
        to,
        from || 'onboarding@resend.dev',
      ];

      const { rows } = await client.query(insertQuery, values);
      inquiryId = rows[0].id;
    }

    // Send email using Resend
    const emailData = await resend.emails.send({
      from: fromName ? `${fromName} <${from || 'onboarding@resend.dev'}>` : (from || 'onboarding@resend.dev'),
      to: [to],
      subject,
      html,
    });

    // Update email_sent status if inquiry was created
    if (inquiryId) {
      await client.query(
        'UPDATE pms_clients_tracker.qode_microsite_inquiries SET email_sent = TRUE WHERE id = $1',
        [inquiryId]
      );

      // Commit transaction
      await client.query('COMMIT');
    }

    return NextResponse.json({ 
      success: true, 
      inquiry_id: inquiryId, 
      emailData: {
        id: emailData.data?.id,
        status: 'sent'
      }
    });
  } catch (error) {
    // Rollback transaction on error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError);
    }
    
    console.error('Error processing inquiry:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process inquiry', 
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// GET endpoint for analytics
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const nuvamaCode = searchParams.get('nuvama_code');
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const limit = parseInt(searchParams.get('limit') || '100');

  const client = await pool.connect();

  try {
    let query = `
      SELECT id, type, nuvama_code, client_id, user_email, subject, status, 
             priority, data, email_sent, created_at, updated_at, resolved_at
      FROM pms_clients_tracker.qode_microsite_inquiries
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Add filters
    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (nuvamaCode) {
      query += ` AND nuvama_code = $${paramIndex}`;
      params.push(nuvamaCode);
      paramIndex++;
    }
    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const { rows } = await client.query(query, params);

    return NextResponse.json({ 
      success: true, 
      inquiries: rows,
      count: rows.length 
    });
  } catch (error) {
    console.error('Database query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inquiries' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}