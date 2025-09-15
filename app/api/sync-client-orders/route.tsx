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
function mapPaymentStatus(cashfreeStatus: string): string {
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
  
  return statusMap[cashfreeStatus] || cashfreeStatus;
}

// Function to update database record
async function updateDatabaseRecord(dbRecord: any, cashfreeOrder: any, payments: any[]) {
  const latestPayment = payments.length > 0 ? payments[0] : null;
  
  try {
    const rawStatus = latestPayment?.payment_status || cashfreeOrder.order_status;
    const mappedStatus = mapPaymentStatus(rawStatus);
    
    console.log(`Mapping status: ${rawStatus} → ${mappedStatus}`);
    
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
    console.error(`Error updating database record ${dbRecord.id}:`, error);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nuvamaCode = searchParams.get('nuvama_code');
    const status = searchParams.get('status'); // 'pending', 'all', etc.

    if (!nuvamaCode) {
      return NextResponse.json(
        { error: 'nuvama_code is required' },
        { status: 400 }
      );
    }

    console.log(`Starting sync for client: ${nuvamaCode}`);

    // Build query based on status filter
    let query = 'SELECT * FROM payment_transactions WHERE nuvama_code = $1';
    let queryParams: any[] = [nuvamaCode];

    if (status === 'pending') {
      query += ' AND payment_status IN ($2, $3, $4)';
      queryParams.push('CREATED', 'ACTIVE', 'PENDING');
    } else if (status === 'unsync') {
      query += ' AND (cf_order_id IS NULL OR payment_session_id IS NULL)';
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, queryParams);
    const orders = result.rows;

    console.log(`Found ${orders.length} orders to sync for client ${nuvamaCode}`);

    if (orders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No orders found to sync',
        results: {
          total: 0,
          updated: 0,
          failed: 0,
          notFound: 0,
          errors: []
        }
      });
    }

    const syncResults = {
      total: orders.length,
      updated: 0,
      failed: 0,
      notFound: 0,
      errors: [] as any[]
    };

    // Process orders with rate limiting
    for (const dbRecord of orders) {
      try {
        console.log(`Syncing order: ${dbRecord.order_id}`);

        // Fetch current status from Cashfree
        const cashfreeOrder = await fetchCashfreeOrderStatus(dbRecord.order_id);
        
        if (!cashfreeOrder) {
          syncResults.notFound++;
          continue;
        }

        // Fetch payments for this order
        const payments = await fetchOrderPayments(dbRecord.order_id);

        // Check if update is needed
        const currentPaymentStatus = dbRecord.payment_status;
        const latestPayment = payments.length > 0 ? payments[0] : null;
        const rawNewStatus = latestPayment?.payment_status || cashfreeOrder.order_status;
        const newPaymentStatus = mapPaymentStatus(rawNewStatus);

        if (currentPaymentStatus !== newPaymentStatus || !dbRecord.cf_order_id || !dbRecord.payment_session_id) {
          console.log(`Updating order ${dbRecord.order_id}: ${currentPaymentStatus} → ${newPaymentStatus} (raw: ${rawNewStatus})`);
          
          await updateDatabaseRecord(dbRecord, cashfreeOrder, payments);
          syncResults.updated++;
        }

        // Rate limiting - wait between requests
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`Failed to sync order ${dbRecord.order_id}:`, error);
        syncResults.failed++;
        syncResults.errors.push({
          order_id: dbRecord.order_id,
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