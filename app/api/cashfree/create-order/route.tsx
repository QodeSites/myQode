import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Cashfree, CFEnvironment } from 'cashfree-pg'; // ← correct import/casing

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
  account_number: string;
  ifsc_code: string;
  cashfree_bank_code?: string; // NetBanking bank code (required for TPV via NB)
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
  payment_link?: string; // Not always present for Orders
}

// ─────────────────────────────────────────────────────────────
// Optional: keep if you’ll reuse for webhooks etc.
function generateOrderId(): string {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `qode_${ts}_${rnd}`;
}

function createSignature(postData: string, timestamp: string): string {
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  if (!secretKey) throw new Error('Cashfree secret key is not configured');
  return crypto.createHmac('sha256', secretKey).update(postData + timestamp).digest('base64');
}

// ─────────────────────────────────────────────────────────────
// Mock DB + email helpers (replace with real impls)
async function storePaymentTransaction(data: {
  order_id: string;
  nuvama_code: string;
  amount: number;
  account_number: string;
  ifsc_code: string;
  client_name: string;
  payment_session_id: string;
  payment_status: string;
}) {
  console.log('Storing payment transaction:', data);
}

async function sendSIPEmail(sipData: any) {
  console.log('Sending SIP email:', sipData);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────
// SDK bootstrap (updated to match JavaScript code)
const initCashfree = () => {
    console.log("=== INITIALIZE CASHFREE SDK ===");

    const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_SECRET_KEY;
    const environment = CFEnvironment.PRODUCTION;

    if (!clientId || !clientSecret) {
        throw new Error("Cashfree credentials not found in environment variables");
    }

    try {
        console.log("Initializing Cashfree SDK with environment:", environment);
        console.log("Client ID:", clientId);
        const cashfree = new Cashfree(CFEnvironment.PRODUCTION, clientId, clientSecret);

        console.log("Cashfree SDK initialized successfully");
        return cashfree;
    } catch (error) {
        console.error("Failed to initialize Cashfree SDK:", error);
        throw error;
    }
};


// Updated cfCreateOrder to use initialized instance
async function cfCreateOrder(orderData: any) {
  const cashfree = initCashfree();
  try {
    const resp = await cashfree.PGCreateOrder(orderData);
    return resp.data as CashfreeOrderResponse;
  } catch (e) {
    // Fallback: older SDK requires explicit API version
    const resp = await cashfree.PGCreateOrder(orderData);
    return resp.data as CashfreeOrderResponse;
  }
}

// Updated cfFetchOrder to use initialized instance
async function cfFetchOrder(orderId: string) {
  const cashfree = initCashfree();
  try {
    const resp = await cashfree.PGFetchOrder(orderId);
    return resp.data as CashfreeOrderResponse;
  } catch (e) {
    const resp = await cashfree.PGFetchOrder('2023-08-01', orderId);
    return resp.data as CashfreeOrderResponse;
  }
}

// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: CreateOrderRequest = await request.json();
    const {
      amount,
      customer_name,
      customer_email,
      customer_phone,
      nuvama_code,
      client_id,
      order_type,
      return_url,
      account_number,
      ifsc_code,
      cashfree_bank_code,
      currency,
    } = body;

    // Required field checks
    const missing: string[] = [];
    if (!amount) missing.push('amount');
    if (!customer_name) missing.push('customer_name');
    if (!customer_email) missing.push('customer_email');
    if (!customer_phone) missing.push('customer_phone');
    if (!nuvama_code) missing.push('nuvama_code');
    if (!client_id) missing.push('client_id');
    if (!account_number) missing.push('account_number');
    if (!ifsc_code) missing.push('ifsc_code');
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}`, missing_fields: missing, received_data: Object.keys(body) },
        { status: 400 },
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
        amount,
        account_number: `***${account_number.slice(-4)}`,
        ifsc_code,
      });

      return NextResponse.json({
        success: true,
        message: 'SIP setup request received successfully.',
        order_id: orderId,
        nuvama_code,
        client_id,
        amount,
        order_type: 'sip',
        tpv_details: {
          nuvama_code,
          client_name: customer_name,
          account_number_masked: `***${account_number.slice(-4)}`,
          ifsc_code,
          tpv_enabled: true,
        },
      });
    }

    // Build Create Order request (with TPV fields)
    const customer_details: any = {
      customer_id: client_id,
      customer_name,
      customer_email,
      customer_phone: cleanPhone,
    };
    if (account_number && ifsc_code) {
      customer_details.customer_bank_account_number = account_number;
      customer_details.customer_bank_ifsc = ifsc_code;
    }
    if (cashfree_bank_code) {
      customer_details.customer_bank_code = cashfree_bank_code; // NetBanking bank code if you want NB-only TPV
    }

    const orderData: any = {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency || 'INR',
      customer_details,
      order_meta: {
        return_url: return_url || `${request.nextUrl.origin}/payment/success?order_id=${orderId}`,
        notify_url: `${request.nextUrl.origin}/api/cashfree/webhook`,
      },
      order_note: `Investment - Account ID: ${nuvama_code}, Client: ${customer_name}, Amount: ₹${amount.toFixed(2)}`,
      order_tags: {
        nuvama_code,
        client_id,
        order_type: 'one_time',
        source: 'qode_investor_portal',
        tpv_enabled: 'true',
        account_number_last4: account_number.slice(-4),
        ifsc_code,
      },
    };

    // Create order via SDK
    const cfOrder = await cfCreateOrder(orderData);

    // Persist basic transaction details
    await storePaymentTransaction({
      order_id: cfOrder.order_id,
      nuvama_code,
      amount,
      account_number,
      ifsc_code,
      client_name: customer_name,
      payment_session_id: cfOrder.payment_session_id,
      payment_status: cfOrder.order_status || 'CREATED',
    });

    return NextResponse.json({
      success: true,
      order_id: cfOrder.order_id,
      payment_session_id: cfOrder.payment_session_id,
      order_amount: cfOrder.order_amount,
      order_currency: cfOrder.order_currency,
      order_status: cfOrder.order_status,
      order_expiry_time: cfOrder.order_expiry_time,
      payment_link: cfOrder.payment_link || null, // often null for Orders
      environment: process.env.ENV || 'development',
      tpv_enabled: true,
      tpv_details: {
        nuvama_code,
        client_name: customer_name,
        account_number_masked: `***${account_number.slice(-4)}`,
        ifsc_code,
        tpv_enabled: true,
      },
    });
  } catch (error) {
    console.error('Error creating Cashfree order via SDK:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const details = error instanceof Error ? error.stack || error.message : String(error);
    return NextResponse.json(
      {
        error: msg,
        message: details,
        error_code: 'ORDER_CREATION_FAILED',
        timestamp: new Date().toISOString(),
        environment: process.env.ENV || 'development',
      },
      { status: 500 },
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
      ...order,
    });
  } catch (error) {
    console.error('Error fetching order via SDK:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        error_code: 'ORDER_STATUS_CHECK_FAILED',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}