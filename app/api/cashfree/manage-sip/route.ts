// app/api/cashfree/manage-sip/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

interface ManageSipRequest {
  subscription_id: string;
  action: 'CANCEL' | 'PAUSE' | 'ACTIVATE';
  reason?: string;
}

// Make Cashfree API request
const makeCashfreeRequest = async (endpoint: string, method: string, data?: any, apiVersion: string = '2025-01-01') => {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const baseUrl = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials not found in environment variables');
  }

  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-version': apiVersion,
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
  };

  const config: RequestInit = {
    method,
    headers,
  };

  if (data && (method === 'POST' || method === 'PUT')) {
    config.body = JSON.stringify(data);
  }

  console.log(`Making ${method} request to: ${baseUrl}${endpoint} with API version: ${apiVersion}`);
  console.log('Request data:', JSON.stringify(data, null, 2));

  const response = await fetch(`${baseUrl}${endpoint}`, config);
  const responseData = await response.json();

  if (!response.ok) {
    console.error('Cashfree API Error:', {
      endpoint,
      apiVersion,
      status: response.status,
      statusText: response.statusText,
      data: responseData,
    });
    throw new Error(responseData.message || `Cashfree API error: ${response.status}`);
  }

  return responseData;
};

// Map internal action to database status
function mapActionToStatus(action: string): string {
  const actionMap: { [key: string]: string } = {
    'CANCEL': 'CANCELLED',
    'PAUSE': 'PAUSED', 
    'ACTIVATE': 'ACTIVE'
  };
  
  return actionMap[action] || action;
}

export async function POST(request: NextRequest) {
  console.log('=== MANAGE SIP SUBSCRIPTION ===');

  try {
    const body: ManageSipRequest = await request.json();
    console.log('Request Body:', JSON.stringify(body, null, 2));

    const { subscription_id, action, reason } = body;

    // Validate required fields
    if (!subscription_id || !action) {
      return NextResponse.json(
        {
          success: false,
          message: 'subscription_id and action are required',
        },
        { status: 400 }
      );
    }

    // Validate action
    const validActions = ['CANCEL', 'PAUSE', 'ACTIVATE'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // First, get the subscription details from database
    const dbResult = await pool.query(
      'SELECT * FROM payment_transactions WHERE order_id = $1 AND payment_type = $2',
      [subscription_id, 'SIP']
    );

    if (dbResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'SIP subscription not found',
        },
        { status: 404 }
      );
    }

    const sipRecord = dbResult.rows[0];
    console.log('Found SIP record:', sipRecord);

    // Check if action is valid for current status
    const currentStatus = sipRecord.payment_status;
    if (action === 'ACTIVATE' && !['PAUSED', 'PENDING'].includes(currentStatus)) {
      return NextResponse.json(
        {
          success: false,
          message: `Cannot activate SIP. Current status: ${currentStatus}`,
        },
        { status: 400 }
      );
    }

    if (action === 'PAUSE' && !['ACTIVE', 'PENDING'].includes(currentStatus)) {
      return NextResponse.json(
        {
          success: false,
          message: `Cannot pause SIP. Current status: ${currentStatus}`,
        },
        { status: 400 }
      );
    }

    if (action === 'CANCEL' && ['CANCELLED', 'EXPIRED'].includes(currentStatus)) {
      return NextResponse.json(
        {
          success: false,
          message: `SIP is already ${currentStatus.toLowerCase()}`,
        },
        { status: 400 }
      );
    }

    // Prepare Cashfree request
    const manageRequest = {
      subscription_id: subscription_id,
      action: action,
    };

    console.log('Managing subscription with Cashfree:', manageRequest);

    // Call Cashfree API to manage subscription
    const cashfreeResponse = await makeCashfreeRequest(
      `/subscriptions/${subscription_id}/manage`,
      'POST',
      manageRequest,
      '2025-01-01'
    );

    console.log('Cashfree manage response:', cashfreeResponse);

    // Update database record
    const newStatus = mapActionToStatus(action);
    const updateQuery = `
      UPDATE payment_transactions 
      SET 
        payment_status = $1,
        updated_at = $2,
        canceled_at = $3
      WHERE order_id = $4 AND payment_type = $5
      RETURNING *
    `;

    const updateValues = [
      newStatus,
      new Date(),
      action === 'CANCEL' ? new Date() : sipRecord.canceled_at,
      subscription_id,
      'SIP'
    ];

    const updateResult = await pool.query(updateQuery, updateValues);
    console.log('Updated SIP record:', updateResult.rows[0]);

    // Log the action for audit trail
    await pool.query(
      `INSERT INTO sip_action_logs (subscription_id, action, reason, performed_at, status_before, status_after) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        subscription_id,
        action,
        reason || null,
        new Date(),
        currentStatus,
        newStatus
      ]
    ).catch(err => {
      // Don't fail the main operation if logging fails
      console.warn('Failed to log SIP action:', err.message);
    });

    return NextResponse.json({
      success: true,
      message: `SIP ${action.toLowerCase()}${action.endsWith('E') ? 'd' : 'led'} successfully`,
      data: {
        subscription_id: subscription_id,
        cf_subscription_id: sipRecord.cf_subscription_id,
        action: action,
        previous_status: currentStatus,
        new_status: newStatus,
        cashfree_response: {
          subscription_id: cashfreeResponse.subscription_id,
          subscription_status: cashfreeResponse.subscription_status,
          updated_at: cashfreeResponse.updated_at
        },
        updated_record: updateResult.rows[0]
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('SIP Management Error:', {
      message: error.message,
      stack: error.stack,
    });
    
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'Failed to manage SIP subscription',
        error_code: 'SIP_MANAGEMENT_FAILED',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nuvamaCode = searchParams.get('nuvama_code');
    const subscriptionId = searchParams.get('subscription_id');

    if (subscriptionId) {
      // Get specific SIP details
      const result = await pool.query(
        'SELECT * FROM payment_transactions WHERE order_id = $1 AND payment_type = $2',
        [subscriptionId, 'SIP']
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { success: false, message: 'SIP not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: result.rows[0]
      });
    }

    if (nuvamaCode) {
      // Get all SIPs for a client
      const result = await pool.query(
        'SELECT * FROM payment_transactions WHERE nuvama_code = $1 AND payment_type = $2 ORDER BY created_at DESC',
        [nuvamaCode, 'SIP']
      );

      return NextResponse.json({
        success: true,
        data: result.rows,
        total: result.rows.length
      });
    }

    return NextResponse.json(
      { success: false, message: 'nuvama_code or subscription_id is required' },
      { status: 400 }
    );

  } catch (error: any) {
    console.error('Error fetching SIP data:', error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'Failed to fetch SIP data',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}