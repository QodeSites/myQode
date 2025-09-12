import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Cashfree, CFEnvironment } from 'cashfree-pg';

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

interface CashfreeSubscriptionResponse {
  subscription_id: string;
  cf_subscription_id: string;
  subscription_session_id: string;
  subscription_status: string;
  plan_details: any;
  subscription_first_charge_time: string;
  subscription_expiry_time: string;
  next_schedule_date?: string;
}

// ─────────────────────────────────────────────────────────────
// Helper functions
function generateOrderId(): string {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `qode_${ts}_${rnd}`;
}

// Mock function - replace with your actual implementation
async function fetchAccountDetails(nuvama_code: string): Promise<AccountDetails> {
  // Replace this with your actual account fetching logic
  console.log('Fetching account details for:', nuvama_code);
  
  // Mock data for demonstration
  return {
    client_name: 'John Doe',
    account_number: '1234567890123456',
    ifsc_code: 'HDFC0001234',
    phone_number: '9876543210'
  };
}

// Mock database functions - replace with your actual implementations
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
  next_charge_date: string | null;
}) {
  console.log('Storing SIP details:', data);
}

// Initialize Cashfree SDK
const initializeCashfree = () => {
  console.log("=== INITIALIZE CASHFREE SDK ===");

  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const environment = process.env.CASHFREE_ENVIRONMENT === 'production' 
    ? CFEnvironment.PRODUCTION 
    : CFEnvironment.SANDBOX;

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials not found in environment variables");
  }

  try {
    console.log("Initializing Cashfree SDK with environment:", environment);
    const cashfree = new Cashfree(environment, clientId, clientSecret);
    console.log("Cashfree SDK initialized successfully");
    return cashfree;
  } catch (error) {
    console.error("Failed to initialize Cashfree SDK:", error);
    throw error;
  }
};

export async function POST(request: NextRequest) {
  console.log("=== CREATE CASHFREE SIP ORDER ===");
  let responseData = null;

  try {
    const body: CreateSipOrderRequest = await request.json();
    const { order_amount, nuvama_code, sip_details = {}, order_meta = {} } = body;
    
    console.log("Request Body:", body);

    // Validate required fields
    if (!order_amount || !nuvama_code || !sip_details.frequency || !sip_details.start_date) {
      return NextResponse.json({
        success: false,
        message: "Missing required fields: order_amount, nuvama_code, frequency, or start_date"
      }, { status: 400 });
    }

    if (isNaN(order_amount) || parseFloat(order_amount.toString()) < 1) {
      return NextResponse.json({
        success: false,
        message: "Amount must be a number and minimum ₹1"
      }, { status: 400 });
    }

    // Validate date fields
    const startDate = sip_details.start_date ? new Date(sip_details.start_date) : null;
    if (!startDate || isNaN(startDate.getTime())) {
      return NextResponse.json({
        success: false,
        message: "Invalid start_date format. Use YYYY-MM-DD"
      }, { status: 400 });
    }

    const endDate = sip_details.end_date ? new Date(sip_details.end_date) : null;
    if (sip_details.end_date && (!endDate || isNaN(endDate.getTime()))) {
      return NextResponse.json({
        success: false,
        message: "Invalid end_date format. Use YYYY-MM-DD or omit for null"
      }, { status: 400 });
    }

    // Fetch account details
    const accountDetails = await fetchAccountDetails(nuvama_code);
    const phoneRegex = /^[0-9]{10}$/;
    const customerPhone = (accountDetails.phone_number && phoneRegex.test(accountDetails.phone_number))
      ? accountDetails.phone_number
      : "9999999999";

    console.log("Account details fetched for TPV:", {
      nuvama_code,
      client_name: accountDetails.client_name,
      account_masked: `***${accountDetails.account_number.slice(-4)}`,
      ifsc_code: accountDetails.ifsc_code,
      phone_number: customerPhone
    });

    if (!accountDetails.account_number || !accountDetails.ifsc_code) {
      throw new Error("Missing required TPV fields: account_number or ifsc_code");
    }

    const subscription_id = `SUB_${generateOrderId()}`;
    
    // Map frequency to Cashfree interval types
    const intervalTypeMap = {
      daily: "DAY",
      weekly: "WEEK",
      monthly: "MONTH",
      quarterly: "MONTH",
      yearly: "YEAR",
      custom: "MONTH"
    };

    const intervalType = intervalTypeMap[sip_details.frequency.toLowerCase() as keyof typeof intervalTypeMap] || "MONTH";
    const planIntervals = sip_details.frequency.toLowerCase() === "quarterly" ? 3 :
      sip_details.frequency.toLowerCase() === "custom" ? 1 :
      {
        daily: 1,
        weekly: 1,
        monthly: 1,
        yearly: 12
      }[sip_details.frequency.toLowerCase() as keyof typeof intervalTypeMap] || 1;

    // Bank code mapping
    const bankCodeMapping: { [key: string]: string } = {
      'ICIC': 'ICIC',
      'HDFC': 'HDFC',
      'SBIN': 'SBI',
      'AXIS': 'AXIS',
      'YESB': 'YES',
      'INDB': 'INDIAN',
      'KKBK': 'KOTAK',
      'CITI': 'CITI',
      'SCBL': 'SC',
      'UTIB': 'AXIS'
    };

    const ifscPrefix = accountDetails.ifsc_code ? accountDetails.ifsc_code.substring(0, 4) : '';
    const customerBankCode = bankCodeMapping[ifscPrefix] || 'OTHER';
    const baseReturn = order_meta.return_url || `${request.nextUrl.origin}/payment-result`;

    // Build subscription request
    const subscriptionRequest = {
      subscription_id,
      customer_details: {
        customer_name: String(accountDetails.client_name),
        customer_bank_account_holder_name: String(accountDetails.client_name),
        customer_email: `${nuvama_code}@nuvama.com`,
        customer_phone: String(customerPhone),
        customer_bank_account_number: String(accountDetails.account_number),
        customer_bank_ifsc: String(accountDetails.ifsc_code),
        customer_bank_code: String(customerBankCode),
        customer_bank_account_type: "SAVINGS"
      },
      plan_details: {
        plan_name: `SIP_${nuvama_code}_${Date.now()}`,
        plan_type: "PERIODIC",
        plan_amount: parseFloat(order_amount.toString()),
        plan_max_amount: parseFloat(order_amount.toString()) * 100,
        plan_max_cycles: sip_details.total_installments ? parseInt(sip_details.total_installments) : 100,
        plan_intervals: planIntervals,
        plan_currency: "INR",
        plan_interval_type: intervalType,
        plan_note: `SIP for ${accountDetails.client_name} - ₹${parseFloat(order_amount.toString()).toFixed(2)} ${sip_details.frequency}`
      },
      authorization_details: {
        authorization_amount: parseFloat(order_amount.toString()),
        authorization_amount_refund: true,
        payment_methods: ["enach", "pnach", "upi", "card"]
      },
      subscription_meta: {
        return_url: `${baseReturn}?subscription_id=${subscription_id}`,
        notification_channel: ["EMAIL", "SMS"]
      },
      subscription_first_charge_time: startDate.toISOString(),
      subscription_expiry_time: endDate ? endDate.toISOString() : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      subscription_note: `Nuvama Code: ${nuvama_code} SIP Amount: ₹${parseFloat(order_amount.toString()).toFixed(2)}`,
      subscription_tags: {
        nuvama_code,
        client_name: accountDetails.client_name
      }
    };

    console.log("Subscription Request:", JSON.stringify({
      ...subscriptionRequest,
      customer_details: {
        ...subscriptionRequest.customer_details,
        customer_phone: "***" + customerPhone.slice(-4),
        customer_bank_account_number: `***${accountDetails.account_number.slice(-4)}`
      }
    }, null, 2));

    try {
      // Initialize Cashfree SDK
      const cashfree = initializeCashfree();

      // Create subscription using SDK
      const response = await cashfree.SubsCreateSubscription(subscriptionRequest);
      responseData = response.data || response;

      console.log("CashFree Subscription Creation Response:", responseData);

      if (!responseData || !responseData.subscription_session_id) {
        console.error("Missing subscription_session_id in response:", responseData);
        throw new Error("Failed to create subscription session - missing subscription_session_id");
      }

      if (responseData.subscription_status !== 'INITIALIZED') {
        console.error("Unexpected subscription status:", responseData.subscription_status);
        throw new Error(`Subscription creation failed - status: ${responseData.subscription_status}`);
      }

      // Store transaction and SIP details
      // Note: In Next.js, you'd typically use a proper database transaction here
      const transactionId = await storePaymentTransaction({
        order_id: subscription_id,
        nuvama_code,
        amount: parseFloat(order_amount.toString()),
        account_number: accountDetails.account_number,
        ifsc_code: accountDetails.ifsc_code,
        client_name: accountDetails.client_name,
        payment_session_id: responseData.subscription_session_id,
        payment_status: 'INITIALIZED',
        payment_type: 'SIP',
        cf_subscription_id: responseData.cf_subscription_id
      });

      await storeSipDetails({
        payment_transaction_id: transactionId,
        subscription_id: responseData.subscription_id,
        frequency: sip_details.frequency,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate ? endDate.toISOString().split('T')[0] : null,
        total_installments: sip_details.total_installments,
        next_charge_date: responseData.next_schedule_date ? new Date(responseData.next_schedule_date).toISOString().split('T')[0] : null
      });

      return NextResponse.json({
        success: true,
        data: {
          order_id: subscription_id,
          subscription_id: responseData.subscription_id,
          cf_subscription_id: responseData.cf_subscription_id,
          subscription_session_id: responseData.subscription_session_id,
          subscription_status: responseData.subscription_status,
          order_amount: parseFloat(order_amount.toString()),
          order_currency: "INR",
          checkout_url: `${process.env.CASHFREE_ENVIRONMENT === 'production' ? 'https://checkout.cashfree.com' : 'https://sandbox.cashfree.com'}/subscription/${responseData.subscription_session_id}`,
          customer_bank_account_number: accountDetails.account_number,
          customer_bank_ifsc: accountDetails.ifsc_code,
          customer_bank_code: customerBankCode,
          plan_details: responseData.plan_details,
          subscription_first_charge_time: responseData.subscription_first_charge_time,
          subscription_expiry_time: responseData.subscription_expiry_time,
          sip_details: {
            frequency: sip_details.frequency,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate ? endDate.toISOString().split('T')[0] : null,
            total_installments: sip_details.total_installments,
            next_charge_date: responseData.next_schedule_date ? new Date(responseData.next_schedule_date).toISOString().split('T')[0] : null
          },
          tpv_enabled: true,
          tpv_details: {
            nuvama_code,
            client_name: accountDetails.client_name,
            account_number_masked: `***${accountDetails.account_number.slice(-4)}`,
            ifsc_code: accountDetails.ifsc_code,
            tpv_enabled: true
          }
        }
      });

    } catch (error: any) {
      console.error("Subscription Creation Error:", {
        message: error.message,
        response: responseData
      });
      throw error;
    }

  } catch (error: any) {
    console.error("Subscription Creation Error:", error);
    return NextResponse.json({
      success: false,
      message: error.message || "Failed to create subscription",
      error_code: responseData?.code || "SUBSCRIPTION_CREATION_FAILED",
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Optional: Add a GET method to fetch subscription details
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscription_id');
    
    if (!subscriptionId) {
      return NextResponse.json({ 
        error: 'Subscription ID is required' 
      }, { status: 400 });
    }

    // Initialize Cashfree SDK
    const cashfree = initializeCashfree();
    
    // Fetch subscription details
    const response = await cashfree.SubsFetchSubscription(subscriptionId);
    const subscriptionData = response.data || response;

    return NextResponse.json({
      success: true,
      ...subscriptionData
    });

  } catch (error: any) {
    console.error('Error fetching subscription:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error.message || 'Unknown error',
      error_code: 'SUBSCRIPTION_FETCH_FAILED',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}