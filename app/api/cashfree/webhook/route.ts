// pages/api/cashfree/webhook.ts or app/api/cashfree/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

interface CashfreeWebhookPayload {
  type: string;
  order: {
    order_id: string;
    order_amount: number;
    order_currency: string;
    order_status: string;
  };
  payment: {
    cf_payment_id: string;
    payment_status: string;
    payment_amount: number;
    payment_currency: string;
    payment_message: string;
    payment_time: string;
    bank_reference: string;
    auth_id: string;
    payment_method: {
      upi?: {
        channel: string;
        upi_id: string;
      };
      card?: {
        channel: string;
        card_number: string;
        card_network: string;
        card_type: string;
        card_country: string;
        card_bank_name: string;
      };
      netbanking?: {
        channel: string;
        netbanking_bank_name: string;
      };
    };
  };
  customer_details: {
    customer_name: string;
    customer_id: string;
    customer_email: string;
    customer_phone: string;
  };
  data?: {
    order: {
      order_tags?: {
        nuvama_code?: string;
        client_id?: string;
        order_type?: string;
        source?: string;
      };
    };
  };
}

// Function to verify webhook signature
function verifyWebhookSignature(payload: string, signature: string, timestamp: string): boolean {
  try {
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    if (!secretKey) {
      console.error('Cashfree secret key not found');
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(timestamp + payload)
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

// Function to send notification email
async function sendPaymentNotificationEmail(webhookData: CashfreeWebhookPayload) {
  // Import your email service here
  // const { sendEmail } = require('../../email/sendEmail');
  
  const isSuccess = webhookData.payment.payment_status === 'SUCCESS';
  const orderTags = webhookData.data?.order?.order_tags;
  
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Lato, Arial, sans-serif; line-height: 1.6; color: #002017; background-color: #EFECD3; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${isSuccess ? '#02422B' : '#d32f2f'}; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
        .content { background: #FFFFFF; padding: 20px; border: 1px solid #37584F; border-radius: 8px; }
        .info-box { background: #EFECD3; padding: 15px; border-left: 4px solid ${isSuccess ? '#DABD38' : '#d32f2f'}; margin: 15px 0; }
        .success { color: #02422B; }
        .error { color: #d32f2f; }
        h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; }
        h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0;">Payment ${isSuccess ? 'Successful' : 'Failed'}</h1>
        </div>
        <div class="content">
          <p><strong>Payment Status:</strong> 
            <span class="${isSuccess ? 'success' : 'error'}">${webhookData.payment.payment_status}</span>
          </p>
          <p><strong>Order ID:</strong> ${webhookData.order.order_id}</p>
          <p><strong>Payment ID:</strong> ${webhookData.payment.cf_payment_id}</p>
          <p><strong>Date:</strong> ${new Date(webhookData.payment.payment_time).toLocaleString()}</p>
          
          <div class="info-box">
            <h3 style="margin-top: 0;">Transaction Details:</h3>
            <p><strong>Amount:</strong> ₹${webhookData.payment.payment_amount}</p>
            <p><strong>Currency:</strong> ${webhookData.payment.payment_currency}</p>
            <p><strong>Customer:</strong> ${webhookData.customer_details.customer_name}</p>
            <p><strong>Email:</strong> ${webhookData.customer_details.customer_email}</p>
            <p><strong>Phone:</strong> ${webhookData.customer_details.customer_phone}</p>
            ${orderTags?.nuvama_code ? `<p><strong>Account ID:</strong> ${orderTags.nuvama_code}</p>` : ''}
            ${orderTags?.client_id ? `<p><strong>Client ID:</strong> ${orderTags.client_id}</p>` : ''}
            ${orderTags?.order_type ? `<p><strong>Order Type:</strong> ${orderTags.order_type}</p>` : ''}
            ${webhookData.payment.bank_reference ? `<p><strong>Bank Reference:</strong> ${webhookData.payment.bank_reference}</p>` : ''}
          </div>
          
          ${!isSuccess ? `
            <div class="info-box" style="border-left-color: #d32f2f;">
              <h3 style="color: #d32f2f;">Failure Details:</h3>
              <p><strong>Message:</strong> ${webhookData.payment.payment_message}</p>
            </div>
          ` : ''}
          
          <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
            This notification was automatically generated from the Qode investor portal payment gateway.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    // Uncomment and implement your email service
    /*
    await sendEmail({
      to: 'soham.panchal@qodeinvest.com',
      cc: 'payments@qodeinvest.com',
      subject: `Payment ${isSuccess ? 'Success' : 'Failed'} - ${webhookData.order.order_id}`,
      html: emailHtml,
      from: 'payments@qodeinvest.com',
      fromName: 'Qode Payment Gateway',
    });
    */
    console.log('Payment notification email prepared for:', webhookData.order.order_id);
  } catch (error) {
    console.error('Failed to send payment notification email:', error);
  }
}

// Function to update order status in database
async function updateOrderStatus(webhookData: CashfreeWebhookPayload) {
  try {
    // Implement your database update logic here
    // Example:
    /*
    await db.order.update({
      where: { order_id: webhookData.order.order_id },
      data: {
        payment_status: webhookData.payment.payment_status,
        cf_payment_id: webhookData.payment.cf_payment_id,
        payment_time: new Date(webhookData.payment.payment_time),
        bank_reference: webhookData.payment.bank_reference,
        payment_method: JSON.stringify(webhookData.payment.payment_method),
        updated_at: new Date(),
      },
    });
    */
    console.log(`Order ${webhookData.order.order_id} status updated to ${webhookData.payment.payment_status}`);
  } catch (error) {
    console.error('Failed to update order status in database:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the raw payload
    const payload = await request.text();
    const webhookData: CashfreeWebhookPayload = JSON.parse(payload);

    // Get headers for signature verification
    const signature = request.headers.get('x-webhook-signature');
    const timestamp = request.headers.get('x-webhook-timestamp');

    if (!signature || !timestamp) {
      console.error('Missing webhook signature or timestamp');
      return NextResponse.json(
        { error: 'Missing webhook signature or timestamp' },
        { status: 400 }
      );
    }

    // Verify webhook signature
    const isValidSignature = verifyWebhookSignature(payload, signature, timestamp);
    
    if (!isValidSignature) {
      console.error('Invalid webhook signature for order:', webhookData.order?.order_id);
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 403 }
      );
    }

    console.log('Received valid Cashfree webhook for order:', webhookData.order.order_id);
    console.log('Payment status:', webhookData.payment.payment_status);

    // Process different webhook types
    switch (webhookData.type) {
      case 'PAYMENT_SUCCESS_WEBHOOK':
        console.log(`Payment successful for order ${webhookData.order.order_id}`);
        await updateOrderStatus(webhookData);
        await sendPaymentNotificationEmail(webhookData);
        break;

      case 'PAYMENT_FAILED_WEBHOOK':
        console.log(`Payment failed for order ${webhookData.order.order_id}: ${webhookData.payment.payment_message}`);
        await updateOrderStatus(webhookData);
        await sendPaymentNotificationEmail(webhookData);
        break;

      case 'PAYMENT_USER_DROPPED_WEBHOOK':
        console.log(`Payment dropped by user for order ${webhookData.order.order_id}`);
        await updateOrderStatus(webhookData);
        break;

      default:
        console.log('Unknown webhook type:', webhookData.type);
        break;
    }

    // Return success response
    return NextResponse.json({ 
      success: true, 
      message: 'Webhook processed successfully' 
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    
    // Return error response
    return NextResponse.json(
      { 
        error: 'Webhook processing failed', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

// Handle GET request for webhook verification during setup
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge');
  
  if (challenge) {
    return NextResponse.json({ challenge });
  }
  
  return NextResponse.json({ 
    message: 'Cashfree webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
}