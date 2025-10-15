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
  message_count: number;
  client_name?: string;
  owner_name?: string;
}

interface QueryThread {
  thread_id: string;
  original_query: QueryMessage;
  messages: QueryMessage[];
  total_messages: number;
  last_message_at: string;
  has_unread_admin: boolean;
  client_name?: string;
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
  totalThreads: number;
  pendingThreads: number;
  resolvedThreads: number;
  todayThreads: number;
  thisWeekThreads: number;
  highPriorityThreads: number;
  threadsByType: Record<string, number>;
  avgResolutionTime: string;
  totalMessages: number;
  unreadAdminMessages: number;
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
          <p><strong>Thread ID:</strong> ${query.thread_id}</p>
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
    const threadId = searchParams.get('threadId');

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

    // Get thread conversation
    if (action === 'getThread' && threadId) {
      const threadQuery = `
        SELECT 
          q.*
        FROM pms_clients_tracker.qode_microsite_inquiries q
        WHERE q.thread_id = $1
        ORDER BY q.created_at ASC
      `;

      const threadResult = await client.query(threadQuery, [threadId]);

      // Get client info
      const clientCodes = [...new Set(threadResult.rows.map((r: any) => r.nuvama_code))];
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
              lastname
            FROM pms_clients_master
            WHERE clientcode IN (${placeholders})
          `;
          const clientsResult = await query(clientsQuery, clientCodes);

          clientsResult.rows.forEach((c: any) => {
            const fullName = c.clientname ||
              `${c.salutation || ''} ${c.firstname} ${c.middlename || ''} ${c.lastname}`.trim() ||
              'Unknown';
            clientMap.set(c.clientcode, fullName);
          });
        } catch (error) {
          console.error('Error fetching client data:', error);
        }
      }

      const messages = threadResult.rows.map((m: any) => ({
        ...m,
        client_name: clientMap.get(m.nuvama_code) || 'Unknown Client',
      }));

      return NextResponse.json({
        success: true,
        data: { messages },
      });
    }

    // Get all threads (grouped queries)
    const threadsQuery = `
      WITH thread_summary AS (
  SELECT 
    thread_id,
    MIN(created_at) as first_message_at,
    MAX(created_at) as last_message_at,
    MAX(CASE WHEN is_client_message = false THEN created_at END) as last_admin_response,
    -- Only count unread messages for pending threads
    SUM(CASE 
      WHEN is_client_message = true 
      AND status = 'pending'  -- ADD THIS LINE
      AND created_at > COALESCE(
        (SELECT MAX(created_at) FROM pms_clients_tracker.qode_microsite_inquiries i2 
         WHERE i2.thread_id = qode_microsite_inquiries.thread_id 
         AND i2.is_client_message = false), '1970-01-01'
      ) 
      THEN 1 ELSE 0 
    END) as unread_client_messages
  FROM pms_clients_tracker.qode_microsite_inquiries
  GROUP BY thread_id
),
      original_queries AS (
        SELECT DISTINCT ON (thread_id)
          id, type, nuvama_code, client_id, user_email, subject, status, 
          priority, data, email_sent, created_at, updated_at, resolved_at,
          assigned_to, last_updated_by, parent_inquiry_id, thread_id, 
          is_client_message
        FROM pms_clients_tracker.qode_microsite_inquiries
        WHERE parent_inquiry_id IS NULL OR id = thread_id
        ORDER BY thread_id, created_at ASC
      )
      SELECT 
        oq.*,
        ts.last_message_at,
        ts.unread_client_messages,
        CASE WHEN ts.unread_client_messages > 0 THEN true ELSE false END as has_unread
      FROM original_queries oq
      JOIN thread_summary ts ON oq.thread_id = ts.thread_id
      ORDER BY 
        CASE WHEN oq.status = 'pending' THEN 0 ELSE 1 END,
        ts.last_message_at DESC
    `;

    const threadsResult = await client.query(threadsQuery);
    const threads: QueryMessage[] = threadsResult.rows;

    // Get unique client codes
    const clientCodes = [...new Set(threads.map(t => t.nuvama_code))];
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

    // Enrich threads with client information
    const enrichedThreads = threads.map(t => ({
      ...t,
      client_name: clientMap.get(t.nuvama_code)?.name || 'Unknown Client',
      owner_name: clientMap.get(t.nuvama_code)?.name || null,
    }));

    // Calculate statistics
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const statistics: QueryStatistics = {
      totalThreads: enrichedThreads.length,
      pendingThreads: enrichedThreads.filter(t => t.status === 'pending').length,
      resolvedThreads: enrichedThreads.filter(t => t.status === 'resolved').length,
      todayThreads: enrichedThreads.filter(t => new Date(t.created_at) >= today).length,
      thisWeekThreads: enrichedThreads.filter(t => new Date(t.created_at) >= weekAgo).length,
      highPriorityThreads: enrichedThreads.filter(t => t.priority === 'high' && t.status === 'pending').length,
      threadsByType: enrichedThreads.reduce((acc, t) => {
        acc[t.type] = (acc[t.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      avgResolutionTime: calculateAverageResolutionTime(enrichedThreads),
      totalMessages: enrichedThreads.reduce((sum, t) => sum + (t.total_messages || 1), 0),
      unreadAdminMessages: enrichedThreads.filter((t: any) => t.has_unread).length,
    };

    return NextResponse.json({
      success: true,
      data: {
        threads: enrichedThreads,
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
    const { action, queryId, threadId, note, priority, sendEmail, adminEmail, emailData } = body;

    // Get admin email from session or request
    const currentAdminEmail = 'investor.relations@qodeinvest.com';

    switch (action) {
      case 'sendResponse': {
        if (!threadId || !emailData) {
          return NextResponse.json(
            { error: 'Thread ID and email data are required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Log what we received
          console.log('📧 Received email data:', {
            to: emailData.to,
            cc: emailData.cc,
            ccType: typeof emailData.cc,
            ccIsArray: Array.isArray(emailData.cc),
            ccLength: emailData.cc?.length,
            subject: emailData.subject
          });

          // Get original thread details
          const threadResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
       WHERE thread_id = $1 
       ORDER BY created_at ASC 
       LIMIT 1`,
            [threadId]
          );

          if (threadResult.rows.length === 0) {
            throw new Error('Thread not found');
          }

          const originalQuery = threadResult.rows[0];

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
            console.log('✅ Adding CC recipients:', emailData.cc);
          } else {
            console.log('ℹ️  No CC recipients provided');
          }

          console.log('📤 Final email payload:', {
            from: emailPayload.from,
            to: emailPayload.to,
            cc: emailPayload.cc || 'None',
            subject: emailPayload.subject
          });

          const emailResult = await resend.emails.send(emailPayload);

          console.log('✅ Email API response:', emailResult);

          if (emailResult.error) {
            throw new Error(`Email send failed: ${emailResult.error.message}`);
          }

          // Insert response as a new message in the thread
          const insertResult = await client.query(
            `INSERT INTO pms_clients_tracker.qode_microsite_inquiries 
       (type, nuvama_code, client_id, user_email, subject, status, priority, data, 
        parent_inquiry_id, thread_id, is_client_message, email_sent, created_at, updated_at, last_updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), $13)
       RETURNING id`,
            [
              'admin_response',
              originalQuery.nuvama_code,
              originalQuery.client_id,
              originalQuery.user_email,
              emailData.subject,
              originalQuery.status,
              originalQuery.priority,
              JSON.stringify({
                message: emailData.message,
                cc: emailData.cc || [],
                sent_by: currentAdminEmail
              }),
              originalQuery.id,
              threadId,
              false,
              true,
              currentAdminEmail
            ]
          );

          // Add note about the response
          const ccInfo = emailData.cc && emailData.cc.length > 0 ? ` (CC: ${emailData.cc.join(', ')})` : '';
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
       (inquiry_id, admin_email, note_type, content)
       VALUES ($1, $2, 'note', $3)`,
            [
              originalQuery.id,
              currentAdminEmail,
              `Admin response sent to ${emailData.to}${ccInfo}\nSubject: ${emailData.subject}`
            ]
          );

          // Update original query's updated_at
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
       SET updated_at = NOW(), last_updated_by = $1 
       WHERE thread_id = $2`,
            [currentAdminEmail, threadId]
          );

          await client.query('COMMIT');

          console.log('✅ Transaction committed successfully');

          return NextResponse.json({
            success: true,
            message: 'Response sent successfully',
            response_id: insertResult.rows[0].id,
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
        if (!threadId || !note) {
          return NextResponse.json(
            { error: 'Thread ID and resolution note are required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Get original query from thread
          const threadResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE thread_id = $1 
             ORDER BY created_at ASC 
             LIMIT 1`,
            [threadId]
          );

          if (threadResult.rows.length === 0) {
            throw new Error('Thread not found');
          }

          const originalQuery = threadResult.rows[0];

          // Update entire thread status to resolved
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET status = 'resolved', 
                 resolved_at = NOW(),
                 updated_at = NOW(),
                 last_updated_by = $1
             WHERE thread_id = $2`,
            [currentAdminEmail, threadId]
          );

          // Add resolution note to original query
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content, old_value, new_value)
             VALUES ($1, $2, 'status_change', $3, 'pending', 'resolved')`,
            [originalQuery.id, currentAdminEmail, note]
          );

          // Send email if requested
          if (sendEmail) {
            await sendQueryEmail(originalQuery, 'resolved', note);
          }

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Thread resolved successfully',
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      case 'reopen': {
        if (!threadId) {
          return NextResponse.json(
            { error: 'Thread ID is required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Get original query
          const threadResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE thread_id = $1 
             ORDER BY created_at ASC 
             LIMIT 1`,
            [threadId]
          );

          const originalQuery = threadResult.rows[0];

          // Reopen entire thread
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET status = 'pending', 
                 resolved_at = NULL,
                 updated_at = NOW(),
                 last_updated_by = $1
             WHERE thread_id = $2`,
            [currentAdminEmail, threadId]
          );

          // Add note
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content, old_value, new_value)
             VALUES ($1, $2, 'status_change', 'Thread reopened', 'resolved', 'pending')`,
            [originalQuery.id, currentAdminEmail]
          );

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Thread reopened successfully',
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

        // Update thread updated_at
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
        if (!threadId || !priority) {
          return NextResponse.json(
            { error: 'Thread ID and priority are required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Get original query
          const threadResult = await client.query(
            `SELECT * FROM pms_clients_tracker.qode_microsite_inquiries 
             WHERE thread_id = $1 
             ORDER BY created_at ASC 
             LIMIT 1`,
            [threadId]
          );

          const originalQuery = threadResult.rows[0];
          const oldPriority = originalQuery.priority;

          // Update entire thread priority
          await client.query(
            `UPDATE pms_clients_tracker.qode_microsite_inquiries 
             SET priority = $1, updated_at = NOW(), last_updated_by = $2
             WHERE thread_id = $3`,
            [priority, currentAdminEmail, threadId]
          );

          // Add note
          await client.query(
            `INSERT INTO pms_clients_tracker.qode_inquiry_notes 
             (inquiry_id, admin_email, note_type, content, old_value, new_value)
             VALUES ($1, $2, 'priority_change', 'Thread priority updated', $3, $4)`,
            [originalQuery.id, currentAdminEmail, oldPriority, priority]
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
        if (!threadId) {
          return NextResponse.json(
            { error: 'Thread ID is required' },
            { status: 400 }
          );
        }

        await client.query('BEGIN');

        try {
          // Get all inquiry IDs in this thread
          const threadInquiriesResult = await client.query(
            `SELECT id FROM pms_clients_tracker.qode_microsite_inquiries 
       WHERE thread_id = $1`,
            [threadId]
          );

          const inquiryIds = threadInquiriesResult.rows.map(row => row.id);

          if (inquiryIds.length === 0) {
            throw new Error('Thread not found');
          }

          // Delete all notes associated with these inquiries
          if (inquiryIds.length > 0) {
            const placeholders = inquiryIds.map((_, i) => `$${i + 1}`).join(',');
            await client.query(
              `DELETE FROM pms_clients_tracker.qode_inquiry_notes 
         WHERE inquiry_id IN (${placeholders})`,
              inquiryIds
            );
          }

          // Delete all messages in the thread
          await client.query(
            `DELETE FROM pms_clients_tracker.qode_microsite_inquiries 
       WHERE thread_id = $1`,
            [threadId]
          );

          await client.query('COMMIT');

          return NextResponse.json({
            success: true,
            message: 'Thread and all associated data deleted successfully',
            deleted_count: inquiryIds.length,
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

    // Make sure we return JSON even on error
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
function calculateAverageResolutionTime(threads: QueryMessage[]): string {
  const resolvedThreads = threads.filter(t => t.resolved_at && t.status === 'resolved');

  if (resolvedThreads.length === 0) {
    return 'N/A';
  }

  const totalTime = resolvedThreads.reduce((sum, t) => {
    const created = new Date(t.created_at).getTime();
    const resolved = new Date(t.resolved_at!).getTime();
    return sum + (resolved - created);
  }, 0);

  const avgMs = totalTime / resolvedThreads.length;
  const avgHours = avgMs / (1000 * 60 * 60);

  if (avgHours < 24) {
    return `${Math.round(avgHours)}h`;
  } else {
    const avgDays = avgHours / 24;
    return `${Math.round(avgDays)}d`;
  }
}