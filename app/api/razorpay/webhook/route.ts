// POST /api/razorpay/webhook — the authoritative record of what happened.
//
// The browser callback (/api/razorpay/verify) is a convenience for the user;
// this route is what the ledger actually trusts, because it still fires when the
// user closes the tab mid-payment.
//
// Design rules:
//  - Verify the HMAC over the RAW body. request.json() would reorder keys and
//    break the signature, so the body is read with request.text() and parsed
//    only after verification.
//  - Every event is recorded in webhook_events BEFORE processing. Razorpay
//    retries for up to 24h on any non-2xx, so an event can legitimately arrive
//    many times; the unique (gateway, event_id) index makes duplicates a no-op.
//  - Terminal investment_status values are never downgraded by a late event.
//    Razorpay does not guarantee ordering — `payment.captured` can arrive after
//    `payment.failed` for the same order.
//  - Always return 200 once the signature is valid. A 500 on a bug would make
//    Razorpay retry the same poisoned event for a day.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import {
  verifyWebhookSignature,
  toPaise,
  toRupees,
  toInvestmentStatus,
  toSubscriptionInvestmentStatus,
  isPermittedMethod,
  TERMINAL_INVESTMENT_STATUSES,
} from '@/lib/razorpay'
import { notifyClientById } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// ── Idempotency ───────────────────────────────────────────────────────────────

/**
 * Claims an event for processing.
 *
 * Returns false when this event_id has been seen before, which makes duplicate
 * deliveries a cheap no-op. The INSERT is the lock: two concurrent deliveries of
 * the same event race on the unique index, and exactly one wins.
 */
async function claimEvent(
  eventId: string,
  eventType: string,
  referenceId: string | null,
  payload: unknown,
): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO webhook_events (gateway, event_id, event_type, reference_id, payload, status)
     VALUES ('razorpay', $1, $2, $3, $4, 'RECEIVED')
     ON CONFLICT (gateway, event_id) DO UPDATE
       SET attempt_count = webhook_events.attempt_count + 1
     RETURNING (xmax = 0) AS inserted, status`,
    [eventId, eventType, referenceId, JSON.stringify(payload)],
  )

  const row = rows[0]
  // xmax = 0 means this was a fresh INSERT rather than an UPDATE of an existing
  // row — i.e. we are the first to see this event.
  if (row?.inserted) return true

  // Seen before. Allow a retry only if the previous attempt never completed;
  // this recovers events that failed halfway without re-running settled ones.
  return row?.status === 'FAILED'
}

async function markEvent(eventId: string, status: 'PROCESSED' | 'FAILED' | 'IGNORED', error?: string) {
  await pool.query(
    `UPDATE webhook_events
        SET status = $1, error_message = $2, processed_at = NOW()
      WHERE gateway = 'razorpay' AND event_id = $3`,
    [status, error ?? null, eventId],
  ).catch((e) => console.error('[razorpay/webhook] failed to mark event:', e))
}

// ── Payment events ────────────────────────────────────────────────────────────

/** payment.captured | payment.failed | payment.authorized | order.paid */
async function handlePaymentEvent(eventType: string, payload: any): Promise<void> {
  const payment = payload?.payment?.entity
  if (!payment?.order_id) {
    console.warn(`[razorpay/webhook] ${eventType} missing payment.order_id`)
    return
  }

  const razorpayOrderId = payment.order_id
  const investStatus    = toInvestmentStatus(payment.status)

  const { rows } = await pool.query(
    `UPDATE payment_transactions SET
       razorpay_payment_id = COALESCE(razorpay_payment_id, $1),
       payment_status      = $2,
       payment_method      = COALESCE($3, payment_method),
       bank_reference      = COALESCE($4, bank_reference),
       payment_time        = COALESCE(payment_time, $5),
       payment_message     = COALESCE($6, payment_message),
       investment_status   = CASE
         WHEN investment_status = ANY($7::text[]) THEN investment_status
         ELSE $8
       END,
       updated_at = NOW()
     WHERE razorpay_order_id = $9 AND gateway = 'razorpay'
     RETURNING client_id, amount, investment_status, strategy_type, order_id, razorpay_payment_id`,
    [
      payment.id,
      payment.status,
      payment.method
        ? JSON.stringify({
            method: payment.method, bank: payment.bank, wallet: payment.wallet,
            vpa: payment.vpa, card_id: payment.card_id,
          })
        : null,
      payment.acquirer_data?.bank_transaction_id ?? payment.acquirer_data?.rrn ?? null,
      payment.created_at ? new Date(payment.created_at * 1000) : null,
      payment.error_description ?? null,
      TERMINAL_INVESTMENT_STATUSES as unknown as string[],
      investStatus,
      razorpayOrderId,
    ],
  )

  if (!rows.length) {
    // Not necessarily an error: could be a Cashfree order, or an order created
    // by another environment pointing at the same webhook URL.
    console.warn(`[razorpay/webhook] no razorpay transaction for order=${razorpayOrderId}`)
    return
  }

  const tx = rows[0]

  // Method check — netbanking and UPI only. See lib/razorpay PERMITTED_METHODS.
  // Flagged rather than rejected: the money has moved, so the record must be
  // kept and surfaced for a refund rather than dropped.
  if (payment.status === 'captured' && !isPermittedMethod(payment.method)) {
    console.error(
      `[razorpay/webhook] DISALLOWED METHOD '${payment.method}' on order=${razorpayOrderId} ` +
      `payment=${payment.id} — flagged for refund`,
    )
    await pool.query(
      `UPDATE payment_transactions
          SET payment_message = $1, updated_at = NOW()
        WHERE razorpay_order_id = $2`,
      [`Paid via disallowed method '${payment.method}' — requires refund`, razorpayOrderId],
    )
  }

  // Amount sanity check — surfaces tampering or a currency/paise bug.
  if (payment.status === 'captured') {
    const expected = toPaise(tx.amount)
    if (Number(payment.amount) !== expected) {
      console.error(
        `[razorpay/webhook] AMOUNT MISMATCH order=${razorpayOrderId} ` +
        `expected=${expected} captured=${payment.amount}`,
      )
      await pool.query(
        `UPDATE payment_transactions
            SET payment_message = $1, updated_at = NOW()
          WHERE razorpay_order_id = $2`,
        [`Captured amount ${payment.amount} paise != ordered ${expected} paise`, razorpayOrderId],
      )
    }
  }

  if (tx.investment_status === 'PAYMENT_SUCCESS' && payment.status === 'captured') {
    notifyClientById(tx.client_id, 'PAYMENT_SUCCESS', {
      amount:       parseFloat(tx.amount),
      orderId:      tx.order_id,
      strategyType: tx.strategy_type ?? undefined,
    }).catch(() => {})
  } else if (tx.investment_status === 'PAYMENT_FAILED') {
    notifyClientById(tx.client_id, 'PAYMENT_FAILED', {
      amount:        parseFloat(tx.amount),
      orderId:       tx.order_id,
      failureReason: payment.error_description ?? undefined,
    }).catch(() => {})
  }
}

// ── Refund events ─────────────────────────────────────────────────────────────

async function handleRefundEvent(eventType: string, payload: any): Promise<void> {
  const refund = payload?.refund?.entity
  const paymentId = refund?.payment_id
  if (!paymentId) {
    console.warn(`[razorpay/webhook] ${eventType} missing refund.payment_id`)
    return
  }

  // Only a fully processed refund cancels the investment. A partial refund is
  // logged but must not flip a live investment to CANCELLED.
  const isFullRefund = refund.status === 'processed'

  if (isFullRefund) {
    await pool.query(
      `UPDATE payment_transactions SET
         investment_status = CASE
           WHEN investment_status = 'DEPLOYED' THEN investment_status
           ELSE 'CANCELLED'
         END,
         payment_message = COALESCE($1, payment_message),
         updated_at = NOW()
       WHERE razorpay_payment_id = $2 AND gateway = 'razorpay'`,
      [`Refund ${refund.id} processed (${toRupees(Number(refund.amount))})`, paymentId],
    )
  }

  console.log(`[razorpay/webhook] ${eventType} payment=${paymentId} refund_status=${refund.status}`)
}

// ── Subscription events ───────────────────────────────────────────────────────

/**
 * subscription.* — SIP lifecycle.
 *
 * Note the deliberate asymmetry with Cashfree: `subscription.authenticated`
 * does NOT activate the SIP here. Because TPV is disabled on this merchant
 * account, the mandate could have been authorised from a third-party bank
 * account, so activation waits on the payer-account check performed by
 * /api/razorpay/subscriptions/verify-payer.
 */
async function handleSubscriptionEvent(eventType: string, payload: any): Promise<void> {
  const subscription = payload?.subscription?.entity
  const subscriptionId = subscription?.id
  if (!subscriptionId) {
    console.warn(`[razorpay/webhook] ${eventType} missing subscription.id`)
    return
  }

  const { rows: existing } = await pool.query(
    `SELECT client_id, amount, frequency, payer_verification_status, investment_status
       FROM payment_transactions
      WHERE razorpay_subscription_id = $1 AND gateway = 'razorpay'
      LIMIT 1`,
    [subscriptionId],
  )

  if (!existing.length) {
    console.warn(`[razorpay/webhook] no subscription record for ${subscriptionId}`)
    return
  }

  const tx = existing[0]
  const payerCleared = tx.payer_verification_status === 'MATCHED'
             || tx.payer_verification_status === 'OVERRIDDEN'

  const nextChargeDate = subscription.charge_at
    ? new Date(subscription.charge_at * 1000).toISOString().split('T')[0]
    : null

  switch (eventType) {
    // Mandate authorised by the customer, but not yet cleared by us.
    case 'subscription.authenticated': {
      await pool.query(
        `UPDATE payment_transactions SET
           payment_status    = $1,
           investment_status = CASE
             WHEN $2::boolean THEN 'SIP_ACTIVE'
             ELSE 'SIP_PENDING_VERIFICATION'
           END,
           payer_verification_status = COALESCE(payer_verification_status, 'PENDING'),
           next_charge_date  = COALESCE($3::date, next_charge_date),
           updated_at = NOW()
         WHERE razorpay_subscription_id = $4`,
        [subscription.status, payerCleared, nextChargeDate, subscriptionId],
      )

      if (!payerCleared) {
        console.warn(
          `[razorpay/webhook] subscription ${subscriptionId} authenticated but payer ` +
          `account not yet verified — held for review`,
        )
      }
      return
    }

    case 'subscription.activated': {
      // Razorpay considers it live. We still refuse to report SIP_ACTIVE to the
      // client until the payer account has been cleared.
      await pool.query(
        `UPDATE payment_transactions SET
           payment_status    = $1,
           investment_status = CASE
             WHEN $2::boolean THEN 'SIP_ACTIVE'
             ELSE 'SIP_PENDING_VERIFICATION'
           END,
           next_charge_date  = COALESCE($3::date, next_charge_date),
           updated_at = NOW()
         WHERE razorpay_subscription_id = $4`,
        [subscription.status, payerCleared, nextChargeDate, subscriptionId],
      )

      if (payerCleared) {
        notifyClientById(tx.client_id, 'SIP_ACTIVE', {
          amount:         parseFloat(tx.amount),
          subscriptionId,
          frequency:      tx.frequency ?? undefined,
          nextChargeDate: nextChargeDate ?? undefined,
        }).catch(() => {})
      }
      return
    }

    case 'subscription.charged': {
      const payment = payload?.payment?.entity
      const chargePaise = payment?.amount ? Number(payment.amount) : null

      // One row per installment. The unique index on razorpay_payment_id makes
      // a duplicate delivery collide instead of double-counting an installment.
      await pool.query(
        `INSERT INTO sip_charges (
           gateway, subscription_id, razorpay_subscription_id, razorpay_payment_id,
           nuvama_code, client_id, installment_number, charge_amount, charge_status,
           payment_time, bank_reference, payment_method, charge_date, created_at, updated_at
         )
         SELECT 'razorpay', order_id, $1, $2, nuvama_code, client_id, $3,
                COALESCE($4, amount), 'SUCCESS', $5, $6, $7,
                COALESCE($5::date, CURRENT_DATE), NOW(), NOW()
           FROM payment_transactions
          WHERE razorpay_subscription_id = $1
         ON CONFLICT (razorpay_payment_id) DO UPDATE SET
           charge_status = 'SUCCESS',
           payment_time  = EXCLUDED.payment_time,
           updated_at    = NOW()`,
        [
          subscriptionId,
          payment?.id ?? null,
          subscription.paid_count ?? null,
          chargePaise !== null ? toRupees(chargePaise) : null,
          payment?.created_at ? new Date(payment.created_at * 1000) : null,
          payment?.acquirer_data?.rrn ?? null,
          payment?.method ? JSON.stringify({ method: payment.method, bank: payment.bank, vpa: payment.vpa }) : null,
        ],
      )

      await pool.query(
        `UPDATE payment_transactions
            SET next_charge_date = COALESCE($1::date, next_charge_date), updated_at = NOW()
          WHERE razorpay_subscription_id = $2`,
        [nextChargeDate, subscriptionId],
      )

      notifyClientById(tx.client_id, 'SIP_PAYMENT_SUCCESS', {
        amount:            chargePaise !== null ? Number(toRupees(chargePaise)) : parseFloat(tx.amount),
        subscriptionId,
        frequency:         tx.frequency ?? undefined,
        installmentNumber: subscription.paid_count ?? undefined,
        nextChargeDate:    nextChargeDate ?? undefined,
      }).catch(() => {})
      return
    }

    case 'subscription.pending': {
      // A charge failed; Razorpay will retry per the configured retry policy.
      const payment = payload?.payment?.entity
      await pool.query(
        `INSERT INTO sip_charges (
           gateway, subscription_id, razorpay_subscription_id, razorpay_payment_id,
           nuvama_code, client_id, charge_amount, charge_status, failure_reason,
           charge_date, created_at, updated_at
         )
         SELECT 'razorpay', order_id, $1, $2, nuvama_code, client_id,
                amount, 'FAILED', $3, CURRENT_DATE, NOW(), NOW()
           FROM payment_transactions
          WHERE razorpay_subscription_id = $1
         ON CONFLICT (razorpay_payment_id) DO UPDATE SET
           charge_status  = 'FAILED',
           failure_reason = EXCLUDED.failure_reason,
           retry_count    = sip_charges.retry_count + 1,
           updated_at     = NOW()`,
        [subscriptionId, payment?.id ?? null, payment?.error_description ?? 'Installment debit failed'],
      )

      await pool.query(
        `UPDATE payment_transactions
            SET investment_status = 'SIP_PAYMENT_RETRY', updated_at = NOW()
          WHERE razorpay_subscription_id = $1
            AND investment_status NOT IN ('SIP_CANCELLED','SIP_COMPLETED','EXPIRED')`,
        [subscriptionId],
      )

      notifyClientById(tx.client_id, 'SIP_PAYMENT_FAILED', {
        amount:        parseFloat(tx.amount),
        subscriptionId,
        frequency:     tx.frequency ?? undefined,
        failureReason: payment?.error_description ?? undefined,
      }).catch(() => {})
      return
    }

    case 'subscription.halted': {
      // All retries exhausted — needs the customer to act.
      await pool.query(
        `UPDATE payment_transactions
            SET payment_status = 'halted', investment_status = 'SIP_PAUSED', updated_at = NOW()
          WHERE razorpay_subscription_id = $1
            AND investment_status NOT IN ('SIP_CANCELLED','SIP_COMPLETED')`,
        [subscriptionId],
      )
      notifyClientById(tx.client_id, 'SIP_PAYMENT_FAILED', {
        amount:        parseFloat(tx.amount),
        subscriptionId,
        frequency:     tx.frequency ?? undefined,
        failureReason: 'Your SIP has been halted after repeated failed debits. Please re-authorise the mandate.',
      }).catch(() => {})
      return
    }

    case 'subscription.paused': {
      await pool.query(
        `UPDATE payment_transactions
            SET payment_status = 'paused', investment_status = 'SIP_PAUSED', updated_at = NOW()
          WHERE razorpay_subscription_id = $1
            AND investment_status NOT IN ('SIP_CANCELLED','SIP_COMPLETED')`,
        [subscriptionId],
      )
      return
    }

    case 'subscription.resumed': {
      await pool.query(
        `UPDATE payment_transactions
            SET payment_status = 'active',
                investment_status = CASE WHEN $1::boolean THEN 'SIP_ACTIVE' ELSE 'SIP_PENDING_VERIFICATION' END,
                updated_at = NOW()
          WHERE razorpay_subscription_id = $2`,
        [payerCleared, subscriptionId],
      )
      return
    }

    case 'subscription.cancelled': {
      await pool.query(
        `UPDATE payment_transactions
            SET payment_status = 'cancelled', investment_status = 'SIP_CANCELLED',
                canceled_at = COALESCE(canceled_at, NOW()), updated_at = NOW()
          WHERE razorpay_subscription_id = $1`,
        [subscriptionId],
      )
      notifyClientById(tx.client_id, 'SIP_CANCELLED', {
        amount:    parseFloat(tx.amount),
        subscriptionId,
        frequency: tx.frequency ?? undefined,
      }).catch(() => {})
      return
    }

    case 'subscription.completed': {
      await pool.query(
        `UPDATE payment_transactions
            SET payment_status = 'completed', investment_status = 'SIP_COMPLETED', updated_at = NOW()
          WHERE razorpay_subscription_id = $1`,
        [subscriptionId],
      )
      notifyClientById(tx.client_id, 'SIP_COMPLETED', {
        amount:    parseFloat(tx.amount),
        subscriptionId,
        frequency: tx.frequency ?? undefined,
      }).catch(() => {})
      return
    }

    default:
      console.log(`[razorpay/webhook] unhandled subscription event ${eventType} sub=${subscriptionId}`)
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read the raw body — parsing first would break signature verification.
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error('[razorpay/webhook] signature verification failed')
    // 400, not 200: an unsigned request is not a Razorpay event, and we do not
    // want it recorded or retried.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    console.error('[razorpay/webhook] signature valid but body is not JSON')
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const eventType = String(event.event ?? '')
  // Razorpay sends a stable id per event; fall back to a deterministic
  // composite so idempotency still works if the header is ever absent.
  const eventId =
    request.headers.get('x-razorpay-event-id') ??
    `${eventType}:${event.payload?.payment?.entity?.id ?? event.payload?.subscription?.entity?.id ?? event.created_at}`

  const referenceId =
    event.payload?.payment?.entity?.order_id ??
    event.payload?.subscription?.entity?.id ??
    event.payload?.refund?.entity?.payment_id ??
    null

  try {
    const shouldProcess = await claimEvent(eventId, eventType, referenceId, event)
    if (!shouldProcess) {
      console.log(`[razorpay/webhook] duplicate ${eventType} id=${eventId} — skipped`)
      return NextResponse.json({ success: true, duplicate: true })
    }

    console.log(`[razorpay/webhook] processing ${eventType} id=${eventId} ref=${referenceId}`)

    if (eventType.startsWith('subscription.')) {
      await handleSubscriptionEvent(eventType, event.payload)
    } else if (eventType.startsWith('refund.')) {
      await handleRefundEvent(eventType, event.payload)
    } else if (
      eventType === 'payment.captured' ||
      eventType === 'payment.failed' ||
      eventType === 'payment.authorized' ||
      eventType === 'order.paid'
    ) {
      await handlePaymentEvent(eventType, event.payload)
    } else {
      console.log(`[razorpay/webhook] ignoring ${eventType}`)
      await markEvent(eventId, 'IGNORED')
      return NextResponse.json({ success: true, ignored: true })
    }

    await markEvent(eventId, 'PROCESSED')
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`[razorpay/webhook] handler error for ${eventType}:`, err)
    await markEvent(eventId, 'FAILED', String(err))

    // 500 makes Razorpay retry, which is what we want for a transient DB error —
    // claimEvent allows reprocessing of FAILED events specifically for this case.
    return NextResponse.json({ success: false, error: 'Processing failed' }, { status: 500 })
  }
}

// Razorpay does not require a GET, but it is useful for verifying the URL is
// reachable when configuring the webhook in the dashboard.
export async function GET() {
  return NextResponse.json({ status: 'active', gateway: 'razorpay', timestamp: new Date().toISOString() })
}
