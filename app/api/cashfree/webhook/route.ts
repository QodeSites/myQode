// POST /api/cashfree/webhook
// Handles ALL Cashfree webhook event types — one-time payments, settlements,
// refunds, disputes, and SIP subscription / instrument events.
//
// Design rules:
//  - Always return HTTP 200. Cashfree retries on non-2xx.
//  - investment_status is NEVER downgraded from a terminal state by a stale event.
//  - SIP events write to BOTH payment_transactions (subscription-level)
//    AND sip_charges (per-installment).
//  - Notifications are fire-and-forget (never fail the webhook).
//  - Idempotency: unique index on sip_charges.cf_payment_id prevents duplicate rows.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import pool from '@/lib/db'
import { notifyClientById } from '@/lib/notifications'

// ── Signature verification ────────────────────────────────────────────────────
function verifyWebhookSignature(
  rawPayload: string,
  signature:  string,
  timestamp:  string,
): boolean {
  try {
    const secret = process.env.CASHFREE_SECRET_KEY
    if (!secret) { console.error('[webhook] CASHFREE_SECRET_KEY not set'); return false }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(timestamp + rawPayload)
      .digest('base64')
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ── Map Cashfree payment_status → Qode investment_status ─────────────────────
function toInvestmentStatus(paymentStatus: string): string {
  switch (paymentStatus.toUpperCase()) {
    case 'SUCCESS':      return 'PAYMENT_SUCCESS'
    case 'FAILED':       return 'PAYMENT_FAILED'
    case 'FLAGGED':      return 'PAYMENT_FAILED'
    case 'USER_DROPPED': return 'PENDING_PAYMENT'   // user bailed — let them retry
    case 'PENDING':      return 'PENDING_PAYMENT'
    case 'CANCELLED':    return 'CANCELLED'
    case 'VOID':         return 'CANCELLED'
    default:             return 'PENDING_PAYMENT'
  }
}

// ── Safely extract nested fields from both v2023-08-01 & v2025-01-01 shapes ──
function extractParts(data: any) {
  const d = data.data ?? data
  return {
    order:        d.order        ?? null,
    payment:      d.payment      ?? null,
    customer:     d.customer_details ?? null,
    settlement:   d.settlement   ?? null,
    refund:       d.refund       ?? null,
    dispute:      d.dispute      ?? null,
    subscription: d.subscription ?? null,
    instrument:   d.instrument   ?? null,
  }
}

// ── Fetch client_id for a subscription_id ────────────────────────────────────
async function getClientId(subscriptionId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT client_id FROM payment_transactions WHERE order_id = $1 LIMIT 1',
    [subscriptionId]
  )
  return rows[0]?.client_id ?? null
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONE-TIME PAYMENT EVENTS
// Covers: PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK,
//         PAYMENT_USER_DROPPED_WEBHOOK, ORDER_PAID,
//         PAYMENT_VERIFICATION_UPDATE, TERMINAL_STATUS_UPDATE,
//         ABANDONED_CHECKOUT, SUCCESS_PAYMENT_TDR
// ═══════════════════════════════════════════════════════════════════════════════
async function handlePaymentEvent(data: any): Promise<void> {
  const { order, payment } = extractParts(data)
  if (!order?.order_id || !payment) {
    console.warn('[webhook] Payment event missing order/payment:', data.type)
    return
  }

  const orderId       = order.order_id
  const paymentStatus = (payment.payment_status ?? 'UNKNOWN').toUpperCase()
  const investStatus  = toInvestmentStatus(paymentStatus)

  console.log(`[webhook] ${data.type} order=${orderId} cf_status=${paymentStatus} → invest=${investStatus}`)

  const { rows } = await pool.query(
    `UPDATE payment_transactions SET
       payment_status    = $1,
       cf_payment_id     = COALESCE($2, cf_payment_id),
       payment_time      = COALESCE($3, payment_time),
       bank_reference    = COALESCE($4, bank_reference),
       payment_method    = COALESCE($5, payment_method),
       payment_message   = COALESCE($6, payment_message),
       auth_id           = COALESCE($7, auth_id),
       investment_status = CASE
         -- Never downgrade a terminal status from a stale/duplicate event
         WHEN investment_status IN ('DEPLOYED','SETTLED','CANCELLED','PAYMENT_FAILED','EXPIRED')
           THEN investment_status
         ELSE $8
       END,
       updated_at = NOW()
     WHERE order_id = $9
     RETURNING client_id, amount, investment_status, strategy_type, nuvama_code`,
    [
      paymentStatus,
      payment.cf_payment_id   ?? null,
      payment.payment_time    ? new Date(payment.payment_time) : null,
      payment.bank_reference  ?? null,
      payment.payment_method  ? JSON.stringify(payment.payment_method) : null,
      payment.payment_message ?? null,
      payment.auth_id         ?? null,
      investStatus,
      orderId,
    ]
  )

  if (!rows.length) {
    console.warn('[webhook] No transaction found for order_id:', orderId)
    return
  }

  const tx = rows[0]

  // Fire notifications for state changes that matter to the user
  if (investStatus === 'PAYMENT_SUCCESS') {
    notifyClientById(tx.client_id, 'PAYMENT_SUCCESS', {
      amount:       parseFloat(tx.amount),
      orderId,
      strategyType: tx.strategy_type ?? undefined,
    }).catch(() => {})
  } else if (investStatus === 'PAYMENT_FAILED') {
    notifyClientById(tx.client_id, 'PAYMENT_FAILED', {
      amount:        parseFloat(tx.amount),
      orderId,
      failureReason: payment.payment_message ?? undefined,
    }).catch(() => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT EVENTS
// Covers: SETTLEMENT_SUCCESS, SETTLEMENT_INITIATED, SETTLEMENT_FAILED,
//         SETTLEMENT_REVERSED, ICA_SETTLEMENT_UPDATE,
//         TXN_WISE_SETTLEMENT_SUCCESS, TXN_WISE_SETTLEMENT_INITIATED,
//         TXN_WISE_SETTLEMENT_FAILED, TXN_WISE_SETTLEMENT_REVERSED
// ═══════════════════════════════════════════════════════════════════════════════
async function handleSettlementEvent(data: any): Promise<void> {
  const { settlement, order } = extractParts(data)
  const eventType = data.type ?? ''

  const isSuccess  = eventType.includes('SUCCESS')  && !eventType.includes('FAILED') && !eventType.includes('REVERSED')
  const isReversed = eventType.includes('REVERSED')
  const isFailed   = eventType.includes('FAILED')

  const orderId    = settlement?.order_id ?? order?.order_id ?? null
  const transferUtr = settlement?.transfer_utr ?? settlement?.settlement_utr ?? null
  const settledAmt  = settlement?.settlement_amount ?? null

  if (!orderId) {
    console.warn('[webhook] Settlement event missing order_id:', eventType)
    return
  }

  console.log(`[webhook] ${eventType} order=${orderId} utr=${transferUtr} success=${isSuccess}`)

  if (isSuccess && transferUtr) {
    const { rows } = await pool.query(
      `UPDATE payment_transactions SET
         investment_status = CASE
           WHEN investment_status = 'PAYMENT_SUCCESS' THEN 'SETTLED'
           ELSE investment_status
         END,
         settlement_amount = COALESCE($1, settlement_amount),
         transfer_utr      = COALESCE($2, transfer_utr),
         settled_at        = COALESCE(settled_at, NOW()),
         updated_at        = NOW()
       WHERE order_id = $3
       RETURNING client_id, amount, investment_status`,
      [settledAmt, transferUtr, orderId]
    )

    if (rows[0]?.investment_status === 'SETTLED') {
      notifyClientById(rows[0].client_id, 'SETTLED', {
        amount:  parseFloat(rows[0].amount),
        orderId,
      }).catch(() => {})
    }
  } else if (isReversed) {
    await pool.query(
      `UPDATE payment_transactions SET
         investment_status = 'PAYMENT_FAILED',
         payment_message   = 'Settlement reversed by Cashfree',
         updated_at        = NOW()
       WHERE order_id = $1
         AND investment_status NOT IN ('DEPLOYED')`,
      [orderId]
    )
  } else if (isFailed) {
    // Don't change investment_status — cron will retry via Cashfree settlements API
    console.warn(`[webhook] Settlement FAILED for order=${orderId} — cron will retry`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFUND EVENTS
// Covers: AUTO_REFUND_INITIATED, AUTO_REFUND, REFUND_STATUS_WEBHOOK,
//         REFUND_USER_COMMUNICATION_FAILED
// ═══════════════════════════════════════════════════════════════════════════════
async function handleRefundEvent(data: any): Promise<void> {
  const { refund, order } = extractParts(data)
  const orderId = refund?.order_id ?? order?.order_id ?? null
  if (!orderId) { console.warn('[webhook] Refund event missing order_id'); return }

  const refundStatus = (refund?.refund_status ?? 'UNKNOWN').toUpperCase()
  console.log(`[webhook] ${data.type} order=${orderId} refund_status=${refundStatus}`)

  if (refundStatus === 'SUCCESS') {
    await pool.query(
      `UPDATE payment_transactions SET
         investment_status = 'CANCELLED',
         payment_message   = COALESCE($1, payment_message),
         updated_at        = NOW()
       WHERE order_id = $2
         AND investment_status NOT IN ('DEPLOYED')`,
      [`Refund processed: ${refund?.refund_id ?? ''}`, orderId]
    )
  }
  // PENDING / INITIATED / FAILED refund status changes are logged only
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPUTE EVENTS
// Covers: DISPUTE_CREATED, DISPUTE_UPDATED, DISPUTE_CLOSED
// ═══════════════════════════════════════════════════════════════════════════════
async function handleDisputeEvent(data: any): Promise<void> {
  const { dispute, order } = extractParts(data)
  const orderId = dispute?.order_id ?? order?.order_id ?? null
  console.log(`[webhook] ${data.type} order=${orderId} status=${dispute?.dispute_status} — logged only (ops handles disputes)`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIP: SUBSCRIPTION EVENTS
// Covers: SUBSCRIPTION_ACTIVE, SUBSCRIPTION_PAYMENT_INITIATED,
//         SUBSCRIPTION_PAYMENT_SUCCESS, SUBSCRIPTION_PAYMENT_FAILED,
//         SUBSCRIPTION_CANCELLED, SUBSCRIPTION_COMPLETED,
//         SUBSCRIPTION_HOLD, SUBSCRIPTION_PAUSED, SUBSCRIPTION_EXPIRED
// ═══════════════════════════════════════════════════════════════════════════════
async function handleSubscriptionEvent(data: any): Promise<void> {
  const eventType = (data.type ?? '').toUpperCase()
  const { subscription, payment } = extractParts(data)

  const subscriptionId = subscription?.subscription_id ?? data.data?.subscription_id ?? null
  if (!subscriptionId) {
    console.warn('[webhook] Subscription event missing subscription_id:', eventType)
    return
  }

  console.log(`[webhook] ${eventType} subscription=${subscriptionId}`)

  // ── SUBSCRIPTION_ACTIVE: mandate approved, SIP is live ───────────────────
  if (eventType === 'SUBSCRIPTION_ACTIVE') {
    const nextChargeDate = subscription?.next_charge_time
      ? new Date(subscription.next_charge_time).toISOString().split('T')[0]
      : null

    const { rows } = await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = 'ACTIVE',
         investment_status = 'SIP_ACTIVE',
         next_charge_date  = COALESCE($1::date, next_charge_date),
         updated_at        = NOW()
       WHERE order_id = $2
       RETURNING client_id, amount, frequency, next_charge_date`,
      [nextChargeDate, subscriptionId]
    )

    if (rows[0]) {
      notifyClientById(rows[0].client_id, 'SIP_ACTIVE', {
        amount:          parseFloat(rows[0].amount),
        subscriptionId,
        frequency:       rows[0].frequency ?? undefined,
        nextChargeDate:  rows[0].next_charge_date ?? nextChargeDate ?? undefined,
      }).catch(() => {})
    }
    return
  }

  // ── SUBSCRIPTION_PAYMENT_INITIATED: charge about to be debited ──────────
  if (eventType === 'SUBSCRIPTION_PAYMENT_INITIATED') {
    const chargeDate = subscription?.charge_date
      ? new Date(subscription.charge_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]

    const clientId = await getClientId(subscriptionId)

    // Insert an INITIATED charge record — will be updated to SUCCESS/FAILED by subsequent event
    await pool.query(
      `INSERT INTO sip_charges (
         subscription_id, cf_subscription_id, nuvama_code, client_id,
         installment_number, charge_amount, charge_status,
         charge_date, created_at, updated_at
       )
       SELECT $1, cf_subscription_id, nuvama_code, client_id,
              $2, amount, 'INITIATED',
              $3, NOW(), NOW()
       FROM payment_transactions
       WHERE order_id = $1
       ON CONFLICT DO NOTHING`,
      [
        subscriptionId,
        subscription?.installment_number ?? null,
        chargeDate,
      ]
    )
    return
  }

  // ── SUBSCRIPTION_PAYMENT_SUCCESS: installment debited successfully ───────
  if (eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
    const chargeAmount    = payment?.payment_amount ?? subscription?.charge_amount ?? null
    const cfPaymentId     = payment?.cf_payment_id  ?? null
    const paymentTime     = payment?.payment_time    ? new Date(payment.payment_time) : null
    const bankReference   = payment?.bank_reference  ?? null
    const paymentMethod   = payment?.payment_method  ?? null
    const installmentNum  = subscription?.installment_number ?? data.data?.installment_number ?? null
    const nextChargeDate  = subscription?.next_charge_time
      ? new Date(subscription.next_charge_time).toISOString().split('T')[0]
      : null

    // Upsert the sip_charges record (insert new or update the INITIATED placeholder)
    await pool.query(
      `INSERT INTO sip_charges (
         subscription_id, cf_subscription_id, nuvama_code, client_id,
         installment_number, charge_amount, charge_status,
         cf_payment_id, payment_time, bank_reference, payment_method,
         charge_date, created_at, updated_at
       )
       SELECT $1, cf_subscription_id, nuvama_code, client_id,
              $2, COALESCE($3, amount), 'SUCCESS',
              $4, $5, $6, $7,
              COALESCE($5::date, CURRENT_DATE), NOW(), NOW()
       FROM payment_transactions
       WHERE order_id = $1
       ON CONFLICT (cf_payment_id) DO UPDATE SET
         charge_status  = 'SUCCESS',
         payment_time   = EXCLUDED.payment_time,
         bank_reference = EXCLUDED.bank_reference,
         payment_method = EXCLUDED.payment_method,
         updated_at     = NOW()`,
      [
        subscriptionId,
        installmentNum,
        chargeAmount ? parseFloat(chargeAmount) : null,
        cfPaymentId,
        paymentTime,
        bankReference,
        paymentMethod ? JSON.stringify(paymentMethod) : null,
      ]
    )

    // Update next_charge_date on the parent subscription record
    const { rows } = await pool.query(
      `UPDATE payment_transactions SET
         next_charge_date = COALESCE($1::date, next_charge_date),
         updated_at       = NOW()
       WHERE order_id = $2
       RETURNING client_id, amount, frequency, next_charge_date`,
      [nextChargeDate, subscriptionId]
    )

    if (rows[0]) {
      notifyClientById(rows[0].client_id, 'SIP_PAYMENT_SUCCESS', {
        amount:             chargeAmount ? parseFloat(chargeAmount) : parseFloat(rows[0].amount),
        subscriptionId,
        frequency:          rows[0].frequency ?? undefined,
        installmentNumber:  installmentNum ?? undefined,
        nextChargeDate:     rows[0].next_charge_date ?? nextChargeDate ?? undefined,
      }).catch(() => {})
    }
    return
  }

  // ── SUBSCRIPTION_PAYMENT_FAILED: installment debit failed ───────────────
  if (eventType === 'SUBSCRIPTION_PAYMENT_FAILED') {
    const chargeAmount   = payment?.payment_amount ?? subscription?.charge_amount ?? null
    const cfPaymentId    = payment?.cf_payment_id  ?? null
    const failureReason  = payment?.payment_message ?? subscription?.failure_reason ?? null
    const installmentNum = subscription?.installment_number ?? data.data?.installment_number ?? null

    await pool.query(
      `INSERT INTO sip_charges (
         subscription_id, cf_subscription_id, nuvama_code, client_id,
         installment_number, charge_amount, charge_status,
         cf_payment_id, failure_reason,
         charge_date, created_at, updated_at
       )
       SELECT $1, cf_subscription_id, nuvama_code, client_id,
              $2, COALESCE($3, amount), 'FAILED',
              $4, $5, CURRENT_DATE, NOW(), NOW()
       FROM payment_transactions
       WHERE order_id = $1
       ON CONFLICT (cf_payment_id) DO UPDATE SET
         charge_status  = 'FAILED',
         failure_reason = EXCLUDED.failure_reason,
         retry_count    = sip_charges.retry_count + 1,
         updated_at     = NOW()`,
      [
        subscriptionId,
        installmentNum,
        chargeAmount ? parseFloat(chargeAmount) : null,
        cfPaymentId,
        failureReason,
      ]
    )

    const clientId = await getClientId(subscriptionId)
    if (clientId) {
      const { rows: txRows } = await pool.query(
        'SELECT amount, frequency FROM payment_transactions WHERE order_id = $1 LIMIT 1',
        [subscriptionId]
      )
      notifyClientById(clientId, 'SIP_PAYMENT_FAILED', {
        amount:            chargeAmount ? parseFloat(chargeAmount) : parseFloat(txRows[0]?.amount ?? '0'),
        subscriptionId,
        frequency:         txRows[0]?.frequency ?? undefined,
        installmentNumber: installmentNum ?? undefined,
        failureReason:     failureReason ?? undefined,
      }).catch(() => {})
    }
    return
  }

  // ── SUBSCRIPTION_CANCELLED: cancelled by user, merchant, or bank ─────────
  if (eventType === 'SUBSCRIPTION_CANCELLED') {
    const { rows } = await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = 'CANCELLED',
         investment_status = 'SIP_CANCELLED',
         canceled_at       = COALESCE(canceled_at, NOW()),
         updated_at        = NOW()
       WHERE order_id = $1
       RETURNING client_id, amount, frequency`,
      [subscriptionId]
    )
    if (rows[0]) {
      notifyClientById(rows[0].client_id, 'SIP_CANCELLED', {
        amount:        parseFloat(rows[0].amount),
        subscriptionId,
        frequency:     rows[0].frequency ?? undefined,
      }).catch(() => {})
    }
    return
  }

  // ── SUBSCRIPTION_COMPLETED: all installments done ─────────────────────────
  if (eventType === 'SUBSCRIPTION_COMPLETED') {
    const { rows } = await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = 'COMPLETED',
         investment_status = 'SIP_COMPLETED',
         updated_at        = NOW()
       WHERE order_id = $1
       RETURNING client_id, amount, frequency`,
      [subscriptionId]
    )
    if (rows[0]) {
      notifyClientById(rows[0].client_id, 'SIP_COMPLETED', {
        amount:        parseFloat(rows[0].amount),
        subscriptionId,
        frequency:     rows[0].frequency ?? undefined,
      }).catch(() => {})
    }
    return
  }

  // ── SUBSCRIPTION_HOLD / SUBSCRIPTION_PAUSED ───────────────────────────────
  if (eventType === 'SUBSCRIPTION_HOLD' || eventType === 'SUBSCRIPTION_PAUSED') {
    const newStatus = eventType === 'SUBSCRIPTION_PAUSED' ? 'PAUSED' : 'ON_HOLD'
    await pool.query(
      `UPDATE payment_transactions SET
         payment_status = $1,
         updated_at     = NOW()
       WHERE order_id = $2`,
      [newStatus, subscriptionId]
    )
    return
  }

  // ── SUBSCRIPTION_EXPIRED: expired before mandate was authorised ───────────
  if (eventType === 'SUBSCRIPTION_EXPIRED') {
    const clientId = await getClientId(subscriptionId)
    await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = 'EXPIRED',
         investment_status = 'EXPIRED',
         updated_at        = NOW()
       WHERE order_id = $1`,
      [subscriptionId]
    )
    if (clientId) {
      const { rows } = await pool.query(
        'SELECT amount, frequency FROM payment_transactions WHERE order_id = $1 LIMIT 1',
        [subscriptionId]
      )
      notifyClientById(clientId, 'SIP_MANDATE_FAILED', {
        amount:        parseFloat(rows[0]?.amount ?? '0'),
        subscriptionId,
        frequency:     rows[0]?.frequency ?? undefined,
        failureReason: 'SIP authorization link expired before completion',
      }).catch(() => {})
    }
    return
  }

  // Unhandled SUBSCRIPTION_* sub-type — log for awareness
  console.log(`[webhook] Unhandled subscription event: ${eventType} subscription=${subscriptionId}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIP: INSTRUMENT / MANDATE EVENTS
// Covers: INSTRUMENT_ACTIVE, INSTRUMENT_FAILED, INSTRUMENT_INACTIVE
// These fire when the eMandate / UPI autopay mandate changes state.
// ═══════════════════════════════════════════════════════════════════════════════
async function handleInstrumentEvent(data: any): Promise<void> {
  const eventType   = (data.type ?? '').toUpperCase()
  const { instrument, subscription } = extractParts(data)
  const subscriptionId = subscription?.subscription_id
    ?? instrument?.subscription_id
    ?? data.data?.subscription_id
    ?? null

  if (!subscriptionId) {
    console.warn('[webhook] Instrument event missing subscription_id:', eventType)
    return
  }

  console.log(`[webhook] ${eventType} subscription=${subscriptionId} status=${instrument?.instrument_status}`)

  if (eventType === 'INSTRUMENT_ACTIVE') {
    // Mandate approved — SIP is now active. The SUBSCRIPTION_ACTIVE event usually
    // also fires, but we handle it here too for robustness.
    const nextChargeDate = subscription?.next_charge_time
      ? new Date(subscription.next_charge_time).toISOString().split('T')[0]
      : null

    await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = 'ACTIVE',
         investment_status = 'SIP_ACTIVE',
         next_charge_date  = COALESCE($1::date, next_charge_date),
         updated_at        = NOW()
       WHERE order_id = $2
         AND payment_status NOT IN ('CANCELLED','COMPLETED')`,
      [nextChargeDate, subscriptionId]
    )
  } else if (eventType === 'INSTRUMENT_FAILED') {
    const failureReason = instrument?.failure_reason ?? instrument?.error_description ?? null
    await pool.query(
      `UPDATE payment_transactions SET
         payment_status    = 'FAILED',
         investment_status = 'SIP_MANDATE_FAILED',
         payment_message   = COALESCE($1, payment_message),
         updated_at        = NOW()
       WHERE order_id = $2
         AND payment_status NOT IN ('ACTIVE','CANCELLED','COMPLETED')`,
      [failureReason, subscriptionId]
    )
    const clientId = await getClientId(subscriptionId)
    if (clientId) {
      const { rows } = await pool.query(
        'SELECT amount, frequency FROM payment_transactions WHERE order_id = $1 LIMIT 1',
        [subscriptionId]
      )
      notifyClientById(clientId, 'SIP_MANDATE_FAILED', {
        amount:        parseFloat(rows[0]?.amount ?? '0'),
        subscriptionId,
        frequency:     rows[0]?.frequency ?? undefined,
        failureReason: failureReason ?? undefined,
      }).catch(() => {})
    }
  } else if (eventType === 'INSTRUMENT_INACTIVE') {
    // Mandate deactivated (e.g. bank revoked) — mark as cancelled
    await pool.query(
      `UPDATE payment_transactions SET
         payment_status = 'INACTIVE',
         updated_at     = NOW()
       WHERE order_id = $1
         AND payment_status NOT IN ('CANCELLED','COMPLETED')`,
      [subscriptionId]
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.text()
    const signature  = request.headers.get('x-webhook-signature')
    const timestamp  = request.headers.get('x-webhook-timestamp')

    // ── Signature verification ───────────────────────────────────────────────
    const skipSigCheck = process.env.CASHFREE_SKIP_WEBHOOK_SIG === 'true'
    if (!skipSigCheck) {
      if (!signature || !timestamp) {
        console.error('[webhook] Missing signature headers')
        return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })
      }
      if (!verifyWebhookSignature(rawPayload, signature, timestamp)) {
        console.error('[webhook] Signature mismatch — possible replay or wrong secret')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
      }
    }

    const data = JSON.parse(rawPayload)
    const type: string = (data.type ?? '').toUpperCase()
    console.log('[webhook] received:', type)

    // ── Route to handler ─────────────────────────────────────────────────────
    // ONE-TIME PAYMENT EVENTS
    if ([
      'PAYMENT_SUCCESS_WEBHOOK',
      'PAYMENT_FAILED_WEBHOOK',
      'PAYMENT_USER_DROPPED_WEBHOOK',
      'ORDER_PAID',
      'PAYMENT_VERIFICATION_UPDATE',
      'TERMINAL_STATUS_UPDATE',
      'ABANDONED_CHECKOUT',
      'SUCCESS_PAYMENT_TDR',
    ].includes(type)) {
      await handlePaymentEvent(data)

    // SETTLEMENT EVENTS
    } else if (type.includes('SETTLEMENT')) {
      await handleSettlementEvent(data)

    // REFUND EVENTS
    } else if (type.includes('REFUND')) {
      await handleRefundEvent(data)

    // DISPUTE EVENTS
    } else if (type.includes('DISPUTE')) {
      await handleDisputeEvent(data)

    // SIP SUBSCRIPTION EVENTS — must check before INSTRUMENT (both contain 'SUBSCRIPTION')
    } else if (type.startsWith('SUBSCRIPTION_')) {
      await handleSubscriptionEvent(data)

    // SIP INSTRUMENT / MANDATE EVENTS
    } else if (type.startsWith('INSTRUMENT_')) {
      await handleInstrumentEvent(data)

    // VENDOR SPLIT EVENTS — not applicable for this merchant setup
    } else if (type.startsWith('VENDOR_')) {
      console.log(`[webhook] Vendor event ${type} — ignored`)

    } else {
      console.log(`[webhook] Unknown event type: ${type}`)
    }

    // Always return 200 — Cashfree retries on any non-2xx
    return NextResponse.json({ success: true, type })
  } catch (err) {
    // Log but still return 200 to prevent infinite Cashfree retries on bugs
    console.error('[webhook] Unhandled error:', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 200 })
  }
}

// Cashfree GET ping for webhook URL verification (?challenge=xxx)
export async function GET(request: NextRequest) {
  const challenge = new URL(request.url).searchParams.get('challenge')
  if (challenge) return NextResponse.json({ challenge })
  return NextResponse.json({ status: 'active', timestamp: new Date().toISOString() })
}
