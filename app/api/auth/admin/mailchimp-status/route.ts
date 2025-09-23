// app/api/admin/mailchimp-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Get client statistics for mailchimp campaign planning
    const stats = await query(
      `SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN password = 'Qode@123' AND onboarding_status = 'pending' THEN 1 END) as ready_for_mailchimp,
        COUNT(CASE WHEN password != 'Qode@123' AND onboarding_status = 'completed' THEN 1 END) as setup_completed,
        COUNT(CASE WHEN email IS NULL OR email = '' THEN 1 END) as missing_email
       FROM pms_clients_master`
    );

    // Get list of clients ready for mailchimp campaign
    const readyClients = await query(
      `SELECT clientcode, clientname, email, groupname, ownername
       FROM pms_clients_master 
       WHERE password = 'Qode@123' 
       AND onboarding_status = 'pending'
       AND email IS NOT NULL 
       AND email != ''
       ORDER BY clientname`
    );

    return NextResponse.json({
      success: true,
      stats: stats.rows[0],
      readyForCampaign: readyClients.rows
    });

  } catch (error) {
    console.error('Mailchimp status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Mark clients as campaign sent (optional tracking)
export async function POST(request: NextRequest) {
  try {
    const { clientCodes, campaignId } = await request.json();

    if (!Array.isArray(clientCodes)) {
      return NextResponse.json(
        { error: 'Client codes array is required' },
        { status: 400 }
      );
    }

    // Mark clients as having received mailchimp campaign
    const placeholders = clientCodes.map((_, index) => `$${index + 1}`).join(',');
    const result = await query(
      `UPDATE pms_clients_master 
       SET onboarding_status = 'email_sent',
           updated_at = NOW()
       WHERE clientcode IN (${placeholders})
       AND password = 'Qode@123'`,
      clientCodes
    );

    // Log the campaign (optional)
    if (campaignId) {
      await query(
        `INSERT INTO mailchimp_campaigns (
          campaign_id, 
          client_count, 
          sent_at
        ) VALUES ($1, $2, NOW())`,
        [campaignId, result.rowCount]
      );
    }

    return NextResponse.json({
      success: true,
      updated: result.rowCount,
      message: `Marked ${result.rowCount} clients as campaign sent`
    });

  } catch (error) {
    console.error('Update campaign status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}