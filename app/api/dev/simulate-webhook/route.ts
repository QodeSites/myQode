// POST /api/dev/simulate-webhook
// DEVELOPMENT ONLY — simulates Cashfree webhook events for testing the full
// investment status pipeline without making real payments.
//
// Supports both one-time payment events and SIP subscription events.
// Disabled automatically in production unless ALLOW_SIMULATE_WEBHOOK=true.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

const GUARD = process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATE_WEBHOOK !== 'true'

// ── SIP / subscription webhook payloads ──────────────────────────────────────
const SIP_EVENT_TYPES = [
  'SUBSCRIPTION_ACTIVE',
  'SUBSCRIPTION_PAYMENT_SUCCESS',
  'SUBSCRIPTION_PAYMENT_FAILED',
  'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_COMPLETED',
  'SUBSCRIPTION_ON_HOLD',
  'INSTRUMENT_ACTIVE',
  'INSTRUMENT_FAILED',
] as const
type SipEventType = typeof SIP_EVENT_TYPES[number]

function buildSipWebhookPayload(subscriptionId: string, eventType: SipEventType, amount: number) {
  const now = new Date().toISOString()
  const cfPaymentId = `sim_sip_${Date.now()}`

  const subscriptionStatusMap: Record<SipEventType, string> = {
    SUBSCRIPTION_ACTIVE:          'ACTIVE',
    SUBSCRIPTION_PAYMENT_SUCCESS: 'ACTIVE',
    SUBSCRIPTION_PAYMENT_FAILED:  'ON_HOLD',
    SUBSCRIPTION_CANCELLED:       'CANCELLED',
    SUBSCRIPTION_COMPLETED:       'COMPLETED',
    SUBSCRIPTION_ON_HOLD:         'ON_HOLD',
    INSTRUMENT_ACTIVE:            'ACTIVE',
    INSTRUMENT_FAILED:            'FAILED',
  }

  const base = {
    type: eventType,
    event_time: now,
    data: {
      subscription: {
        subscription_id:     subscriptionId,
        subscription_status: subscriptionStatusMap[eventType],
        plan_id:             'sim_plan',
        plan_type:           'PERIODIC',
        authorization_details: {
          authorization_status: eventType === 'SUBSCRIPTION_ACTIVE' || eventType === 'INSTRUMENT_ACTIVE'
            ? 'SUCCESS' : 'FAILED',
          authorization_time: now,
        },
        next_charge_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // +30 days
      },
    },
  }

  // For charge events, add payment details
  if (eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS' || eventType === 'SUBSCRIPTION_PAYMENT_FAILED') {
    ;(base.data as any).payment = {
      cf_payment_id:    cfPaymentId,
      payment_status:   eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS' ? 'SUCCESS' : 'FAILED',
      payment_amount:   amount,
      payment_currency: 'INR',
      payment_time:     now,
      bank_reference:   eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS' ? `SIM${Date.now()}` : null,
      failure_reason:   eventType === 'SUBSCRIPTION_PAYMENT_FAILED' ? 'Insufficient funds (simulated)' : null,
      payment_method:   { upi: { upi_id: 'testsuccess@gocash' } },
    }
    ;(base.data as any).installment_number = 1
  }

  return base
}

// Simulate all possible Cashfree payment_status values for a given order
function buildWebhookPayload(orderId: string, paymentStatus: string, amount: number) {
  const cfPaymentId = `sim_${Date.now()}`
  const now = new Date().toISOString()

  const typeMap: Record<string, string> = {
    SUCCESS:      'PAYMENT_SUCCESS_WEBHOOK',
    FAILED:       'PAYMENT_FAILED_WEBHOOK',
    USER_DROPPED: 'PAYMENT_USER_DROPPED_WEBHOOK',
    PENDING:      'PAYMENT_SUCCESS_WEBHOOK',   // reuse envelope, status differs
    FLAGGED:      'PAYMENT_FAILED_WEBHOOK',
    CANCELLED:    'PAYMENT_FAILED_WEBHOOK',
    VOID:         'PAYMENT_FAILED_WEBHOOK',
  }

  return {
    type: typeMap[paymentStatus] ?? 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: {
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        order_status: paymentStatus === 'SUCCESS' ? 'PAID' : 'ACTIVE',
        order_tags: {},
      },
      payment: {
        cf_payment_id: cfPaymentId,
        payment_status: paymentStatus,
        payment_amount: amount,
        payment_currency: 'INR',
        payment_message: paymentStatus === 'SUCCESS' ? '00::Transaction success' : 'Simulated failure',
        payment_time: now,
        bank_reference: paymentStatus === 'SUCCESS' ? `SIM${Date.now()}` : 'NA',
        auth_id: null,
        payment_method: {
          upi: { channel: 'collect', upi_id: 'testsuccess@gocash' },
        },
        payment_group: 'upi',
      },
      customer_details: {
        customer_name: 'Test Investor',
        customer_id: 'sim_customer',
        customer_email: 'test@qodeinvest.com',
        customer_phone: '9999999999',
      },
    },
    event_time: now,
  }
}

export async function POST(request: NextRequest) {
  if (GUARD) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    orderId,
    paymentStatus = 'SUCCESS',
    simulateCronToo = false,
    // SIP-specific
    sipEvent,   // e.g. 'SUBSCRIPTION_ACTIVE', 'SUBSCRIPTION_PAYMENT_SUCCESS', etc.
  } = body

  if (!orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  // Fetch the order to get amount + type
  const { rows } = await pool.query(
    `SELECT order_id, amount, nuvama_code, investment_status, payment_type FROM payment_transactions WHERE order_id = $1`,
    [orderId]
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: `Order ${orderId} not found` }, { status: 404 })
  }
  const tx = rows[0]
  const amount = parseFloat(tx.amount)
  const isSip = tx.payment_type === 'SIP' || !!sipEvent

  // ── SIP webhook simulation ────────────────────────────────────────────────
  if (isSip) {
    const event = sipEvent ?? 'SUBSCRIPTION_ACTIVE'
    if (!SIP_EVENT_TYPES.includes(event)) {
      return NextResponse.json({
        error: `sipEvent must be one of: ${SIP_EVENT_TYPES.join(', ')}`,
      }, { status: 400 })
    }

    const devPort = process.env.PORT || process.env.NEXTAUTH_URL?.match(/:(\d+)/)?.[1] || '2069'
    const webhookPayload = buildSipWebhookPayload(orderId, event as SipEventType, amount)

    const webhookRes = await fetch(`http://localhost:${devPort}/api/cashfree/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': 'simulated',
        'x-webhook-timestamp': Date.now().toString(),
      },
      body: JSON.stringify(webhookPayload),
    })
    const webhookResult = await webhookRes.json()

    const { rows: final } = await pool.query(
      `SELECT order_id, payment_status, investment_status, updated_at FROM payment_transactions WHERE order_id = $1`,
      [orderId]
    )
    return NextResponse.json({ simulated: true, sipEvent: event, orderId, webhookFired: webhookResult, finalState: final[0] })
  }

  // ── One-time payment webhook simulation ──────────────────────────────────
  const VALID_STATUSES = ['SUCCESS', 'FAILED', 'USER_DROPPED', 'PENDING', 'FLAGGED', 'CANCELLED', 'VOID']
  if (!VALID_STATUSES.includes(paymentStatus)) {
    return NextResponse.json({ error: `paymentStatus must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  // Fire the simulated webhook against our own local endpoint (always localhost in dev)
  const devPort = process.env.PORT || process.env.NEXTAUTH_URL?.match(/:(\d+)/)?.[1] || '2069'
  const baseUrl = `http://localhost:${devPort}`
  const webhookPayload = buildWebhookPayload(orderId, paymentStatus, amount)

  const webhookRes = await fetch(`${baseUrl}/api/cashfree/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Skip sig check in dev
      'x-webhook-signature': 'simulated',
      'x-webhook-timestamp': Date.now().toString(),
    },
    body: JSON.stringify(webhookPayload),
  })
  const webhookResult = await webhookRes.json()

  let cronResult = null
  if (simulateCronToo && paymentStatus === 'SUCCESS') {
    // Simulate settlement: directly set SETTLED with fake UTR
    await pool.query(
      `UPDATE payment_transactions SET
         investment_status = 'SETTLED',
         settlement_amount = $1,
         transfer_utr      = $2,
         settled_at        = NOW(),
         updated_at        = NOW()
       WHERE order_id = $3`,
      [amount * 0.978, `SIMTRUTR${Date.now()}`, orderId]  // ~2.2% Cashfree fee
    )

    // Simulate deployment: if a cash_in_out match exists, mark deployed
    // Otherwise just report what would happen
    const { rows: deployCheck } = await pool.query(
      `SELECT report_date, cash_in_out FROM pms_master_sheet
       WHERE account_code = $1
         AND cash_in_out BETWEEN $2 AND $3
         AND report_date >= CURRENT_DATE - INTERVAL '7 days'
       LIMIT 1`,
      [tx.nuvama_code, amount * 0.95, amount * 1.05]
    )

    if (deployCheck.length > 0) {
      await pool.query(
        `UPDATE payment_transactions SET
           investment_status = 'DEPLOYED',
           deployed_at       = $1,
           updated_at        = NOW()
         WHERE order_id = $2`,
        [deployCheck[0].report_date, orderId]
      )
      cronResult = { settled: true, deployed: true, deployedOn: deployCheck[0].report_date }
    } else {
      cronResult = { settled: true, deployed: false, reason: 'No matching cash_in_out found in pms_master_sheet yet' }
    }
  }

  // Fetch final state
  const { rows: final } = await pool.query(
    `SELECT order_id, payment_status, investment_status, cf_payment_id,
            settlement_amount, transfer_utr, settled_at, deployed_at
     FROM payment_transactions WHERE order_id = $1`,
    [orderId]
  )

  return NextResponse.json({
    simulated: true,
    orderId,
    requestedPaymentStatus: paymentStatus,
    webhookFired: webhookResult,
    cronSimulated: cronResult,
    finalState: final[0],
  })
}

// GET — list all orders available to simulate against
export async function GET(request: NextRequest) {
  if (GUARD) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const { rows } = await pool.query(
    `SELECT order_id, nuvama_code, client_name, amount, payment_status, investment_status, created_at
     FROM payment_transactions
     ORDER BY created_at DESC
     LIMIT 50`
  )

  return NextResponse.json({
    orders: rows,
    sandboxTestData: {
      upi: {
        success: 'testsuccess@gocash',
        failure: 'testfailure@gocash',
        userDropped: 'testuserdropped@gocash',
        insufficientFunds: 'testinsufficientfunds@gocash',
        pending: 'testtimeoutbank@gocash',
      },
      cards: {
        visaDebit: { number: '4706131211212123', expiry: '03/2028', cvv: '123', otp: '111000' },
        visaCredit: { number: '4576238912771450', expiry: '03/2028', cvv: '123', otp: '111000' },
        mastercardCredit: { number: '5105105105105100', expiry: '03/2028', cvv: '123', otp: '111000' },
        rupayDebit: { number: '6074825972083818', expiry: '03/2028', cvv: '123', otp: '111000' },
      },
      netBanking: { bank: 'TEST Bank', code: '3333' },
      paylater: { mobile: '8714268343', pan4: '1234', otp: '777777' },
    },
    howToSimulate: {
      oneTimePayment: {
        step1: 'POST /api/dev/simulate-webhook { orderId, paymentStatus: "SUCCESS" }',
        step2: 'Add simulateCronToo: true to also simulate SETTLED + DEPLOYED in one shot',
        step3: 'GET /api/mobile/payments/investment-status?accountId=XXX to verify',
      },
      sipSubscription: {
        step1: 'POST /api/dev/simulate-webhook { orderId: "<sip_order_id>", sipEvent: "SUBSCRIPTION_ACTIVE" }',
        step2: 'Then POST { orderId, sipEvent: "SUBSCRIPTION_PAYMENT_SUCCESS" } to simulate a charge',
        step3: 'Also try: SUBSCRIPTION_PAYMENT_FAILED, SUBSCRIPTION_CANCELLED, SUBSCRIPTION_COMPLETED',
      },
      sipEvents: SIP_EVENT_TYPES,
    },
  })
}
