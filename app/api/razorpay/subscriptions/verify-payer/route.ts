// POST /api/razorpay/subscriptions/verify-payer
//
// Called immediately after the customer authorises a SIP mandate in Checkout.
// This is the control that stands in for TPV, which is disabled on this
// merchant account (see lib/razorpay-payer-check.ts for the full rationale).
//
// Sequence:
//   1. Verify the subscription signature   — proves Razorpay issued this result.
//   2. Fetch the authorising payment/token — the only place payer bank details live.
//   3. Compare payer account vs registered — decide() in razorpay-payer-check.
//   4. Activate ONLY on MATCHED. Everything else is held for human review.
//
// The route deliberately returns HTTP 200 with an "on hold" payload rather than
// an error for the UNVERIFIABLE/MISMATCH cases: the mandate genuinely exists and
// the customer's action succeeded — it is our activation that is pending.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import pool from '@/lib/db'
import {
  getRazorpayClient,
  verifySubscriptionSignature,
  normaliseRazorpayError,
  RazorpayError,
} from '@/lib/razorpay'
import { decide, extractPayerAccount } from '@/lib/razorpay-payer-check'
import { notifyClientById } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

interface VerifyPayerBody {
  razorpay_payment_id:      string
  razorpay_subscription_id: string
  razorpay_signature:       string
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

    let body: VerifyPayerBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', error_code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = body

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return NextResponse.json(
        { success: false, error: 'Missing mandate verification fields', error_code: 'MISSING_FIELDS' },
        { status: 400 },
      )
    }

    // ── 1. Signature ─────────────────────────────────────────────────────────
    // Note the operand order differs from one-time payments:
    // payment_id|subscription_id. See lib/razorpay.ts.
    const signatureValid = verifySubscriptionSignature({
      razorpayPaymentId:      razorpay_payment_id,
      razorpaySubscriptionId: razorpay_subscription_id,
      signature:              razorpay_signature,
    })

    if (!signatureValid) {
      console.error(
        `[razorpay/verify-payer] SIGNATURE MISMATCH subscription=${razorpay_subscription_id} ` +
        `payment=${razorpay_payment_id}`,
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Mandate could not be verified. Please try setting up the SIP again.',
          error_code: 'SIGNATURE_VERIFICATION_FAILED',
        },
        { status: 400 },
      )
    }

    // ── Locate our record (also gives us the registered account) ─────────────
    const { rows: txRows } = await pool.query(
      `SELECT id, order_id, client_id, nuvama_code, client_name, amount, frequency,
              account_number, ifsc_code, payer_verification_status, investment_status,
              next_charge_date
         FROM payment_transactions
        WHERE razorpay_subscription_id = $1 AND gateway = 'razorpay'
        LIMIT 1`,
      [razorpay_subscription_id],
    )

    if (!txRows.length) {
      return NextResponse.json(
        { success: false, error: 'SIP record not found', error_code: 'SUBSCRIPTION_NOT_FOUND' },
        { status: 404 },
      )
    }

    const tx = txRows[0]

    // Already decided by an earlier call or by the webhook — return the stored
    // outcome rather than re-running the check and re-notifying.
    if (tx.payer_verification_status === 'MATCHED' || tx.payer_verification_status === 'OVERRIDDEN') {
      return NextResponse.json({
        success: true,
        activated: true,
        verification_status: tx.payer_verification_status,
        subscription_id: razorpay_subscription_id,
        order_id: tx.order_id,
        message: 'Your SIP is active.',
      })
    }

    // ── 2. Fetch payer bank details ─────────────────────────────────────────
    let payment: any
    let token: any = null
    try {
      const razorpay = getRazorpayClient()
      payment = await razorpay.payments.fetch(razorpay_payment_id)

      // For eMandate/NACH the bank details hang off the token, not the payment.
      if (payment?.token_id) {
        try {
          token = await (razorpay as any).tokens?.fetch?.(payment.customer_id, payment.token_id) ?? null
        } catch {
          // Token fetch is best-effort; a failure just means fewer signals and
          // therefore an UNVERIFIABLE outcome, which is safe.
          token = null
        }
      }
    } catch (err) {
      throw normaliseRazorpayError(err)
    }

    const payerAccount = extractPayerAccount(payment, token)

    // ── 3. Decide ────────────────────────────────────────────────────────────
    const result = decide(
      {
        accountNumber: tx.account_number,
        ifsc:          tx.ifsc_code,
        holderName:    tx.client_name,
      },
      payerAccount,
    )

    console.log(
      `[razorpay/verify-payer] subscription=${razorpay_subscription_id} ` +
      `method=${payerAccount.method} verdict=${result.status} activate=${result.canActivate}`,
    )

    // ── 4. Apply — activate ONLY on MATCHED ─────────────────────────────────
    const nextInvestmentStatus = result.canActivate ? 'SIP_ACTIVE' : 'SIP_PENDING_VERIFICATION'

    await pool.query(
      `UPDATE payment_transactions SET
         razorpay_payment_id       = COALESCE(razorpay_payment_id, $1),
         payer_verification_status = $2,
         payer_account_last4       = $3,
         payer_ifsc                = $4,
         payer_account_holder      = $5,
         payer_verification_note   = $6,
         payer_verified_at         = NOW(),
         investment_status         = CASE
           WHEN investment_status IN ('SIP_CANCELLED','SIP_COMPLETED','EXPIRED')
             THEN investment_status
           ELSE $7
         END,
         updated_at = NOW()
       WHERE razorpay_subscription_id = $8`,
      [
        razorpay_payment_id,
        result.status,
        result.payerLast4,
        payerAccount.ifsc,
        payerAccount.holderName,
        result.note,
        nextInvestmentStatus,
        razorpay_subscription_id,
      ],
    )

    if (result.canActivate) {
      notifyClientById(tx.client_id, 'SIP_ACTIVE', {
        amount:         parseFloat(tx.amount),
        subscriptionId: razorpay_subscription_id,
        frequency:      tx.frequency ?? undefined,
        nextChargeDate: tx.next_charge_date ?? undefined,
      }).catch(() => {})

      return NextResponse.json({
        success: true,
        activated: true,
        verification_status: result.status,
        subscription_id: razorpay_subscription_id,
        order_id: tx.order_id,
        message: 'Your SIP is active.',
      })
    }

    // Held. Loud log — MISMATCH in particular means someone attempted to fund a
    // portfolio from an account that is not theirs on record.
    if (result.status === 'MISMATCH') {
      console.error(
        `[razorpay/verify-payer] THIRD-PARTY ACCOUNT BLOCKED subscription=${razorpay_subscription_id} ` +
        `nuvama=${tx.nuvama_code} payer_last4=${result.payerLast4} — ${result.note}`,
      )
    } else {
      console.warn(
        `[razorpay/verify-payer] mandate held for review subscription=${razorpay_subscription_id} ` +
        `nuvama=${tx.nuvama_code} — ${result.note}`,
      )
    }

    return NextResponse.json({
      success: true,        // the customer's action succeeded
      activated: false,     // but we have not activated it
      verification_status: result.status,
      subscription_id: razorpay_subscription_id,
      order_id: tx.order_id,
      message:
        result.status === 'MISMATCH'
          ? 'Your mandate was authorised from a bank account that does not match the one registered with us. ' +
            'For regulatory reasons your SIP cannot start until this is resolved. Our team will contact you shortly.'
          : 'Your mandate has been authorised and is pending a final verification check. ' +
            'Our team will confirm your SIP within one working day.',
    })
  } catch (error: any) {
    if (error instanceof RazorpayError) {
      console.error(`[razorpay/verify-payer] ${error.code}: ${error.message}`)
      return NextResponse.json(
        { success: false, error: error.message, error_code: error.code },
        { status: error.statusCode },
      )
    }
    console.error('[razorpay/verify-payer] unhandled:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'We could not confirm your mandate right now. Our team will verify it shortly.',
        error_code: 'PAYER_VERIFICATION_ERROR',
      },
      { status: 500 },
    )
  }
}
