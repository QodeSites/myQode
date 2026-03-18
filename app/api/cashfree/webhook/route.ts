// POST /api/cashfree/webhook
// Handles all 33 Cashfree webhook event types.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import pool from '@/lib/db'

// ── Signature verification ────────────────────────────────────────────────────
function verifyWebhookSignature(rawPayload: string, signature: string, timestamp: string): boolean {
  try {
    const secret = process.env.CASHFREE_SECRET_KEY
    if (!secret) { console.error('[webhook] CASHFREE_SECRET_KEY not set'); return false }
    const expected = crypto.createHmac('sha256', secret).update(timestamp + rawPayload).digest('base64')
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ── Map Cashfree payment_status → investment_status ──────────────────────────
function toInvestmentStatus(paymentStatus: string): string {
  switch (paymentStatus) {
    case 'SUCCESS':      return 'PAYMENT_SUCCESS'
    case 'FAILED':       return 'PAYMENT_FAILED'
    case 'USER_DROPPED': return 'PENDING_PAYMENT'  // let them retry
    case 'PENDING':      return 'PENDING_PAYMENT'
    case 'FLAGGED':      return 'PAYMENT_FAILED'
    case 'CANCELLED':    return 'CANCELLED'
    case 'VOID':         return 'CANCELLED'
    default:             return 'PENDING_PAYMENT'
  }
}

// ── Extract order + payment from both v2023-08-01 and v2025-01-01 shapes ─────
function extractParts(data: any) {
  return {
    order:    data.data?.order    ?? data.order    ?? null,
    payment:  data.data?.payment  ?? data.payment  ?? null,
    customer: data.data?.customer_details ?? data.customer_details ?? null,
    settlement: data.data?.settlement ?? data.settlement ?? null,
    refund:   data.data?.refund   ?? data.refund   ?? null,
    dispute:  data.data?.dispute  ?? data.dispute  ?? null,
  }
}

// ── Payment events ────────────────────────────────────────────────────────────
// Covers: PAYMENT_SUCCESS, PAYMENT_FAILED, USER_DROPPED, PAYMENT_VERIFICATION_UPDATE,
//         TERMINAL_STATUS_UPDATE, ABANDONED_CHECKOUT
async function handlePaymentEvent(data: any) {
  const { order, payment } = extractParts(data)
  if (!order?.order_id || !payment) {
    console.warn('[webhook] Payment event missing order/payment:', data.type)
    return
  }

  const orderId       = order.order_id
  const paymentStatus = payment.payment_status ?? 'UNKNOWN'
  const investStatus  = toInvestmentStatus(paymentStatus)

  console.log(`[webhook] ${data.type} order=${orderId} payment_status=${paymentStatus} → ${investStatus}`)

  await pool.query(
    `UPDATE payment_transactions SET
       payment_status    = $1,
       cf_payment_id     = $2,
       payment_time      = $3,
       bank_reference    = $4,
       payment_method    = $5,
       payment_message   = $6,
       auth_id           = $7,
       investment_status = CASE
         -- Never downgrade a terminal status from a stale event
         WHEN investment_status IN ('DEPLOYED','SETTLED','CANCELLED','EXPIRED') THEN investment_status
         ELSE $8
       END,
       updated_at        = NOW()
     WHERE order_id = $9`,
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
}

// ── Settlement events ─────────────────────────────────────────────────────────
// Covers: SETTLEMENT_SUCCESS, SETTLEMENT_INITIATED, SETTLEMENT_FAILED,
//         SETTLEMENT_REVERSED, ICA_SETTLEMENT_UPDATE,
//         TXN_WISE_SETTLEMENT_SUCCESS, TXN_WISE_SETTLEMENT_INITIATED,
//         TXN_WISE_SETTLEMENT_FAILED, TXN_WISE_SETTLEMENT_REVERSED
async function handleSettlementEvent(data: any) {
  const { settlement, order } = extractParts(data)
  const eventType = data.type ?? ''

  // Only SETTLEMENT_SUCCESS and TXN_WISE_SETTLEMENT_SUCCESS advance investment_status → SETTLED
  const isSuccess = eventType.includes('SUCCESS') && !eventType.includes('FAILED') && !eventType.includes('REVERSED')
  const isReversed = eventType.includes('REVERSED')
  const isFailed   = eventType.includes('FAILED')

  const orderId      = settlement?.order_id ?? order?.order_id ?? null
  const transferUtr  = settlement?.transfer_utr ?? settlement?.settlement_utr ?? null
  const settledAmt   = settlement?.settlement_amount ?? null

  if (!orderId) {
    console.warn('[webhook] Settlement event missing order_id:', eventType)
    return
  }

  console.log(`[webhook] ${eventType} order=${orderId} utr=${transferUtr} success=${isSuccess}`)

  if (isSuccess && transferUtr) {
    await pool.query(
      `UPDATE payment_transactions SET
         investment_status = CASE
           WHEN investment_status = 'PAYMENT_SUCCESS' THEN 'SETTLED'
           ELSE investment_status
         END,
         settlement_amount = COALESCE($1, settlement_amount),
         transfer_utr      = COALESCE($2, transfer_utr),
         settled_at        = COALESCE(settled_at, NOW()),
         updated_at        = NOW()
       WHERE order_id = $3`,
      [settledAmt, transferUtr, orderId]
    )
  } else if (isReversed) {
    // Settlement reversed — funds pulled back, mark as failed
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
    console.warn(`[webhook] Settlement FAILED for order=${orderId}`)
    // Don't change investment_status — let cron retry
  }
}

// ── Refund events ─────────────────────────────────────────────────────────────
// Covers: AUTO_REFUND, REFUND (manual)
async function handleRefundEvent(data: any) {
  const { refund, order } = extractParts(data)
  const orderId = refund?.order_id ?? order?.order_id ?? null
  if (!orderId) { console.warn('[webhook] Refund event missing order_id'); return }

  const refundStatus = refund?.refund_status ?? 'UNKNOWN'
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
}

// ── Dispute events ────────────────────────────────────────────────────────────
// Covers: DISPUTE_CREATED, DISPUTE_UPDATED, DISPUTE_CLOSED
async function handleDisputeEvent(data: any) {
  const { dispute, order } = extractParts(data)
  const orderId = dispute?.order_id ?? order?.order_id ?? null
  if (!orderId) { console.warn('[webhook] Dispute event missing order_id'); return }

  console.log(`[webhook] ${data.type} order=${orderId} status=${dispute?.dispute_status}`)
  // Log only — disputes are handled operationally, don't auto-change investment_status
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.text()
    const signature  = request.headers.get('x-webhook-signature')
    const timestamp  = request.headers.get('x-webhook-timestamp')

    const skipSigCheck = process.env.CASHFREE_SKIP_WEBHOOK_SIG === 'true'
    if (!skipSigCheck) {
      if (!signature || !timestamp) {
        return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })
      }
      if (!verifyWebhookSignature(rawPayload, signature, timestamp)) {
        console.error('[webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
      }
    }

    const data = JSON.parse(rawPayload)
    const type: string = data.type ?? ''
    console.log('[webhook] received:', type)

    // Payment events
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

    // Settlement events
    } else if (type.includes('SETTLEMENT')) {
      await handleSettlementEvent(data)

    // Refund events
    } else if (type.includes('REFUND')) {
      await handleRefundEvent(data)

    // Dispute events
    } else if (type.includes('DISPUTE')) {
      await handleDisputeEvent(data)

    // Instrument events (INSTRUMENT_ACTIVE, INSTRUMENT_FAILED) — SIP mandates
    } else if (type.includes('INSTRUMENT')) {
      const { order } = extractParts(data)
      console.log(`[webhook] Instrument event ${type} for order=${order?.order_id}`)

    // Vendor settlement events — not applicable, log only
    } else if (type.includes('VENDOR')) {
      console.log(`[webhook] Vendor event ${type} — ignored`)

    } else {
      console.log(`[webhook] Unknown type ${type} — logged only`)
    }

    // Always 200 — Cashfree retries on non-2xx
    return NextResponse.json({ success: true, type })
  } catch (err) {
    console.error('[webhook] Error:', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 200 })
  }
}

// Webhook URL verification (Cashfree GET ping with ?challenge=xxx)
export async function GET(request: NextRequest) {
  const challenge = new URL(request.url).searchParams.get('challenge')
  if (challenge) return NextResponse.json({ challenge })
  return NextResponse.json({ status: 'active', timestamp: new Date().toISOString() })
}
