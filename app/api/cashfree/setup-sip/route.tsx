import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import pool from '@/lib/db';
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
  account_number?: string;
  ifsc_code?: string;
  cashfree_bank_code?: string;
  client_id?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
}

interface AccountDetails {
  client_name: string;
  account_number: string;
  ifsc_code: string;
  phone_number?: string;
}

interface CashfreeSubscriptionResponse {
  subscription_id: string;
  cf_subscription_id: string;
  subscription_status: string;
  subscription_session_id: string;
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

// Create Subscription (Direct approach without separate plan creation)
const createSubscription = async (subscriptionData: any): Promise<CashfreeSubscriptionResponse> => {
  return await makeCashfreeRequest('/subscriptions', 'POST', subscriptionData, '2025-01-01');
};

export async function POST(request: NextRequest) {
  console.log('=== CREATE CASHFREE SIP ORDER (DIRECT SUBSCRIPTION FLOW) ===');

  try {
    const body: CreateSipOrderRequest = await request.json();
    console.log('Request Body:', JSON.stringify(body, null, 2));

    const {
      order_amount,
      nuvama_code,
      sip_details = {},
      order_meta = {},
      account_number,
      ifsc_code,
      cashfree_bank_code,
      customer_name,
      customer_email,
      customer_phone,
    } = body;

    // Validate required fields
    const requiredFields = [
      'order_amount',
      'nuvama_code',
      'sip_details.frequency',
      'sip_details.start_date',
      'account_number',
      'ifsc_code',
      'customer_name',
      'customer_email',
      'customer_phone',
    ];
    const missingFields = requiredFields.filter(field => {
      const [parent, child] = field.split('.');
      return child ? !body[parent]?.[child] : !body[field];
    });
    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate amount
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

    // Validate phone number
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(customer_phone)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid customer_phone format. Must be a 10-digit number',
        },
        { status: 400 }
      );
    }

    // Log customer details for TPV
    console.log('Customer details for TPV:', {
      nuvama_code,
      client_name: customer_name,
      account_masked: `***${account_number.slice(-4)}`,
      ifsc_code,
      phone_number: customer_phone,
    });

    const subscription_id = `SUB_${generateOrderId()}`;

    // Map frequency to Cashfree interval types and calculate intervals
    const getIntervalConfig = (frequency: string) => {
      const freq = frequency.toLowerCase();
      switch (freq) {
        case 'daily':
          return { intervalType: 'DAY', intervals: 1 };
        case 'weekly':
          return { intervalType: 'WEEK', intervals: 1 };
        case 'monthly':
          return { intervalType: 'MONTH', intervals: 1 };
        case 'quarterly':
          return { intervalType: 'MONTH', intervals: 3 };
        case 'yearly':
          return { intervalType: 'YEAR', intervals: 1 };
        default:
          return { intervalType: 'MONTH', intervals: 1 };
      }
    };

    const { intervalType, intervals } = getIntervalConfig(sip_details.frequency);

    // Bank code mapping (fallback if cashfree_bank_code is not provided)
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

    // Create Subscription Request
    const subscriptionRequest = {
      subscription_id,
      customer_details: {
        customer_name: String(customer_name),
        customer_email: String(customer_email),
        customer_phone: String(customer_phone),
        customer_bank_account_number: String(account_number),
        customer_bank_account_holder_name: String(customer_name),
        customer_bank_ifsc: String(ifsc_code),
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
        authorization_amount: parseFloat(order_amount.toString()) * 100,
        authorization_amount_refund: true,
        payment_methods: ['enach', 'pnach', 'upi', 'card'],
      },
      subscription_meta: {
        return_url: `${baseReturn}?subscription_id=${subscription_id}`,
        notification_channel: ['EMAIL', 'SMS'],
      },
      subscription_expiry_time: formatDateWithTimezone(actualEndDate),
      subscription_first_charge_time: formatDateWithTimezone(actualStartDate),
      subscription_note: sanitizeDescription(`Nuvama_SIP_${nuvama_code}`),
      subscription_tags: {
        nuvama_code,
        client_name: customer_name,
        frequency: sip_details.frequency,
        psp_note: `${sip_details.frequency} subscription payment`,
      },
    };

    console.log(
      'Subscription Request:',
      JSON.stringify(
        {
          ...subscriptionRequest,
          customer_details: {
            ...subscriptionRequest.customer_details,
            customer_phone: '***' + customer_phone.slice(-4),
            customer_bank_account_number: `***${account_number.slice(-4)}`,
          },
        },
        null,
        2
      )
    );

    const subscriptionResponse = await createSubscription(subscriptionRequest);
    console.log('Subscription Created:', subscriptionResponse);

    if (!subscriptionResponse.subscription_session_id) {
      console.error('Missing subscription_session_id in response:', subscriptionResponse);
      throw new Error('Failed to create subscription session - missing subscription_session_id');
    }

    if (subscriptionResponse.subscription_status !== 'INITIALIZED') {
      console.error('Unexpected subscription status:', subscriptionResponse.subscription_status);
      throw new Error(`Subscription creation failed - status: ${subscriptionResponse.subscription_status}`);
    }

    // Store transaction and SIP details
    const result = await pool.query(
      `INSERT INTO payment_transactions (
    order_id, client_id, nuvama_code, client_name, amount, currency, payment_type,
    payment_status, payment_session_id, cf_subscription_id, account_number, ifsc_code,
    frequency, start_date, end_date, total_installments, next_charge_date, created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  RETURNING id`,
      [
        subscriptionResponse.subscription_id,
        client_id || customer_phone, // Use customer_phone as fallback
        nuvama_code,
        customer_name,
        parseFloat(order_amount.toString()),
        'INR',
        'SIP',
        subscriptionResponse.subscription_status || 'INITIALISED',
        subscriptionResponse.subscription_session_id,
        subscriptionResponse.cf_subscription_id,
        account_number,
        ifsc_code,
        sip_details.frequency,
        actualStartDate.toISOString().split('T')[0],
        actualEndDate ? actualEndDate.toISOString().split('T')[0] : null,
        sip_details.total_installments || null,
        subscriptionResponse.next_schedule_date
          ? new Date(subscriptionResponse.next_schedule_date).toISOString().split('T')[0]
          : null,
        new Date(subscriptionResponse.authorization_details.authorization_time),
      ]
    );
    console.log('Inserted SIP transaction with ID:', result.rows[0].id);


    return NextResponse.json({
      success: true,
      data: {
        order_id: subscription_id,
        subscription_id: subscriptionResponse.subscription_id,
        cf_subscription_id: subscriptionResponse.cf_subscription_id,
        subscription_status: subscriptionResponse.subscription_status,
        order_amount: parseFloat(order_amount.toString()),
        order_currency: 'INR',
        checkout_url: subscriptionResponse.subscription_session_id,
        customer_bank_account_number: account_number,
        customer_bank_ifsc: ifsc_code,
        customer_bank_code: String(customerBankCode),
        plan_details: subscriptionResponse.plan_details,
        subscription_first_charge_time: subscriptionResponse.subscription_first_charge_time,
        subscription_expiry_time: subscriptionResponse.subscription_expiry_time,
        sip_details: {
          frequency: sip_details.frequency,
          start_date: actualStartDate.toISOString().split('T')[0],
          end_date: actualEndDate ? actualEndDate.toISOString().split('T')[0] : null,
          total_installments: sip_details.total_installments,
          next_charge_date: subscriptionResponse.next_schedule_date
            ? new Date(subscriptionResponse.next_schedule_date).toISOString().split('T')[0]
            : null,
        },
        tpv_enabled: true,
        tpv_details: {
          nuvama_code,
          client_name: customer_name,
          account_number_masked: `***${account_number.slice(-4)}`,
          ifsc_code,
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
        if (norm === 'INITIALIZED' || norm === 'BANK_APPROVAL_PENDING' || norm === 'PENDING' || norm === 'ON_HOLD' || norm === 'PAUSED') return 'PENDING';
        if (norm === 'COMPLETED' || norm === 'CUSTOMER_CANCELLED' || norm === 'CUSTOMER_PAUSED' || norm === 'EXPIRED' || norm === 'LINK_EXPIRED') return 'CANCELLED';
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
          payment_methods: ["enach", "pnach", "upi", "card"]
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