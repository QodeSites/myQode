// app/api/sync-client-orders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { Cashfree, CFEnvironment } from 'cashfree-pg';

// Initialize Cashfree SDK
const initCashfree = () => {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const environment = process.env.CASHFREE_ENVIRONMENT === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials not found in environment variables");
  }

  return new Cashfree(environment, clientId, clientSecret);
};

// Make direct Cashfree API request (for subscription endpoints not available in SDK)
const makeCashfreeRequest = async (endpoint: string, method: string = 'GET', apiVersion: string = '2025-01-01') => {
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

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Cashfree API error: ${response.status}`);
  }

  return await response.json();
};

// Function to fetch order details from Cashfree
async function fetchCashfreeOrderStatus(orderId: string) {
  const cashfree = initCashfree();
  try {
    const resp = await cashfree.PGFetchOrder(orderId);
    console.log(`Fetched order ${orderId} from Cashfree:`, resp.data);
    return resp.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`Order ${orderId} not found in Cashfree`);
      return null;
    }
    console.error(`Error fetching order ${orderId}:`, error.message);
    throw error;
  }
}

// Function to fetch subscription details from Cashfree
async function fetchCashfreeSubscriptionStatus(subscriptionId: string) {
  try {
    const subscriptionData = await makeCashfreeRequest(`/subscriptions/${subscriptionId}`, 'GET', '2025-01-01');
    console.log(`Fetched subscription ${subscriptionId} from Cashfree:`, subscriptionData);
    return subscriptionData;
  } catch (error: any) {
    if (error.message?.includes('404')) {
      console.log(`Subscription ${subscriptionId} not found in Cashfree`);
      return null;
    }
    console.error(`Error fetching subscription ${subscriptionId}:`, error.message);
    throw error;
  }
}

// Function to fetch payments for an order
async function fetchOrderPayments(orderId: string) {
  const cashfree = initCashfree();
  try {
    const resp = await cashfree.PGOrderFetchPayments(orderId);
    return resp.data || [];
  } catch (error: any) {
    console.error(`Error fetching payments for order ${orderId}:`, error.message);
    return [];
  }
}

// Function to map Cashfree status to valid database status
function mapPaymentStatus(cashfreeStatus: string, paymentType: string = 'ONE_TIME'): string {
  const statusUpper = (cashfreeStatus || '').toUpperCase();
  
  if (paymentType === 'SIP') {
    // SIP-specific status mapping
    const sipStatusMap: { [key: string]: string } = {
      'ACTIVE': 'ACTIVE',
      'INITIALISED': 'PENDING',
      'INITIALIZED': 'PENDING',
      'BANK_APPROVAL_PENDING': 'BANK_APPROVAL_PENDING', // Keep original status
      'PENDING': 'PENDING',
      'ON_HOLD': 'ON_HOLD', // Keep original status
      'PAUSED': 'PAUSED',
      'CUSTOMER_PAUSED': 'CUSTOMER_PAUSED', // Keep original status
      'COMPLETED': 'COMPLETED',
      'CUSTOMER_CANCELLED': 'CANCELLED',
      'CANCELLED': 'CANCELLED',
      'EXPIRED': 'EXPIRED',
      'LINK_EXPIRED': 'EXPIRED',
      'FAILED': 'FAILED'
    };
    
    return sipStatusMap[statusUpper] || statusUpper;
  } else {
    // Regular payment status mapping
    const statusMap: { [key: string]: string } = {
      'SUCCESS': 'PAID',
      'PAID': 'PAID',
      'FAILED': 'FAILED',
      'PENDING': 'ACTIVE',
      'ACTIVE': 'ACTIVE',
      'CREATED': 'ACTIVE',
      'EXPIRED': 'EXPIRED',
      'CANCELLED': 'CANCELLED',
      'TERMINATED': 'CANCELLED'
    };
    
    return statusMap[statusUpper] || statusUpper;
  }
}

// Function to update database record for regular orders
async function updateOrderRecord(dbRecord: any, cashfreeOrder: any, payments: any[]) {
  const latestPayment = payments.length > 0 ? payments[0] : null;
  
  try {
    const rawStatus = latestPayment?.payment_status || cashfreeOrder.order_status;
    const mappedStatus = mapPaymentStatus(rawStatus, 'ONE_TIME');
    
    console.log(`Mapping order status: ${rawStatus} → ${mappedStatus}`);
    
    const updateQuery = `
      UPDATE payment_transactions 
      SET 
        payment_status = $1,
        payment_session_id = $2,
        cf_order_id = $3,
        updated_at = $4
      WHERE id = $5
      RETURNING *
    `;

    const updateValues = [
      mappedStatus,
      latestPayment?.payment_session_id || cashfreeOrder.payment_session_id || null,
      cashfreeOrder.cf_order_id || cashfreeOrder.order_id || null,
      new Date(),
      dbRecord.id
    ];

    const result = await pool.query(updateQuery, updateValues);
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating order record ${dbRecord.id}:`, error);
    throw error;
  }
}

// Function to update database record for SIP subscriptions
async function updateSubscriptionRecord(dbRecord: any, subscriptionData: any) {
  try {
    const rawStatus = subscriptionData.subscription_status;
    const mappedStatus = mapPaymentStatus(rawStatus, 'SIP');
    
    console.log(`Mapping SIP status: ${rawStatus} → ${mappedStatus}`);
    
    // Calculate next charge date if available
    let nextChargeDate = null;
    if (subscriptionData.next_schedule_date) {
      try {
        nextChargeDate = new Date(subscriptionData.next_schedule_date).toISOString().split('T')[0];
      } catch (e) {
        console.warn(`Invalid next_schedule_date format: ${subscriptionData.next_schedule_date}`);
      }
    }

    const updateQuery = `
      UPDATE payment_transactions 
      SET 
        payment_status = $1,
        cf_subscription_id = $2,
        next_charge_date = $3,
        updated_at = $4,
        canceled_at = $5
      WHERE id = $6
      RETURNING *
    `;

    const updateValues = [
      mappedStatus,
      subscriptionData.cf_subscription_id || subscriptionData.subscription_id || null,
      nextChargeDate,
      new Date(),
      ['CANCELLED', 'EXPIRED', 'COMPLETED', 'CUSTOMER_CANCELLED'].includes(mappedStatus) && !dbRecord.canceled_at ? new Date() : dbRecord.canceled_at,
      dbRecord.id
    ];

    const result = await pool.query(updateQuery, updateValues);
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating subscription record ${dbRecord.id}:`, error);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nuvamaCode = searchParams.get('nuvama_code');
    const status = searchParams.get('status');

    if (!nuvamaCode) {
      return NextResponse.json(
        { error: 'nuvama_code is required' },
        { status: 400 }
      );
    }

    console.log(`Starting sync for client: ${nuvamaCode}`);

    // Define status categories
    const PENDING_ORDER_STATUSES = ['CREATED', 'ACTIVE', 'PENDING'];
    const PENDING_SIP_STATUSES = [
      'INITIALISED', 
      'BANK_APPROVAL_PENDING', 
      'ACTIVE', 
      'ON_HOLD', 
      'PAUSED', 
      'CUSTOMER_PAUSED'
    ];

    // Build query based on status filter
    let query = 'SELECT * FROM payment_transactions WHERE nuvama_code = $1';
    let queryParams: any[] = [nuvamaCode];

    if (status === 'pending') {
      const allPendingStatuses = [...PENDING_ORDER_STATUSES, ...PENDING_SIP_STATUSES];
      const placeholders = allPendingStatuses.map((_, index) => `$${index + 2}`).join(', ');
      query += ` AND payment_status IN (${placeholders})`;
      queryParams.push(...allPendingStatuses);
      console.log(`DEBUG: Using comprehensive pending filter with statuses:`, allPendingStatuses);
    } else if (status === 'unsync') {
      query += ' AND (cf_order_id IS NULL OR payment_session_id IS NULL OR cf_subscription_id IS NULL)';
      console.log(`DEBUG: Using unsync filter`);
    } else {
      console.log(`DEBUG: No status filter applied`);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, queryParams);
    const orders = result.rows;

    console.log(`Found ${orders.length} orders to sync for client ${nuvamaCode}`);

    // Log details about what we found
    if (orders.length > 0) {
      const sipCount = orders.filter(o => o.payment_type === 'SIP').length;
      const regularCount = orders.filter(o => o.payment_type !== 'SIP').length;
      console.log(`DEBUG: SIP orders: ${sipCount}, Regular orders: ${regularCount}`);
    }

    if (orders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No orders found to sync',
        results: {
          total: 0,
          updated: 0,
          failed: 0,
          notFound: 0,
          errors: [],
          sipsSynced: 0,
          ordersSynced: 0
        }
      });
    }

    const syncResults = {
      total: orders.length,
      updated: 0,
      failed: 0,
      notFound: 0,
      errors: [] as any[],
      sipsSynced: 0,
      ordersSynced: 0
    };

    // Process orders with rate limiting
    for (const dbRecord of orders) {
      try {
        console.log(`Syncing ${dbRecord.payment_type || 'ONE_TIME'}: ${dbRecord.order_id}`);

        let needsUpdate = false;
        let updateResult = null;

        if (dbRecord.payment_type === 'SIP') {
          console.log(`DEBUG: Processing SIP subscription ID: ${dbRecord.order_id}`);
          
          // Handle SIP subscription
          const subscriptionData = await fetchCashfreeSubscriptionStatus(dbRecord.order_id);
          
          if (!subscriptionData) {
            console.log(`DEBUG: No subscription data found for ${dbRecord.order_id}`);
            syncResults.notFound++;
            continue;
          }

          console.log(`DEBUG: Subscription data received:`, {
            subscription_id: subscriptionData.subscription_id || subscriptionData.cf_subscription_id,
            status: subscriptionData.subscription_status,
            next_schedule_date: subscriptionData.next_schedule_date
          });

          // Check if update is needed for SIP
          const currentStatus = dbRecord.payment_status;
          const rawNewStatus = subscriptionData.subscription_status;
          const newStatus = mapPaymentStatus(rawNewStatus, 'SIP');

          console.log(`DEBUG: SIP status comparison - Current: ${currentStatus}, New: ${newStatus}, Raw: ${rawNewStatus}`);

          if (currentStatus !== newStatus || 
              !dbRecord.cf_subscription_id || 
              !dbRecord.next_charge_date ||
              (subscriptionData.next_schedule_date && 
               dbRecord.next_charge_date !== new Date(subscriptionData.next_schedule_date).toISOString().split('T')[0])) {
            
            console.log(`Updating SIP ${dbRecord.order_id}: ${currentStatus} → ${newStatus} (raw: ${rawNewStatus})`);
            
            updateResult = await updateSubscriptionRecord(dbRecord, subscriptionData);
            needsUpdate = true;
            syncResults.sipsSynced++;
          } else {
            console.log(`DEBUG: No update needed for SIP ${dbRecord.order_id}`);
          }

        } else {
          console.log(`DEBUG: Processing regular order ID: ${dbRecord.order_id}`);
          
          // Handle regular order
          const cashfreeOrder = await fetchCashfreeOrderStatus(dbRecord.order_id);
          
          if (!cashfreeOrder) {
            console.log(`DEBUG: No order data found for ${dbRecord.order_id}`);
            syncResults.notFound++;
            continue;
          }

          // Fetch payments for this order
          const payments = await fetchOrderPayments(dbRecord.order_id);
          console.log(`DEBUG: Found ${payments.length} payments for order ${dbRecord.order_id}`);

          // Check if update is needed for regular order
          const currentPaymentStatus = dbRecord.payment_status;
          const latestPayment = payments.length > 0 ? payments[0] : null;
          const rawNewStatus = latestPayment?.payment_status || cashfreeOrder.order_status;
          const newPaymentStatus = mapPaymentStatus(rawNewStatus, 'ONE_TIME');

          console.log(`DEBUG: Order status comparison - Current: ${currentPaymentStatus}, New: ${newPaymentStatus}, Raw: ${rawNewStatus}`);

          if (currentPaymentStatus !== newPaymentStatus || 
              !dbRecord.cf_order_id || 
              !dbRecord.payment_session_id) {
            
            console.log(`Updating order ${dbRecord.order_id}: ${currentPaymentStatus} → ${newPaymentStatus} (raw: ${rawNewStatus})`);
            
            updateResult = await updateOrderRecord(dbRecord, cashfreeOrder, payments);
            needsUpdate = true;
            syncResults.ordersSynced++;
          } else {
            console.log(`DEBUG: No update needed for order ${dbRecord.order_id}`);
          }
        }

        if (needsUpdate) {
          syncResults.updated++;
          console.log(`DEBUG: Successfully updated record ${dbRecord.id}`);
        }

        // Rate limiting - wait between requests
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (error) {
        console.error(`Failed to sync ${dbRecord.payment_type || 'order'} ${dbRecord.order_id}:`, error);
        syncResults.failed++;
        syncResults.errors.push({
          order_id: dbRecord.order_id,
          payment_type: dbRecord.payment_type || 'ONE_TIME',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`Sync completed for ${nuvamaCode}:`, syncResults);

    return NextResponse.json({
      success: true,
      message: `Sync completed for client ${nuvamaCode}`,
      client_code: nuvamaCode,
      results: syncResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error during client order sync:', error);
    return NextResponse.json(
      {
        error: 'Sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}