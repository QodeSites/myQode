// POST /api/razorpay/verify — called by the browser immediately after checkout.
//
// This route exists to give the user a fast, trustworthy answer. It is NOT the
// source of truth: the webhook is, because the browser may never come back
// (closed tab, dead battery, lost network right after the bank debit).
//
// Three independent checks must all pass before an order is marked successful:
//   1. HMAC signature  — proves Razorpay issued this payment_id for this order.
//   2. Live API fetch  — proves the payment is actually captured right now, and
//                        that the signature is not being replayed against a
//                        payment that was later refunded or failed.
//   3. Amount match    — proves the captured amount equals what we ordered.
//
// Skipping (3) is the classic exploit: an attacker creates a ₹100 order, pays
// it, then replays the valid signature against a ₹10,00,000 order.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import pool from '@/lib/db'
import {
  getRazorpayClient,
  verifyPaymentSignature,
  toPaise,
  toInvestmentStatus,
  normaliseRazorpayError,
  isPermittedMethod,
  TERMINAL_INVESTMENT_STATUSES,
  RazorpayError,
} from '@/lib/razorpay'
import { notifyClientById } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

interface VerifyBody {
  razorpay_order_id:   string
  razorpay_payment_id: string
  razorpay_signature:  string
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    if (cookieStore.get('qode-auth')?.value !== '1') {
      return NextResponse.json(
        { success: false, error: 'Not authenticated', error_code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    let body: VerifyBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', error_code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { success: false, error: 'Missing payment verification fields', error_code: 'MISSING_FIELDS' },
        { status: 400 },
      )
    }

    // ── Check 1: signature ───────────────────────────────────────────────────
    const signatureValid = verifyPaymentSignature({
      razorpayOrderId:   razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      signature:         razorpay_signature,
    })

    if (!signatureValid) {
      // Deliberately loud: a signature mismatch on a real user flow is either a
      // key misconfiguration or someone forging a callback. Both need eyes.
      console.error(
        `[razorpay/verify] SIGNATURE MISMATCH order=${razorpay_order_id} payment=${razorpay_payment_id}`,
      )
      await pool.query(
        `UPDATE payment_transactions
            SET payment_message = 'Signature verification failed on client callback',
                updated_at = NOW()
          WHERE razorpay_order_id = $1`,
        [razorpay_order_id],
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Payment could not be verified. If money was debited it will be refunded automatically.',
          error_code: 'SIGNATURE_VERIFICATION_FAILED',
        },
        { status: 400 },
      )
    }

    // ── Locate our record ────────────────────────────────────────────────────
    const { rows: txRows } = await pool.query(
      `SELECT id, order_id, client_id, nuvama_code, amount, investment_status,
              strategy_type, razorpay_payment_id
         FROM payment_transactions
        WHERE razorpay_order_id = $1 AND gateway = 'razorpay'
        LIMIT 1`,
      [razorpay_order_id],
    )

    if (!txRows.length) {
      console.error(`[razorpay/verify] no local record for order=${razorpay_order_id}`)
      return NextResponse.json(
        { success: false, error: 'Order not found', error_code: 'ORDER_NOT_FOUND' },
        { status: 404 },
      )
    }

    const tx = txRows[0]

    // ── Check 2: fetch live payment state from Razorpay ─────────────────────
    let payment: any
    try {
      payment = await getRazorpayClient().payments.fetch(razorpay_payment_id)
    } catch (err) {
      throw normaliseRazorpayError(err)
    }

    // The payment must belong to the order it claims to. Guards against replaying
    // a genuine signature from a different order.
    if (payment.order_id !== razorpay_order_id) {
      console.error(
        `[razorpay/verify] ORDER MISMATCH payment=${razorpay_payment_id} ` +
        `claims=${razorpay_order_id} actual=${payment.order_id}`,
      )
      return NextResponse.json(
        { success: false, error: 'Payment does not belong to this order', error_code: 'ORDER_MISMATCH' },
        { status: 400 },
      )
    }

    // ── Check 3: amount ─────────────────────────────────────────────────────
    const expectedPaise = toPaise(tx.amount)
    const paidPaise     = Number(payment.amount)

    if (paidPaise !== expectedPaise) {
      console.error(
        `[razorpay/verify] AMOUNT MISMATCH order=${razorpay_order_id} ` +
        `expected=${expectedPaise} paid=${paidPaise}`,
      )
      await pool.query(
        `UPDATE payment_transactions
            SET payment_message = $1, updated_at = NOW()
          WHERE razorpay_order_id = $2`,
        [`Amount mismatch: expected ${expectedPaise} paise, received ${paidPaise} paise`, razorpay_order_id],
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Payment amount did not match the order. Our team has been notified.',
          error_code: 'AMOUNT_MISMATCH',
        },
        { status: 400 },
      )
    }

    // ── Method check ────────────────────────────────────────────────────────
    // Only netbanking and UPI are acceptable for PMS money. The checkout widget
    // hides everything else, but that is client-side and bypassable, so the
    // method actually used is checked here. The payment is NOT rejected — the
    // money has already moved and discarding the record would lose it — but it
    // is flagged loudly so ops can refund.
    if (!isPermittedMethod(payment.method)) {
      console.error(
        `[razorpay/verify] DISALLOWED METHOD '${payment.method}' on order=${razorpay_order_id} ` +
        `payment=${razorpay_payment_id} — flagged for refund`,
      )
      await pool.query(
        `UPDATE payment_transactions
            SET payment_message = $1, updated_at = NOW()
          WHERE razorpay_order_id = $2`,
        [`Paid via disallowed method '${payment.method}' — requires refund`, razorpay_order_id],
      )
    }

    // ── Apply ────────────────────────────────────────────────────────────────
    const investStatus = toInvestmentStatus(payment.status)
    const wasAlreadyTerminal = TERMINAL_INVESTMENT_STATUSES.includes(tx.investment_status)

    // The webhook may already have processed this payment. The CASE guard means
    // whichever arrives second cannot regress a terminal status.
    const { rows: updated } = await pool.query(
      `UPDATE payment_transactions SET
         razorpay_payment_id = COALESCE(razorpay_payment_id, $1),
         razorpay_signature  = COALESCE(razorpay_signature, $2),
         payment_status      = $3,
         payment_method      = COALESCE($4, payment_method),
         bank_reference      = COALESCE($5, bank_reference),
         payment_time        = COALESCE(payment_time, $6),
         payment_message     = COALESCE($7, payment_message),
         investment_status   = CASE
           WHEN investment_status = ANY($8::text[]) THEN investment_status
           ELSE $9
         END,
         updated_at = NOW()
       WHERE razorpay_order_id = $10
       RETURNING client_id, amount, investment_status, strategy_type, order_id`,
      [
        razorpay_payment_id,
        razorpay_signature,
        payment.status,
        payment.method ? JSON.stringify({ method: payment.method, bank: payment.bank, wallet: payment.wallet, vpa: payment.vpa, card_id: payment.card_id }) : null,
        payment.acquirer_data?.bank_transaction_id ?? payment.acquirer_data?.rrn ?? null,
        payment.created_at ? new Date(payment.created_at * 1000) : null,
        payment.error_description ?? null,
        TERMINAL_INVESTMENT_STATUSES as unknown as string[],
        investStatus,
        razorpay_order_id,
      ],
    )

    const result = updated[0]

    // Notify only on a real transition — never on a repeat verify of an order
    // the webhook already settled, or the user gets duplicate emails.
    const isNewSuccess =
      investStatus === 'PAYMENT_SUCCESS' &&
      !wasAlreadyTerminal &&
      !tx.razorpay_payment_id

    if (isNewSuccess) {
      notifyClientById(result.client_id, 'PAYMENT_SUCCESS', {
        amount:       parseFloat(result.amount),
        orderId:      result.order_id,
        strategyType: result.strategy_type ?? undefined,
      }).catch(() => {})
    }

    const succeeded = investStatus === 'PAYMENT_SUCCESS'

    console.log(
      `[razorpay/verify] order=${razorpay_order_id} payment=${razorpay_payment_id} ` +
      `status=${payment.status} → ${result.investment_status}`,
    )

    return NextResponse.json({
      success: succeeded,
      verified: true,
      order_id:            result.order_id,
      razorpay_order_id,
      razorpay_payment_id,
      payment_status:      payment.status,
      investment_status:   result.investment_status,
      amount:              paidPaise,
      payment_method:      payment.method ?? null,
      ...(succeeded
        ? {}
        : {
            error: payment.error_description ?? 'Payment was not completed.',
            error_code: 'PAYMENT_NOT_CAPTURED',
          }),
    })
  } catch (error: any) {
    if (error instanceof RazorpayError) {
      console.error(`[razorpay/verify] ${error.code}: ${error.message}`)
      return NextResponse.json(
        { success: false, error: error.message, error_code: error.code },
        { status: error.statusCode },
      )
    }

    console.error('[razorpay/verify] unhandled:', error)
    // A 500 here does not mean the payment failed — the webhook is still
    // authoritative. The message must not tell the user their money is gone.
    return NextResponse.json(
      {
        success: false,
        error: 'We could not confirm your payment right now. If the amount was debited, it will be reflected shortly.',
        error_code: 'VERIFICATION_ERROR',
      },
      { status: 500 },
    )
  }
}
