// Browser-side Razorpay Checkout helper.
//
// Kept out of the page component deliberately: the payment edge cases below are
// the ones that decide whether a client's money is accounted for, and they
// deserve to be readable in isolation rather than buried in a 3000-line form.
//
// The cases that actually happen in production:
//   - user dismisses the modal after the bank debited them (ondismiss fires,
//     but the payment may still succeed → never report "cancelled" as final)
//   - network dies between debit and our /verify call (verify fails, webhook
//     still lands → the UI must say "confirming", not "failed")
//   - the SDK script is blocked by an ad-blocker or a flaky CDN
//   - double-click on Pay opening two checkouts for two different orders
//   - the tab is backgrounded/killed mid-payment (only the webhook saves us)
//
// Guiding rule: THE BROWSER NEVER DECIDES A PAYMENT FAILED. Only the gateway
// does. Anything the browser cannot confirm is reported as "pending
// confirmation" so the user is never wrongly told their debit did not happen.

export interface RazorpayCheckoutOptions {
  keyId:       string
  amountPaise: number
  currency?:   string
  name?:       string
  description?: string
  imageUrl?:   string
  /** One-time payment: the Razorpay order id. */
  orderId?:    string
  /** SIP: the Razorpay subscription id. Mutually exclusive with orderId. */
  subscriptionId?: string
  prefill?: {
    name?:    string
    email?:   string
    contact?: string
  }
  notes?:      Record<string, string>
  themeColor?: string
}

export type CheckoutOutcome =
  | { kind: 'success';   paymentId: string; orderId?: string; subscriptionId?: string; signature: string }
  | { kind: 'dismissed' }                                    // modal closed, no payment made
  | { kind: 'failed';    message: string; code?: string }     // gateway reported failure
  | { kind: 'unavailable'; message: string }                  // SDK never loaded

const SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js'
const SDK_LOAD_TIMEOUT_MS = 15_000

declare global {
  interface Window {
    Razorpay?: new (options: any) => { open: () => void; close: () => void; on: (event: string, cb: (r: any) => void) => void }
  }
}

let sdkPromise: Promise<boolean> | null = null

/**
 * Loads the Razorpay Checkout script once.
 *
 * The promise is cached so that a double-click cannot append two <script> tags,
 * and a failed load resets the cache so a retry can succeed (e.g. the user
 * disabled their ad-blocker and tried again).
 */
export function loadRazorpaySdk(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<boolean>((resolve) => {
    // Reuse an existing tag if one is already in flight from a previous attempt.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`)
    const script = existing ?? document.createElement('script')

    const timeout = setTimeout(() => {
      console.error('[razorpay-checkout] SDK load timed out')
      sdkPromise = null
      resolve(false)
    }, SDK_LOAD_TIMEOUT_MS)

    script.addEventListener('load', () => {
      clearTimeout(timeout)
      resolve(Boolean(window.Razorpay))
    })

    script.addEventListener('error', () => {
      clearTimeout(timeout)
      console.error('[razorpay-checkout] SDK failed to load (ad-blocker or network)')
      sdkPromise = null   // allow a retry
      resolve(false)
    })

    if (!existing) {
      script.src = SDK_URL
      script.async = true
      document.body.appendChild(script)
    }
  })

  return sdkPromise
}

/**
 * Opens Razorpay Checkout and resolves with the outcome.
 *
 * Never rejects — every failure mode is a typed outcome, so callers cannot
 * accidentally treat "user closed the modal" and "gateway declined the card"
 * as the same thing via a catch-all.
 */
export function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<CheckoutOutcome> {
  return new Promise(async (resolve) => {
    const loaded = await loadRazorpaySdk()
    if (!loaded || !window.Razorpay) {
      resolve({
        kind: 'unavailable',
        message:
          'The payment window could not be loaded. Please disable any ad-blocker for this site and try again.',
      })
      return
    }

    // Guards against double-resolution: Razorpay can fire both payment.failed
    // and ondismiss for the same interaction.
    let settled = false
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    // The LAST failure Razorpay reported, held rather than resolved.
    //
    // A failed attempt does NOT end the checkout: Razorpay keeps the same modal
    // open and offers a retry, so the user can pick another bank and succeed
    // within the same interaction. Resolving on `payment.failed` ended the
    // promise while the modal was still live — a subsequent success then hit an
    // already-settled promise and was discarded, showing "payment failed" for a
    // payment Razorpay had actually captured.
    //
    // So the failure is remembered and only surfaces if the user gives up
    // (ondismiss). If they retry and succeed, `handler` settles first and this
    // is never used.
    let lastFailure: { message: string; code?: string } | null = null

    const config: any = {
      key:      options.keyId,
      currency: options.currency ?? 'INR',
      name:     options.name ?? 'Qode Advisors',
      description: options.description,
      image:    options.imageUrl,
      prefill:  options.prefill ?? {},
      notes:    options.notes ?? {},
      // Brand green — matches --primary in globals.css.
      theme:    { color: options.themeColor ?? '#02422b' },

      // ── Payment methods ─────────────────────────────────────────────────
      // PMS subscriptions are not retail purchases: funds must come from the
      // investor's own bank account, and card payments are chargeback-able,
      // which is not appropriate for an investment. Netbanking and UPI both
      // debit a bank account directly and keep the payer traceable, which is
      // also what the payer-verification check depends on.
      //
      // `display.blocks` + `display.preferences.show_default_blocks: false`
      // is what actually hides the other methods; listing only these two in
      // `method` is not sufficient on its own.
      method: {
        netbanking: true,
        upi:        true,
        card:       false,
        wallet:     false,
        emi:        false,
        paylater:   false,
        cardless_emi: false,
        bank_transfer: false,
      },
      display: {
        blocks: {
          banks: {
            name: 'Pay from your bank account',
            instruments: [
              { method: 'netbanking' },
              { method: 'upi' },
            ],
          },
        },
        sequence: ['block.banks'],
        preferences: { show_default_blocks: false },
      },

      handler: (response: any) => {
        // Razorpay only calls this on a successful authorisation. The signature
        // is meaningless until the server verifies it — the caller MUST post it
        // to /api/razorpay/verify before showing success.
        settle({
          kind: 'success',
          paymentId:      response.razorpay_payment_id,
          orderId:        response.razorpay_order_id,
          subscriptionId: response.razorpay_subscription_id,
          signature:      response.razorpay_signature,
        })
      },

      modal: {
        // Keep the user in the modal if they click the backdrop mid-payment;
        // an accidental dismissal after a bank redirect is a support call.
        backdropclose: false,
        escape: true,
        ondismiss: () => {
          // Fires when the user closes the modal. If `handler` already ran this
          // is a no-op thanks to `settled` — which matters, because Razorpay
          // fires ondismiss after handler on some flows.
          //
          // Closing after a failed attempt means they gave up on that failure,
          // so report it rather than a bare dismissal — the user saw a decline
          // and deserves to be told why.
          if (lastFailure) {
            settle({ kind: 'failed', message: lastFailure.message, code: lastFailure.code })
            return
          }
          settle({ kind: 'dismissed' })
        },
      },
    }

    if (options.subscriptionId) {
      config.subscription_id = options.subscriptionId
      // Mandate authorisation: the amount shown is the plan amount.
      config.recurring = 1

      // Recurring debits use different rails than a one-off payment: eMandate
      // (netbanking) and UPI Autopay. Card mandates are excluded for the same
      // reason as card payments, and more so — a card mandate authorises
      // repeated debits against a chargeback-able instrument.
      config.method = { netbanking: true, upi: true, card: false, wallet: false, emi: false };
      config.display = {
        blocks: {
          mandate: {
            name: 'Authorise from your bank account',
            instruments: [
              { method: 'netbanking' },   // eMandate / NACH
              { method: 'upi' },          // UPI Autopay
            ],
          },
        },
        sequence: ['block.mandate'],
        preferences: { show_default_blocks: false },
      }
    } else {
      config.order_id = options.orderId
      config.amount   = options.amountPaise
    }

    try {
      const rzp = new window.Razorpay(config)

      rzp.on('payment.failed', (response: any) => {
        const err = response?.error ?? {}
        console.error('[razorpay-checkout] payment.failed', err)
        // Recorded, NOT resolved — the modal is still open and the user may
        // retry with a different bank or method. See `lastFailure` above.
        lastFailure = {
          message: err.description || 'The payment could not be completed.',
          code: err.code,
        }
      })

      rzp.open()
    } catch (err: any) {
      console.error('[razorpay-checkout] failed to open checkout', err)
      settle({
        kind: 'unavailable',
        message: 'The payment window could not be opened. Please try again.',
      })
    }
  })
}

// ── Server round-trips ────────────────────────────────────────────────────────

export interface VerifyResult {
  status:  'success' | 'failed' | 'pending'
  message: string
  orderId?: string
  investmentStatus?: string
}

/**
 * Confirms a one-time payment with our server.
 *
 * A network failure here maps to 'pending', NOT 'failed'. The money may well
 * have moved; the webhook is authoritative and will reconcile. Telling the user
 * their payment failed at this point would be a lie that generates a support
 * ticket and, worse, a duplicate payment.
 */
export async function verifyPayment(params: {
  razorpayOrderId:   string
  razorpayPaymentId: string
  signature:         string
}): Promise<VerifyResult> {
  try {
    const res = await fetch('/api/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        razorpay_order_id:   params.razorpayOrderId,
        razorpay_payment_id: params.razorpayPaymentId,
        razorpay_signature:  params.signature,
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (res.ok && data.success) {
      return {
        status: 'success',
        message: 'Payment confirmed.',
        orderId: data.order_id,
        investmentStatus: data.investment_status,
      }
    }

    // A 5xx means we could not confirm — not that the payment failed.
    if (res.status >= 500) {
      return {
        status: 'pending',
        message:
          'Your payment went through but we are still confirming it. ' +
          'This usually takes a few moments — you will receive an email once confirmed.',
        orderId: data.order_id,
      }
    }

    return {
      status: 'failed',
      message: data.error || 'The payment could not be verified.',
      orderId: data.order_id,
    }
  } catch {
    // Network died between debit and verification.
    return {
      status: 'pending',
      message:
        'We could not reach our servers to confirm the payment. ' +
        'If the amount was debited it will be reflected shortly — please do not pay again.',
    }
  }
}

/** Confirms a SIP mandate and runs the payer-account check server-side. */
export async function verifyMandate(params: {
  razorpayPaymentId:      string
  razorpaySubscriptionId: string
  signature:              string
}): Promise<VerifyResult & { activated?: boolean; verificationStatus?: string }> {
  try {
    const res = await fetch('/api/razorpay/subscriptions/verify-payer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        razorpay_payment_id:      params.razorpayPaymentId,
        razorpay_subscription_id: params.razorpaySubscriptionId,
        razorpay_signature:       params.signature,
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (res.ok && data.success) {
      return {
        status: data.activated ? 'success' : 'pending',
        message: data.message,
        orderId: data.order_id,
        activated: data.activated,
        verificationStatus: data.verification_status,
      }
    }

    if (res.status >= 500) {
      return {
        status: 'pending',
        message: 'Your mandate was authorised but we are still confirming it. Our team will verify it shortly.',
      }
    }

    return { status: 'failed', message: data.error || 'The mandate could not be verified.' }
  } catch {
    return {
      status: 'pending',
      message: 'We could not reach our servers to confirm the mandate. Our team will verify it shortly.',
    }
  }
}
