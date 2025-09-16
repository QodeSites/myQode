// app/api/cancel-sip/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// Make direct Cashfree API request for subscription cancellation
const makeCashfreeRequest = async (endpoint: string, method: string = 'GET', apiVersion: string = '2025-01-01', body?: any) => {
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

// Function to cancel subscription in Cashfree using v2 API
async function cancelCashfreeSubscription(cfSubscriptionId: string) {
  try {
    console.log(`Cancelling subscription ${cfSubscriptionId} in Cashfree using v2 API`);
    
    const cancelData = await makeCashfreeV2Request(
      `/subscriptions/${cfSubscriptionId}/cancel`, 
      'POST'
    );
    
    console.log(`Successfully cancelled subscription ${cfSubscriptionId}:`, cancelData);
    return cancelData;
  } catch (error: any) {
    console.error(`Error cancelling subscription ${cfSubscriptionId}:`, error.message);
    throw error;
  }
}

// Function to update database record after cancellation
async function updateCancelledSubscriptionRecord(subscriptionId: string, nuvamaCode: string) {
  try {
    const updateQuery = `
      UPDATE payment_transactions 
      SET 
        payment_status = 'CANCELLED',
        canceled_at = $1,
        updated_at = $2
      WHERE order_id = $3 AND nuvama_code = $4 AND payment_type = 'SIP'
      RETURNING *
    `;

    const updateValues = [
      new Date(), // canceled_at
      new Date(), // updated_at
      subscriptionId,
      nuvamaCode
    ];

    const result = await pool.query(updateQuery, updateValues);
    
    if (result.rows.length === 0) {
      throw new Error('SIP subscription not found in database');
    }

    console.log(`Updated database record for cancelled subscription ${subscriptionId}`);
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating cancelled subscription record ${subscriptionId}:`, error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subscription_id, nuvama_code } = body;

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

    console.log(`Starting SIP cancellation for subscription: ${subscription_id}, client: ${nuvama_code}`);

    // First, verify the subscription exists and belongs to the client
    const verifyQuery = `
      SELECT id, order_id, payment_status, cf_subscription_id, amount, frequency 
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

    // Check if subscription is in a cancellable state
    const cancellableStatuses = ['ACTIVE', 'BANK_APPROVAL_PENDING', 'PENDING', 'PAUSED', 'ON_HOLD', 'CUSTOMER_PAUSED'];
    
    if (!cancellableStatuses.includes(sipRecord.payment_status.toUpperCase())) {
      return NextResponse.json(
        { 
          error: 'SIP cannot be cancelled',
          message: `SIP is in '${sipRecord.payment_status}' status and cannot be cancelled. Only active or pending SIPs can be cancelled.`
        },
        { status: 400 }
      );
    }

    // Cancel the subscription in Cashfree using cf_subscription_id
    let cashfreeCancelResult;
    try {
      cashfreeCancelResult = await cancelCashfreeSubscription(sipRecord.cf_subscription_id);
    } catch (error: any) {
      console.error(`Failed to cancel subscription in Cashfree:`, error.message);
      
      // If it's already cancelled in Cashfree, we can still update our database
      if (error.message.includes('already cancelled') || error.message.includes('404')) {
        console.log('Subscription might already be cancelled in Cashfree, updating database only');
        cashfreeCancelResult = { status: 'cancelled', message: 'Already cancelled' };
      } else {
        return NextResponse.json(
          { 
            error: 'Failed to cancel SIP',
            message: error.message,
            details: 'Could not cancel subscription with payment provider'
          },
          { status: 500 }
        );
      }
    }

    // Update the database record
    const updatedRecord = await updateCancelledSubscriptionRecord(subscription_id, nuvama_code);

    console.log(`Successfully cancelled SIP subscription ${subscription_id} for client ${nuvama_code}`);

    return NextResponse.json({
      success: true,
      message: 'SIP subscription cancelled successfully',
      data: {
        subscription_id: subscription_id,
        previous_status: sipRecord.payment_status,
        new_status: 'CANCELLED',
        cancelled_at: updatedRecord.canceled_at,
        amount: sipRecord.amount,
        frequency: sipRecord.frequency,
        cashfree_response: cashfreeCancelResult
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error during SIP cancellation:', error);
    return NextResponse.json(
      {
        error: 'SIP cancellation failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}