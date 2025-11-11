// app/api/admin/queries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import pool from '@/lib/db1';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface QueryMessage {
  id: string;
  type: string;
  nuvama_code: string;
  client_id: string;
  user_email: string;
  subject: string;
  status: string;
  priority: string;
  data: any;
  email_sent: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  assigned_to: string | null;
  last_updated_by: string | null;
  parent_inquiry_id: string | null;
  thread_id: string;
  is_client_message: boolean;
  client_name?: string;
  owner_name?: string;
}

interface QueryNote {
  id: number;
  inquiry_id: string;
  admin_email: string;
  note_type: string;
  content: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface QueryStatistics {
  totalQueries: number;
  pendingQueries: number;
  resolvedQueries: number;
  todayQueries: number;
  thisWeekQueries: number;
  highPriorityQueries: number;
  queriesByType: Record<string, number>;
  avgResolutionTime: string;
}

// Helper function to send email notification
async function sendQueryEmail(query: QueryMessage, action: 'resolved' | 'updated', note?: string) {
  try {
    console.log(`Sending ${action} email for query ${query.id} to ${query.user_email}`);

    const emailSubject = action === 'resolved'
      ? `Query Resolved: ${query.subject}`
      : `Query Updated: ${query.subject}`;

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #1a73e8; margin: 0;">Query ${action === 'resolved' ? 'Resolved' : 'Updated'}</h2>
        </div>
        
        <div style="background: white; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <p><strong>Query ID:</strong> ${query.id}</p>
          <p><strong>Subject:</strong> ${query.subject}</p>
          <p><strong>Client Code:</strong> ${query.nuvama_code}</p>
          <p><strong>Status:</strong> ${query.status}</p>
          
          ${note ? `
            <div style="background: #f1f3f4; padding: 15px; border-radius: 5px; margin-top: 15px;">
              <p style="margin: 0;"><strong>${action === 'resolved' ? 'Resolution' : 'Update'} Note:</strong></p>
              <p style="margin: 10px 0 0 0;">${note.replace(/\n/g, '<br>')}</p>
            </div>
          ` : ''}
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; font-size: 12px; color: #5f6368;">
          <p style="margin: 0;">This is an automated message from the Query Management System.</p>
          <p style="margin: 5px 0 0 0;">If you have further questions, please contact your relationship manager.</p>
        </div>
      </div>
    `;

    const emailResult = await resend.emails.send({
      from: `Query Management System <investor.relations@qodeinvest.com>`,
      to: [query.user_email],
      subject: emailSubject,
      html: emailBody,
    });

    if (emailResult.error) {
      console.error('Email send failed:', emailResult.error);
      return false;
    }

    console.log('Email sent successfully:', emailResult);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const client = await pool.connect();

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const queryId = searchParams.get('queryId');

    // Get query notes
    if (action === 'getNotes' && queryId) {
      const notesResult = await client.query(
        `SELECT * FROM pms_clients_tracker.qode_inquiry_notes 
         WHERE inquiry_id = $1 
         ORDER BY created_at DESC`,
        [queryId]
      );

      return NextResponse.json({
        success: true,
        data: { notes: notesResult.rows },
      });
    }

    // Get all queries as individual threads
    const queriesQuery = `
      SELECT 
        q.*
      FROM pms_clients_tracker.qode_microsite_inquiries q
      ORDER BY 
        CASE WHEN q.status = 'pending' THEN 0 ELSE 1 END,
        q.created_at DESC
    `;

    const queriesResult = await client.query(queriesQuery);
    const queries: QueryMessage[] = queriesResult.rows;

    // Get unique client codes
    const clientCodes = [...new Set(queries.map(q => q.nuvama_code))];
    let clientMap = new Map<string, any>();

    if (clientCodes.length > 0) {
      try {
        const placeholders = clientCodes.map((_, i) => `$${i + 1}`).join(',');
        const clientsQuery = `
          SELECT 
            clientcode,
            clientname,
            salutation,
            firstname,
            middlename,
            lastname,
            email
          FROM pms_clients_master
          WHERE clientcode IN (${placeholders})
        `;
        const clientsResult = await query(clientsQuery, clientCodes);

        clientsResult.rows.forEach((c: any) => {
          const fullName = c.clientname ||
            `${c.salutation || ''} ${c.firstname} ${c.middlename || ''} ${c.lastname}`.trim() ||
            'Unknown';
          clientMap.set(c.clientcode, { name: fullName, email: c.email });
        });
      } catch (error) {
        console.error('Error fetching client data:', error);
      }
    }

    // Enrich queries with client information
    const enrichedQueries = queries.map(q => ({
      ...q,
      client_name: clientMap.get(q.nuvama_code)?.name || 'Unknown Client',
      owner_name: clientMap.get(q.nuvama_code)?.name || null,
    }));

    // Calculate statistics
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const statistics: QueryStatistics = {
      totalQueries: enrichedQueries.length,
      pendingQueries: enrichedQueries.filter(q => q.status === 'pending').length,
      resolvedQueries: enrichedQueries.filter(q => q.status === 'resolved').length,
      todayQueries: enrichedQueries.filter(q => new Date(q.created_at) >= today).length,
      thisWeekQueries: enrichedQueries.filter(q => new Date(q.created_at) >= weekAgo).length,
      highPriorityQueries: enrichedQueries.filter(q => q.priority === 'high' && q.status === 'pending').length,
      queriesByType: enrichedQueries.reduce((acc, q) => {
        acc[q.type] = (acc[q.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      avgResolutionTime: calculateAverageResolutionTime(enrichedQueries),
    };

    return NextResponse.json({
      success: true,
      data: {
        queries: enrichedQueries,
        statistics,
      },
    });

  } catch (error) {
    console.error('Admin queries API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queries data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { action, queryId, note, priority, sendEmail, emailData } = body;

    // Get admin email from session or request
    const currentAdminEmail = 'investor.relations@qodeinvest.com';

    switch (action) {
      case 'sendResponse': {
        if (!queryId || !emailData) {
          return NextResponse.json(
            { error: 'Query ID and email data are required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          console.log('📧 Sending response for query:', queryId);

          // Get original query details
          const queryResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE id = $1`,
            [queryId]
          );

          if (queryResult.rows.length === 0) {
            throw new Error('Query not found');
          }

          const originalQuery = queryResult.rows[0];

          // Prepare email HTML
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #1a73e8; margin: 0;">Response to Your Query</h2>
              </div>
              
              <div style="background: white; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <p><strong>Subject:</strong> ${emailData.subject}</p>
                <p><strong>Client Code:</strong> ${originalQuery.nuvama_code}</p>
                
                <div style="margin-top: 20px; padding: 15px; background: #f1f3f4; border-radius: 5px;">
                  ${emailData.message.replace(/\n/g, '<br>')}
                </div>
              </div>
              
              <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; font-size: 12px; color: #5f6368;">
                <p style="margin: 0;">This is a response from the Query Management System.</p>
                <p style="margin: 5px 0 0 0;">If you have further questions, please reply to this email.</p>
              </div>
            </div>
          `;

          // Prepare email payload
          const emailPayload: any = {
            from: `Query Management System <investor.relations@qodeinvest.com>`,
            to: Array.isArray(emailData.to) ? emailData.to : [emailData.to],
            subject: emailData.subject,
            html: emailHtml,
          };

          // Add CC if provided
          if (emailData.cc && Array.isArray(emailData.cc) && emailData.cc.length > 0) {
            emailPayload.cc = emailData.cc;
          }

          const emailResult = await resend.emails.send(emailPayload);

          if (emailResult.error) {
            throw new Error(`Email send failed: ${emailResult.error.message}`);
          }

          // Update query with response info
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET updated_at = NOW(), 
                 last_updated_by = $1,
                 data = jsonb_set(
                   COALESCE(data, '{}'::jsonb),
                   '{admin_responses}',
                   COALESCE(data->'admin_responses', '[]'::jsonb) || $2::jsonb
                 )
             WHERE id = $3`,
            [
              currentAdminEmail,
              JSON.stringify([{
                message: emailData.message,
                cc: emailData.cc || [],
                sent_by: currentAdminEmail,
                sent_at: new Date().toISOString()
              }]),
              queryId
            ]
          );

          // Add note about the response
          const ccInfo = emailData.cc && emailData.cc.length > 0 ? ` (CC: ${emailData.cc.join(', ')})` : '';
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content)
             VALUES ($1, $2, 'note', $3)`,
            [
              queryId,
              currentAdminEmail,
              `Admin response sent to ${emailData.to}${ccInfo}\nSubject: ${emailData.subject}`
            ]
          );

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Response sent successfully',
            email_details: {
              to: emailPayload.to,
              cc: emailPayload.cc || [],
              email_id: emailResult.data?.id
            }
          });
        } catch (error) {
          await client.query('ROLLBACK');
          console.error('❌ Error in sendResponse:', error);
          throw error;
        }
      }

      case 'resolve': {
        if (!queryId || !note) {
          return NextResponse.json(
            { error: 'Query ID and resolution note are required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Get query
          const queryResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE id = $1`,
            [queryId]
          );

          if (queryResult.rows.length === 0) {
            throw new Error('Query not found');
          }

          const queryData = queryResult.rows[0];

          // Update query status to resolved
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET status = 'resolved', 
                 resolved_at = NOW(),
                 updated_at = NOW(),
                 last_updated_by = $1
             WHERE id = $2`,
            [currentAdminEmail, queryId]
          );

          // Add resolution note
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content, old_value, new_value)
             VALUES ($1, $2, 'status_change', $3, 'pending', 'resolved')`,
            [queryId, currentAdminEmail, note]
          );

          // Send email if requested
          if (sendEmail) {
            await sendQueryEmail(queryData, 'resolved', note);
          }

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Query resolved successfully',
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      case 'reopen': {
        if (!queryId) {
          return NextResponse.json(
            { error: 'Query ID is required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Reopen query
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET status = 'pending', 
                 resolved_at = NULL,
                 updated_at = NOW(),
                 last_updated_by = $1
             WHERE id = $2`,
            [currentAdminEmail, queryId]
          );

          // Add note
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content, old_value, new_value)
             VALUES ($1, $2, 'status_change', 'Query reopened', 'resolved', 'pending')`,
            [queryId, currentAdminEmail]
          );

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Query reopened successfully',
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      case 'addNote': {
        if (!queryId || !note) {
          return NextResponse.json(
            { error: 'Query ID and note are required' },
            { status: 400 }
          );
        }

        await client.query(
          `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
           (inquiry_id, admin_email, note_type, content)
           VALUES ($1, $2, 'note', $3)`,
          [queryId, currentAdminEmail, note]
        );

        // Update query updated_at
        await client.query(
          `UPDATE pms_clients_tracker.qode_microsite_inquiries 
           SET updated_at = NOW(), last_updated_by = $1
           WHERE id = $2`,
          [currentAdminEmail, queryId]
        );

        return NextResponse.json({
          success: true,
          message: 'Note added successfully',
        });
      }

      case 'updatePriority': {
        if (!queryId || !priority) {
          return NextResponse.json(
            { error: 'Query ID and priority are required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Get query
          const queryResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE id = $1`,
            [queryId]
          );

          const queryData = queryResult.rows[0];
          const oldPriority = queryData.priority;

          // Update priority
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET priority = $1, updated_at = NOW(), last_updated_by = $2
             WHERE id = $3`,
            [priority, currentAdminEmail, queryId]
          );

          // Add note
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content, old_value, new_value)
             VALUES ($1, $2, 'priority_change', 'Query priority updated', $3, $4)`,
            [queryId, currentAdminEmail, oldPriority, priority]
          );

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Priority updated successfully',
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      case 'delete': {
        if (!queryId) {
          return NextResponse.json(
            { error: 'Query ID is required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Delete all notes associated with this query
          await client.query(
            `DELETE FROM pms_clients_tracker.qode_inquiry_notes 
             WHERE inquiry_id = $1`,
            [queryId]
          );

          // Delete the query
          await client.query(
            `DELETE FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE id = $1`,
            [queryId]
          );

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Query and all associated data deleted successfully',
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Admin queries action error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorDetails = process.env.NODE_ENV === 'development'
      ? (error instanceof Error ? error.stack : undefined)
      : undefined;

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process query action',
        details: errorMessage,
        stack: errorDetails
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// Helper function to calculate average resolution time
function calculateAverageResolutionTime(queries: QueryMessage[]): string {
  const resolvedQueries = queries.filter(q => q.resolved_at && q.status === 'resolved');

  if (resolvedQueries.length === 0) {
    return 'N/A';
  }

  const totalTime = resolvedQueries.reduce((sum, q) => {
    const created = new Date(q.created_at).getTime();
    const resolved = new Date(q.resolved_at!).getTime();
    return sum + (resolved - created);
  }, 0);

  const avgMs = totalTime / resolvedQueries.length;
  const avgHours = avgMs / (1000 * 60 * 60);

  if (avgHours < 24) {
    return `${Math.round(avgHours)}h`;
  } else {
    const avgDays = avgHours / 24;
    return `${Math.round(avgDays)}d`;
  }
}