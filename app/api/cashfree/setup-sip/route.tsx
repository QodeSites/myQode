import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

interface CreateSipOrderRequest {
  order_amount: number;
  nuvama_code: string;
  sip_details: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
    start_date: string; // YYYY-MM-DD format
    end_date?: string; // YYYY-MM-DD format (optional)
    total_installments?: number;
  };
  order_meta?: {
    return_url?: string;
  };
}

interface AccountDetails {
  client_name: string;
  account_number: string;
  ifsc_code: string;
  phone_number?: string;
}

interface CashfreePlanResponse {
  plan_id: string;
  plan_name: string;
  plan_type: string;
  plan_currency: string;
  amount: number;
  plan_note: string;
}

interface CashfreeSubscriptionResponse {
  subscription_id: string;
  cf_subscription_id: string;
  subscription_status: string;
  payment_link: string;
  plan_details: any;
  subscription_first_charge_time: string;
  subscription_expiry_time: string;
  next_schedule_date?: string;
}

// Helper functions
function generateOrderId(): string {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `qode_${ts}_${rnd}`;
}

// Sanitize string to include only alphanumeric characters and allowed special characters
function sanitizeDescription(description: string): string {
  return description.replace(/[^a-zA-Z0-9_-]/g, ''); // Allow only alphanumeric, underscore, and hyphen
}

async function fetchAccountDetails(nuvama_code: string): Promise<AccountDetails> {
  console.log('Fetching account details for:', nuvama_code);
  // Replace with actual implementation to fetch real account details
  return {
    client_name: 'John Doe',
    account_number: '010080198715', // Valid account number for testing
    ifsc_code: 'ICIC0001008', // Valid IFSC for ICICI Bank
    phone_number: '9876543210',
  };
}

async function storePaymentTransaction(data: {
  order_id: string;
  nuvama_code: string;
  amount: number;
  account_number: string;
  ifsc_code: string;
  client_name: string;
  payment_session_id: string;
  payment_status: string;
  payment_type: string;
  cf_subscription_id: string;
}) {
  console.log('Storing payment transaction:', data);
  return 1; // Mock transaction ID
}

async function storeSipDetails(data: {
  payment_transaction_id: number;
  subscription_id: string;
  frequency: string;
  start_date: string;
  end_date: string | null;
  total_installments?: number;
  next_charge_date?: string | null;
}) {
  console.log('Storing SIP details:', data);
}

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
  console.log('Request headers:', headers);
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

// Create Plan
const createPlan = async (planData: any): Promise<CashfreePlanResponse> => {
  return await makeCashfreeRequest('/plans', 'POST', planData, '2025-01-01');
};

// Create Subscription
const createSubscription = async (subscriptionData: any): Promise<CashfreeSubscriptionResponse> => {
  return await makeCashfreeRequest('/subscriptions', 'POST', subscriptionData, '2025-01-01');
};

export async function POST(request: NextRequest) {
  console.log('=== CREATE CASHFREE SIP ORDER (DIRECT SUBSCRIPTION FLOW) ===');

  try {
    const body: CreateSipOrderRequest = await request.json();
    const { order_amount, nuvama_code, sip_details = {}, order_meta = {} } = body;

    console.log('Request Body:', body);

    // Validate required fields
    if (!order_amount || !nuvama_code || !sip_details.frequency || !sip_details.start_date) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required fields: order_amount, nuvama_code, frequency, or start_date',
        },
        { status: 400 }
      );
    }

    if (isNaN(order_amount) || parseFloat(order_amount.toString()) < 1) {
      return NextResponse.json(
        {
          success: false,
          message: 'Amount must be a number and minimum ₹1',
        },
        { status: 400 }
      );
    }

    // Validate date fields
    const startDate = sip_details.start_date ? new Date(sip_details.start_date) : null;
    if (!startDate || isNaN(startDate.getTime())) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid start_date format. Use YYYY-MM-DD',
        },
        { status: 400 }
      );
    }

    const endDate = sip_details.end_date ? new Date(sip_details.end_date) : null;
    if (sip_details.end_date && (!endDate || isNaN(endDate.getTime()))) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid end_date format. Use YYYY-MM-DD or omit for null',
        },
        { status: 400 }
      );
    }

    // Fetch account details
    const accountDetails = await fetchAccountDetails(nuvama_code);
    const phoneRegex = /^[0-9]{10}$/;
    const customerPhone = accountDetails.phone_number && phoneRegex.test(accountDetails.phone_number)
      ? accountDetails.phone_number
      : '9999999999';

    console.log('Account details fetched for TPV:', {
      nuvama_code,
      client_name: accountDetails.client_name,
      account_masked: `***${accountDetails.account_number.slice(-4)}`,
      ifsc_code: accountDetails.ifsc_code,
      phone_number: customerPhone,
    });

    if (!accountDetails.account_number || !accountDetails.ifsc_code || !accountDetails.client_name) {
      throw new Error('Missing required TPV fields: account_number, ifsc_code, or client_name');
    }

    const subscription_id = `SUB_${generateOrderId()}`;
    const plan_id = `PLAN_${generateOrderId()}`;

    // Map frequency to Cashfree interval types
    const intervalTypeMap = {
      daily: 'DAY',
      weekly: 'WEEK',
      monthly: 'MONTH',
      quarterly: 'MONTH',
      yearly: 'YEAR',
      custom: 'MONTH',
    };

    const intervalType = intervalTypeMap[sip_details.frequency.toLowerCase() as keyof typeof intervalTypeMap] || 'MONTH';
    const planIntervals = sip_details.frequency.toLowerCase() === 'quarterly' ? 3 : 1;

    // Bank code mapping
    const bankCodeMapping: { [key: string]: string } = {
      ICIC: 'ICIC',
      HDFC: 'HDFC',
      SBIN: 'SBI',
      AXIS: 'AXIS',
      YESB: 'YES',
      INDB: 'INDIAN',
      KKBK: 'KOTAK',
      CITI: 'CITI',
      SCBL: 'SC',
      UTIB: 'AXIS',
    };

    const ifscPrefix = accountDetails.ifsc_code ? accountDetails.ifsc_code.substring(0, 4) : '';
    const customerBankCode = bankCodeMapping[ifscPrefix] || 'ICIC'; // Default to ICICI for testing

    // Step 1: Create Plan
    const planRequest = {
      plan_id,
      plan_name: `SIP_${nuvama_code}_${Date.now()}`,
      plan_type: 'PERIODIC',
      plan_currency: 'INR',
      amount: parseFloat(order_amount.toString()), // Changed from plan_max_amount
      plan_max_amount: parseFloat(order_amount.toString()) * 100, // Kept for backward compatibility
      intervalType, // Added for periodic plan
      plan_interval_type: 'MONTH', // Added to specify number of intervals
      plan_note: sanitizeDescription(`SIP_Plan_for_${accountDetails.client_name}_${sip_details.frequency}`), // Sanitized description
    };


    console.log('Creating plan with request:', JSON.stringify(planRequest, null, 2));
    // Validate plan request
    if (!planRequest.amount || !planRequest.intervalType) {
      throw new Error('Plan request missing required fields: amount or intervalType');
    }

    console.log('Plan Request:', JSON.stringify(planRequest, null, 2));
    const planResponse = await createPlan(planRequest);
    console.log('Plan Created:', planResponse);

    // Step 2: Create Subscription
    const baseReturn = order_meta.return_url || `${request.nextUrl.origin}/payment-result`;
    const subscriptionRequest = {
      subscription_id,
      customer_details: {
        customer_name: String(accountDetails.client_name),
        customer_bank_account_holder_name: String(accountDetails.client_name), // Explicitly set for TPV
        customer_email: `${nuvama_code}@nuvama.com`,
        customer_phone: String(customerPhone),
        customer_bank_account_number: String(accountDetails.account_number),
        customer_bank_ifsc: String(accountDetails.ifsc_code),
        customer_bank_code: String(customerBankCode),
        customer_bank_account_type: 'SAVINGS',
      },
      plan_details: {
        plan_id: planRequest.plan_id,
        plan_name: planRequest.plan_name,
        plan_type: 'PERIODIC',
        plan_currency: planRequest.plan_currency,
        plan_recurring_amount: planRequest.amount,
        plan_intervals: planIntervals,
        plan_interval_type: planRequest.plan_interval_type,
        plan_note: planRequest.plan_note,
        plan_max_amount: planRequest.amount * 100, // Kept for backward compatibility
        plan_status: 'ACTIVE',
        plan_amount: planRequest.amount,
      },
      authorization_details: {
        authorization_amount: parseFloat(order_amount.toString()),
        authorization_amount_refund: true,
        authorization_time: 1,
        payment_methods: ['enach', 'pnach', 'upi', 'card'],
      },
      subscription_meta: {
        return_url: `${baseReturn}?subscription_id=${subscription_id}`,
        notification_channel: ['EMAIL', 'SMS'],
      },
      subscription_first_charge_time: startDate.toISOString(),
      subscription_expiry_time: endDate
        ? endDate.toISOString()
        : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      subscription_note: sanitizeDescription(`Nuvama_Code_${nuvama_code}_SIP_Amount_${parseFloat(order_amount.toString()).toFixed(2)}`),
      subscription_tags: {
        nuvama_code,
        client_name: accountDetails.client_name,
      },
    };

    console.log(
      'Subscription Request:',
      JSON.stringify(
        {
          ...subscriptionRequest,
          customer_details: {
            ...subscriptionRequest.customer_details,
            customer_phone: '***' + customerPhone.slice(-4),
            customer_bank_account_number: `***${accountDetails.account_number.slice(-4)}`,
          },
        },
        null,
        2
      )
    );

    const subscriptionResponse = await createSubscription(subscriptionRequest);
    console.log('Subscription Created:', subscriptionResponse);

    if (!subscriptionResponse.payment_link) {
      console.error('Missing payment_link in response:', subscriptionResponse);
      throw new Error('Failed to create subscription session - missing payment_link');
    }

    if (subscriptionResponse.subscription_status !== 'INITIALIZED') {
      console.error('Unexpected subscription status:', subscriptionResponse.subscription_status);
      throw new Error(`Subscription creation failed - status: ${subscriptionResponse.subscription_status}`);
    }

    // Store transaction and SIP details
    const transactionId = await storePaymentTransaction({
      order_id: subscription_id,
      nuvama_code,
      amount: parseFloat(order_amount.toString()),
      account_number: accountDetails.account_number,
      ifsc_code: accountDetails.ifsc_code,
      client_name: accountDetails.client_name,
      payment_session_id: subscriptionResponse.payment_link,
      payment_status: 'INITIALIZED',
      payment_type: 'SIP',
      cf_subscription_id: subscriptionResponse.cf_subscription_id,
    });

    await storeSipDetails({
      payment_transaction_id: transactionId,
      subscription_id: subscriptionResponse.subscription_id,
      frequency: sip_details.frequency,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate ? endDate.toISOString().split('T')[0] : null,
      total_installments: sip_details.total_installments,
      next_charge_date: subscriptionResponse.next_schedule_date
        ? new Date(subscriptionResponse.next_schedule_date).toISOString().split('T')[0]
        : null,
    });

    return NextResponse.json({
      success: true,
      data: {
        order_id: subscription_id,
        plan_id: planResponse.plan_id,
        subscription_id: subscriptionResponse.subscription_id,
        cf_subscription_id: subscriptionResponse.cf_subscription_id,
        subscription_status: subscriptionResponse.subscription_status,
        order_amount: parseFloat(order_amount.toString()),
        order_currency: 'INR',
        checkout_url: subscriptionResponse.payment_link,
        customer_bank_account_number: accountDetails.account_number,
        customer_bank_ifsc: accountDetails.ifsc_code,
        customer_bank_code: customerBankCode,
        plan_details: subscriptionResponse.plan_details,
        subscription_first_charge_time: subscriptionResponse.subscription_first_charge_time,
        subscription_expiry_time: subscriptionResponse.subscription_expiry_time,
        sip_details: {
          frequency: sip_details.frequency,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate ? endDate.toISOString().split('T')[0] : null,
          total_installments: sip_details.total_installments,
          next_charge_date: subscriptionResponse.next_schedule_date
            ? new Date(subscriptionResponse.next_schedule_date).toISOString().split('T')[0]
            : null,
        },
        tpv_enabled: true,
        tpv_details: {
          nuvama_code,
          client_name: accountDetails.client_name,
          account_number_masked: `***${accountDetails.account_number.slice(-4)}`,
          ifsc_code: accountDetails.ifsc_code,
          tpv_enabled: true,
        },
      },
    });
  } catch (error: any) {
    console.error('Subscription Creation Error:', {
      message: error.message,
      stack: error.stack,
      response: error.response,
    });
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'Failed to create subscription',
        error_code: 'SUBSCRIPTION_CREATION_FAILED',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscription_id');
    const action = searchParams.get('action');

    if (!subscriptionId) {
      return NextResponse.json({ error: 'Subscription ID is required' }, { status: 400 });
    }

    const subscriptionData = await makeCashfreeRequest(`/subscriptions/${subscriptionId}`, 'GET', undefined, '2025-01-01');

    if (action === 'verify') {
      const mapStatus = (apiStatus: string) => {
        const norm = (apiStatus || '').toUpperCase();
        if (norm === 'ACTIVE') return 'ACTIVE';
        if (norm === 'INITIALIZED' || norm === 'PENDING' || norm === 'ON_HOLD' || norm === 'PAUSED') return 'PENDING';
        if (norm === 'CANCELLED' || norm === 'EXPIRED' || norm === 'USER_DROPPED') return 'CANCELLED';
        return 'FAILED';
      };

      const subscriptionStatus = mapStatus(subscriptionData.subscription_status);

      return NextResponse.json({
        success: true,
        subscription_id: subscriptionData.subscription_id,
        cf_subscription_id: subscriptionData.cf_subscription_id,
        status: subscriptionStatus,
        subscription_status: subscriptionData.subscription_status,
        customer_details: {
          customer_name: subscriptionData.customer_details?.customer_name,
          customer_email: subscriptionData.customer_details?.customer_email,
          customer_phone: subscriptionData.customer_details?.customer_phone,
        },
        plan_details: {
          plan_name: subscriptionData.plan_details?.plan_name,
          plan_amount: subscriptionData.plan_details?.plan_recurring_amount || subscriptionData.plan_details?.plan_amount,
          plan_currency: subscriptionData.plan_details?.plan_currency,
          plan_interval_type: subscriptionData.plan_details?.plan_interval_type,
          plan_intervals: subscriptionData.plan_details?.plan_intervals,
        },
        authorization_details: {
          authorization_status: subscriptionData.authorisation_details?.authorization_status,
          authorization_time: subscriptionData.authorisation_details?.authorization_time,
          payment_method: subscriptionData.authorisation_details?.payment_method?.enach?.auth_mode || subscriptionData.authorisation_details?.payment_method,
        },
        subscription_first_charge_time: subscriptionData.subscription_first_charge_time,
        subscription_expiry_time: subscriptionData.subscription_expiry_time,
        next_schedule_date: subscriptionData.next_schedule_date || null,
        error_code: subscriptionData.error_code || null,
        error_reason: subscriptionData.error_message || null,
      });
    }

    return NextResponse.json({
      success: true,
      ...subscriptionData,
    });
  } catch (error: any) {
    console.error('Error fetching subscription:', {
      message: error.message,
      stack: error.stack,
      response: error.response,
    });
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || 'Unknown error',
        error_code: 'SUBSCRIPTION_FETCH_FAILED',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}