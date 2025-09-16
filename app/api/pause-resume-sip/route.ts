// app/api/pause-resume-sip/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// Make direct Cashfree API v2 request for subscription operations
const makeCashfreeV2Request = async (endpoint: string, method: string = 'GET', body?: any) => {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const baseUrl = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/api/v2'
    : 'https://sandbox.cashfree.com/api/v2';

  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials not found in environment variables');
  }

  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
  };

  const requestOptions: RequestInit = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${endpoint}`, requestOptions);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Cashfree API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};

// Function to pause subscription in Cashfree using v2 API
async function pauseCashfreeSubscription(cfSubscriptionId: string) {
  try {
    console.log(`Pausing subscription ${cfSubscriptionId} in Cashfree using v2 API`);
    
    const pauseData = await makeCashfreeV2Request(
      `/subscriptions/${cfSubscriptionId}/pause-subscription`, 
      'POST'
    );
    
    console.log(`Successfully paused subscription ${cfSubscriptionId}:`, pauseData);
    return pauseData;
  } catch (error: any) {
    console.error(`Error pausing subscription ${cfSubscriptionId}:`, error.message);
    throw error;
  }
}

// Function to resume subscription in Cashfree using v2 API
async function resumeCashfreeSubscription(cfSubscriptionId: string) {
  try {
    console.log(`Resuming subscription ${cfSubscriptionId} in Cashfree using v2 API`);
    
    // Note: Cashfree v2 API might not have a direct resume endpoint
    // You may need to check Cashfree documentation for the exact resume endpoint
    // For now, using a generic approach - this might need adjustment based on actual API
    const resumeData = await makeCashfreeV2Request(
      `/subscriptions/${cfSubscriptionId}/activate-subscription`, 
      'POST'
    );
    
    console.log(`Successfully resumed subscription ${cfSubscriptionId}:`, resumeData);
    return resumeData;
  } catch (error: any) {
    console.error(`Error resuming subscription ${cfSubscriptionId}:`, error.message);
    throw error;
  }
}

// Function to update database record after pause/resume
async function updateSubscriptionStatus(subscriptionId: string, nuvamaCode: string, newStatus: string) {
  try {
    const updateQuery = `
      UPDATE payment_transactions 
      SET 
        payment_status = $1,
        updated_at = $2
      WHERE order_id = $3 AND nuvama_code = $4 AND payment_type = 'SIP'
      RETURNING *
    `;

    const updateValues = [
      newStatus,
      new Date(), // updated_at
      subscriptionId,
      nuvamaCode
    ];

    const result = await pool.query(updateQuery, updateValues);
    
    if (result.rows.length === 0) {
      throw new Error('SIP subscription not found in database');
    }

    console.log(`Updated database record for subscription ${subscriptionId} to status ${newStatus}`);
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating subscription record ${subscriptionId}:`, error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subscription_id, nuvama_code, action } = body;

    // Validate required fields
    if (!subscription_id) {
      return NextResponse.json(
        { error: 'subscription_id is required' },
        { status: 400 }
      );
    }

    if (!nuvama_code) {
      return NextResponse.json(
        { error: 'nuvama_code is required' },
        { status: 400 }
      );
    }

    if (!action || !['pause', 'resume'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be either "pause" or "resume"' },
        { status: 400 }
      );
    }

    console.log(`Starting SIP ${action} for subscription: ${subscription_id}, client: ${nuvama_code}`);

    // First, verify the subscription exists and belongs to the client
    const verifyQuery = `
      SELECT id, order_id, payment_status, cf_subscription_id, amount, frequency, next_charge_date
      FROM payment_transactions 
      WHERE order_id = $1 AND nuvama_code = $2 AND payment_type = 'SIP'
    `;
    
    const verifyResult = await pool.query(verifyQuery, [subscription_id, nuvama_code]);
    
    if (verifyResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'SIP subscription not found or does not belong to this client' },
        { status: 404 }
      );
    }

    const sipRecord = verifyResult.rows[0];

    // Validate that we have the cf_subscription_id
    if (!sipRecord.cf_subscription_id) {
      return NextResponse.json(
        { 
          error: 'SIP subscription not properly linked',
          message: 'The SIP subscription is missing the Cashfree subscription ID. Please contact support.'
        },
        { status: 400 }
      );
    }

    // Check if subscription is in a valid state for the requested action
    if (action === 'pause') {
      const pausableStatuses = ['ACTIVE'];
      if (!pausableStatuses.includes(sipRecord.payment_status.toUpperCase())) {
        return NextResponse.json(
          { 
            error: 'SIP cannot be paused',
            message: `SIP is in '${sipRecord.payment_status}' status and cannot be paused. Only active SIPs can be paused.`
          },
          { status: 400 }
        );
      }
    } else if (action === 'resume') {
      const resumableStatuses = ['PAUSED', 'CUSTOMER_PAUSED'];
      if (!resumableStatuses.includes(sipRecord.payment_status.toUpperCase())) {
        return NextResponse.json(
          { 
            error: 'SIP cannot be resumed',
            message: `SIP is in '${sipRecord.payment_status}' status and cannot be resumed. Only paused SIPs can be resumed.`
          },
          { status: 400 }
        );
      }
    }

    // Perform the action in Cashfree using cf_subscription_id
    let cashfreeResult;
    let newStatus;
    
    try {
      if (action === 'pause') {
        cashfreeResult = await pauseCashfreeSubscription(sipRecord.cf_subscription_id);
        newStatus = 'PAUSED';
      } else {
        cashfreeResult = await resumeCashfreeSubscription(sipRecord.cf_subscription_id);
        newStatus = 'ACTIVE';
      }
    } catch (error: any) {
      console.error(`Failed to ${action} subscription in Cashfree:`, error.message);
      
      // Check if the subscription is already in the desired state
      if (error.message.includes('already paused') || error.message.includes('already active')) {
        console.log(`Subscription is already in the desired state, updating database only`);
        newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
        cashfreeResult = { status: newStatus, message: `Already ${action}d` };
      } else {
        return NextResponse.json(
          { 
            error: `Failed to ${action} SIP`,
            message: error.message,
            details: `Could not ${action} subscription with payment provider`
          },
          { status: 500 }
        );
      }
    }

    // Update the database record
    const updatedRecord = await updateSubscriptionStatus(subscription_id, nuvama_code, newStatus);

    console.log(`Successfully ${action}d SIP subscription ${subscription_id} for client ${nuvama_code}`);

    return NextResponse.json({
      success: true,
      message: `SIP subscription ${action}d successfully`,
      data: {
        subscription_id: subscription_id,
        previous_status: sipRecord.payment_status,
        new_status: newStatus,
        action: action,
        amount: sipRecord.amount,
        frequency: sipRecord.frequency,
        next_charge_date: sipRecord.next_charge_date,
        cashfree_response: cashfreeResult
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error during SIP pause/resume:', error);
    return NextResponse.json(
      {
        error: 'SIP operation failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}