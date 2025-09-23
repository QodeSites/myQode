import { NextRequest, NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import pool from '@/lib/db';

interface CreateOrderRequest {
  amount: number;
  currency?: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  nuvama_code: string;
  client_id: string;
  order_type: 'one_time' | 'sip';
  return_url?: string;
  is_new_strategy?: boolean;
  strategy_type?: string;
}

interface CashfreeOrderResponse {
  entity: 'order';
  cf_order_id: string;
  order_id: string;
  order_currency: string;
  order_amount: number;
  order_status: string;
  order_expiry_time: string;
  payment_session_id: string;
  payment_link?: string;
}

function generateOrderId(): string {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `qode_${ts}_${rnd}`;
}

async function sendSIPEmail(sipData: any) {
  console.log('Sending SIP email:', sipData);
  return { success: true };
}

const initCashfree = () => {
  console.log("=== INITIALIZE CASHFREE SDK ===");
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const environment = CFEnvironment.SANDBOX;

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials not found in environment variables");
  }

  try {
    console.log("Initializing Cashfree SDK with environment:", environment);
    console.log("Client ID:", clientId);
    const cashfree = new Cashfree(CFEnvironment.SANDBOX, clientId, clientSecret);
    console.log('cashfree instance:', cashfree);
    console.log("Cashfree SDK initialized successfully");
    return cashfree;
  } catch (error) {
    console.error("Failed to initialize Cashfree SDK:", error);
    throw error;
  }
};

async function cfCreateOrder(orderData: any) {
  const cashfree = initCashfree();
  try {
    const resp = await cashfree.PGCreateOrder(orderData, undefined, undefined, {
      headers: { 'x-api-version': '2023-08-01' }
    });
    console.log('Order Created successfully:', resp.data);
    return resp.data as CashfreeOrderResponse;
  } catch (error: any) {
    console.error('Error:', error.response);
    throw error;
  }
}
async function cfFetchOrder(orderId: string) {
  const cashfree = initCashfree();
  try {
    const resp = await cashfree.PGFetchOrder('2023-08-01', orderId);
    return resp.data as CashfreeOrderResponse;
  } catch (e: any) {
    console.error('Cashfree PGFetchOrder error:', e);
    if (e.response) {
      console.error('Cashfree API response:', e.response.data);
    }
    throw e;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateOrderRequest = await request.json();
    console.log('Received payload:', body);
    const {
      amount,
      customer_name,
      customer_email,
      customer_phone,
      nuvama_code,
      client_id,
      order_type,
      return_url,
      is_new_strategy,
      strategy_type
    } = body;

    // Required field checks
    const missing: string[] = [];
    if (!amount) missing.push('amount');
    if (!customer_name) missing.push('customer_name');
    if (!customer_email) missing.push('customer_email');
    if (!customer_phone) missing.push('customer_phone');
    if (!nuvama_code) missing.push('nuvama_code');
    if (!client_id) missing.push('client_id');
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}`, missing_fields: missing, received_data: Object.keys(body) },
        { status: 400 }
      );
    }

    if (amount < 100) return NextResponse.json({ error: 'Minimum amount is ₹100' }, { status: 400 });

    const cleanPhone = customer_phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number. Must be a 10-digit number.' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer_email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const orderId = generateOrderId();

    // For SIP: no payment, just notify via email and return OK
    if (order_type === 'sip') {
      await sendSIPEmail({
        order_id: orderId,
        nuvama_code,
        client_id,
        customer_name,
        customer_email,
        amount
      });

      return NextResponse.json({
        success: true,
        message: 'SIP setup request received successfully.',
        order_id: orderId,
        nuvama_code,
        client_id,
        amount,
        order_type: 'sip'
      });
    }

    // Build Create Order request
    const customer_details = {
      customer_id: client_id,
      customer_name,
      customer_email,
      customer_phone: cleanPhone
    };

    // Use a public URL for local development (replace with ngrok or staging URL)
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://your-ngrok-subdomain.ngrok.io'; // Set in .env or use ngrok
    const orderData: any = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details,
      order_meta: {
        return_url: return_url || `${baseUrl}/payment/success?order_id=${orderId}`,
        notify_url: `${baseUrl}/api/cashfree/webhook`
      },
      order_note: `Investment - Account ID: ${nuvama_code}, Client: ${customer_name}, Amount: ₹${amount.toFixed(2)}`,
      order_tags: {
        nuvama_code,
        client_id,
        // FIXED: Set order_type based on is_new_strategy
        order_type: is_new_strategy ? 'new_strategy' : 'one_time',
        source: 'qode_investor_portal',
        is_new_strategy: is_new_strategy ? 'true' : 'false',
        ...(strategy_type && { strategy_type })
      }
    };

    console.log('Sending orderData to Cashfree:', orderData); // Log for debugging

    // Create order via SDK
    const cfOrder = await cfCreateOrder(orderData);

    // FIXED: Set payment_type based on is_new_strategy
    const paymentType = is_new_strategy ? 'NEW_STRATEGY' : 'ONE_TIME';

    // Persist basic transaction details
    const result = await pool.query(
      `INSERT INTO payment_transactions (
        order_id, client_id, nuvama_code, client_name, amount, currency, payment_type,
        payment_status, payment_session_id, cf_order_id, created_at, is_new_strategy, strategy_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        cfOrder.order_id,
        client_id,
        nuvama_code,
        customer_name,
        amount,
        'INR',
        paymentType, // Use the conditional payment type
        cfOrder.order_status || 'CREATED',
        cfOrder.payment_session_id,
        cfOrder.cf_order_id || cfOrder.order_id,
        new Date(),
        is_new_strategy || false, // Store the new strategy flag
        strategy_type || null // Store the strategy type
      ]
    );
    console.log(`Inserted ${paymentType} transaction with ID:`, result.rows[0].id);

    return NextResponse.json({
      success: true,
      order_id: cfOrder.order_id,
      payment_session_id: cfOrder.payment_session_id,
      order_amount: cfOrder.order_amount,
      order_currency: cfOrder.order_currency,
      order_status: cfOrder.order_status,
      order_expiry_time: cfOrder.order_expiry_time,
      payment_link: cfOrder.payment_link || null,
      // Include these for the success page
      payment_type: paymentType,
      is_new_strategy: is_new_strategy || false,
      strategy_type: strategy_type || null
    });
  } catch (error: any) {
    console.error('Error creating Cashfree order via SDK:', error);
    const msg = error.message || 'Unknown error';
    const details = error.response ? error.response.data : (error.stack || error.message || String(error));
    return NextResponse.json(
      {
        error: msg,
        message: details,
        error_code: 'ORDER_CREATION_FAILED',
        timestamp: new Date().toISOString(),
        environment: process.env.ENV || 'development'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('order_id');
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const order = await cfFetchOrder(orderId);

    return NextResponse.json({
      success: true,
      ...order
    });
  } catch (error: any) {
    console.error('Error fetching order via SDK:', error);
    const msg = error.message || 'Unknown error';
    const details = error.response ? error.response.data : (error.stack || error.message || String(error));
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: details,
        error_code: 'ORDER_STATUS_CHECK_FAILED',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}