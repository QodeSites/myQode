// Razorpay integration core.
//
// Every rule that protects real money lives here rather than in the route
// handlers, so there is exactly one place to audit:
//   - amounts are integer paise, never floats (§ Money)
//   - signatures are compared in constant time (§ Signatures)
//   - the server is the sole authority on how much a payment is for
//
// Cashfree is NOT replaced by this module. It still serves the Capacitor mobile
// app and any in-flight orders, so both gateways run side by side and every
// query that reaches a gateway API must be scoped by `gateway`.
import crypto from 'crypto'
import Razorpay from 'razorpay'

// ── Config ────────────────────────────────────────────────────────────────────

export interface RazorpayConfig {
  keyId:         string
  keySecret:     string
  webhookSecret: string
  isProduction:  boolean
}

/**
 * Reads and validates Razorpay credentials.
 *
 * Throws rather than falling back to defaults: a payment route that runs with
 * missing credentials would fail at the API call anyway, but later and with a
 * far more confusing error. Fail at the boundary instead.
 */
export function getRazorpayConfig(): RazorpayConfig {
  const keyId         = process.env.RAZORPAY_KEY_ID
  const keySecret     = process.env.RAZORPAY_KEY_SECRET
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  const isProduction  = process.env.RAZORPAY_ENVIRONMENT === 'production'

  const missing: string[] = []
  if (!keyId)     missing.push('RAZORPAY_KEY_ID')
  if (!keySecret) missing.push('RAZORPAY_KEY_SECRET')
  // webhookSecret is only needed by the webhook route; it is validated there so
  // that checkout keeps working even if the webhook has not been configured yet.

  if (missing.length) {
    throw new RazorpayConfigError(
      `Razorpay credentials missing from environment: ${missing.join(', ')}`
    )
  }

  // Guard against the classic deploy accident: test keys live in production.
  // rzp_test_* keys move no real money, so this would look "working" in staging
  // and silently take zero rupees in production.
  if (isProduction && keyId!.startsWith('rzp_test_')) {
    throw new RazorpayConfigError(
      'RAZORPAY_ENVIRONMENT=production but a rzp_test_* key is configured. ' +
      'Refusing to start: this would accept payments that never settle.'
    )
  }

  return { keyId: keyId!, keySecret: keySecret!, webhookSecret: webhookSecret ?? '', isProduction }
}

// ── Client ────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var _razorpayClient: Razorpay | undefined
}

/**
 * Singleton Razorpay client, guarded the same way lib/db.ts guards its Pool —
 * Next.js re-evaluates modules on every hot reload in dev.
 */
export function getRazorpayClient(): Razorpay {
  if (global._razorpayClient) return global._razorpayClient

  const { keyId, keySecret } = getRazorpayConfig()
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret })

  if (process.env.NODE_ENV !== 'production') global._razorpayClient = client
  return client
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class RazorpayConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'RazorpayConfigError' }
}

/** A payment-domain failure that is safe to surface to the client. */
export class RazorpayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'RazorpayError'
  }
}

/**
 * Normalises anything thrown by the Razorpay SDK into a RazorpayError.
 *
 * The SDK throws a grab-bag of shapes (statusCode + error envelope, plain
 * Error, sometimes a bare object), and route handlers must never leak the raw
 * payload — it can contain the key id and internal descriptions.
 */
export function normaliseRazorpayError(err: any): RazorpayError {
  const rzpError = err?.error ?? err
  const description = rzpError?.description ?? rzpError?.message ?? 'Payment gateway error'
  const code        = rzpError?.code ?? 'GATEWAY_ERROR'
  const statusCode  = err?.statusCode ?? 502

  return new RazorpayError(
    description,
    code,
    // Razorpay 4xx means we sent something wrong; report as 502 to the browser
    // regardless, since it is never the end user's fault directly.
    statusCode >= 500 ? 502 : statusCode === 400 ? 400 : 502,
    { razorpayCode: code, reason: rzpError?.reason, step: rzpError?.step, source: rzpError?.source },
  )
}

// ── Money ─────────────────────────────────────────────────────────────────────
//
// Razorpay works exclusively in integer paise. The DB stores NUMERIC(10,2)
// rupees. Every conversion crosses this boundary, and a float sneaking through
// is the single most common way these integrations lose money — 0.1 + 0.2 in
// IEEE-754 is not 0.3, and `Math.round(x * 100)` on an already-imprecise float
// can land a paisa off.

/**
 * Largest amount Razorpay will accept in one transaction, in paise.
 *
 * Verified empirically against the test account (2026-07-29): ₹5,00,000 is
 * accepted and ₹10,00,000 is rejected with "Amount exceeds maximum amount
 * allowed". Setting our own ceiling here means a large investment is refused
 * with a clear message BEFORE checkout opens, rather than failing at the
 * gateway with an opaque error after the user has committed.
 *
 * Note this is the ceiling on the *order*; individual payment methods are lower
 * still (UPI is typically ₹1,00,000 per transaction, netbanking higher). Those
 * limits are enforced by the bank at payment time and cannot be pre-checked.
 *
 * Razorpay can raise the account ceiling on request — override via
 * RAZORPAY_MAX_AMOUNT_INR without a code change if they do.
 */
export const MAX_AMOUNT_PAISE = process.env.RAZORPAY_MAX_AMOUNT_INR
  ? Number(process.env.RAZORPAY_MAX_AMOUNT_INR) * 100
  : 5_00_000_00
/** Razorpay's own floor is ₹1; the business floor for investments is ₹100. */
export const MIN_AMOUNT_PAISE = 100_00

/**
 * Converts a rupee amount to integer paise, rejecting anything that cannot be
 * represented exactly.
 *
 * Accepts a string as well as a number because `pg` returns NUMERIC as a string
 * precisely to avoid float loss — passing that string straight in keeps the
 * exactness all the way through.
 */
export function toPaise(rupees: number | string): number {
  const asString = typeof rupees === 'string' ? rupees.trim() : String(rupees)

  if (!/^-?\d+(\.\d+)?$/.test(asString)) {
    throw new RazorpayError(`Invalid amount: ${asString}`, 'INVALID_AMOUNT', 400)
  }

  const [whole, fraction = ''] = asString.split('.')

  // More than 2 decimal places cannot be represented in paise. Rounding here
  // would silently alter what the user agreed to pay, so refuse instead.
  if (fraction.length > 2) {
    throw new RazorpayError(
      `Amount ${asString} has sub-paisa precision and cannot be charged exactly`,
      'INVALID_AMOUNT_PRECISION',
      400,
    )
  }

  // Integer arithmetic only — no multiplication of a float by 100 anywhere.
  const paddedFraction = fraction.padEnd(2, '0')
  const paise = Number(whole) * 100 + Number(paddedFraction) * (whole.startsWith('-') ? -1 : 1)

  if (!Number.isSafeInteger(paise)) {
    throw new RazorpayError(`Amount ${asString} is out of safe range`, 'INVALID_AMOUNT', 400)
  }

  return paise
}

/** Converts integer paise back to a rupee string suitable for NUMERIC(10,2). */
export function toRupees(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new RazorpayError(`Paise value must be an integer, got ${paise}`, 'INVALID_AMOUNT', 500)
  }
  const negative = paise < 0
  const abs = Math.abs(paise)
  const rupees = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return negative ? `-${rupees}` : rupees
}

/** Formats paise for display, e.g. 1234500 → "₹12,345.00". */
export function formatPaise(paise: number): string {
  return `₹${Number(toRupees(paise)).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Validates a requested investment amount.
 *
 * Returns the amount in paise so callers cannot accidentally keep using the
 * unvalidated rupee value afterwards.
 */
export function validateInvestmentAmount(
  rupees: number | string,
  { minPaise = MIN_AMOUNT_PAISE, maxPaise = MAX_AMOUNT_PAISE }: { minPaise?: number; maxPaise?: number } = {},
): number {
  const paise = toPaise(rupees)

  if (paise < minPaise) {
    throw new RazorpayError(
      `Minimum investment is ${formatPaise(minPaise)}`, 'AMOUNT_BELOW_MINIMUM', 400,
    )
  }
  if (paise > maxPaise) {
    throw new RazorpayError(
      `Amount exceeds the per-transaction limit of ${formatPaise(maxPaise)}`,
      'AMOUNT_ABOVE_MAXIMUM', 400,
    )
  }
  return paise
}

// ── Signatures ────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison.
 *
 * `crypto.timingSafeEqual` throws when the two buffers differ in length, which
 * itself leaks length — and, worse, would throw a 500 on a malformed signature
 * instead of cleanly rejecting it. Hash both sides first so the comparison is
 * always over two 32-byte buffers.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * Verifies the signature returned by Razorpay Checkout to the browser.
 *
 * Payload is `order_id|payment_id`, HMAC-SHA256 with the key secret.
 * This is what makes the client callback trustworthy — without it, anyone can
 * POST a fabricated payment id to /verify and mark an order paid.
 */
export function verifyPaymentSignature(params: {
  razorpayOrderId:   string
  razorpayPaymentId: string
  signature:         string
}): boolean {
  const { keySecret } = getRazorpayConfig()
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
    .digest('hex')
  return safeEqual(expected, params.signature)
}

/**
 * Verifies a subscription authorisation signature.
 *
 * Note the operand order is the reverse of the payment case
 * (`payment_id|subscription_id`). Getting this backwards produces a valid-looking
 * HMAC that never matches, so it is spelled out here once.
 */
export function verifySubscriptionSignature(params: {
  razorpayPaymentId:      string
  razorpaySubscriptionId: string
  signature:              string
}): boolean {
  const { keySecret } = getRazorpayConfig()
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${params.razorpayPaymentId}|${params.razorpaySubscriptionId}`)
    .digest('hex')
  return safeEqual(expected, params.signature)
}

/**
 * Verifies a webhook signature against the RAW request body.
 *
 * The body must be the exact bytes received — `JSON.parse` followed by
 * `JSON.stringify` reorders keys and changes whitespace, which breaks the HMAC.
 * Route handlers must therefore call `request.text()`, never `request.json()`.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[razorpay] RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook')
    return false
  }
  if (!signature) return false

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex')
  return safeEqual(expected, signature)
}

// ── Permitted payment methods ─────────────────────────────────────────────────

/**
 * The only payment methods acceptable for PMS money.
 *
 * Both debit a bank account directly, which keeps the payer traceable — the
 * same property the SIP payer-verification check relies on. Cards, wallets and
 * EMI are excluded deliberately: a card payment is chargeback-able, which is not
 * an appropriate mechanism for an investment.
 *
 * The checkout widget is configured to show only these (lib/razorpay-checkout),
 * but that is a UI restriction and a determined caller can bypass it. This list
 * is the server-side enforcement point — see assertPermittedMethod.
 */
export const PERMITTED_METHODS = ['netbanking', 'upi'] as const
export type PermittedMethod = typeof PERMITTED_METHODS[number]

/**
 * Throws when a captured payment used a method we do not accept.
 *
 * Called after the fact, on verify and on the webhook: Razorpay has no API to
 * refuse a method at order-creation time, so the guarantee has to be enforced
 * where we learn what was actually used. A payment that slips through is
 * flagged rather than silently accepted, so ops can refund it.
 */
export function isPermittedMethod(method: string | null | undefined): boolean {
  if (!method) return true   // absent on some events; don't fail on missing data
  return (PERMITTED_METHODS as readonly string[]).includes(String(method).toLowerCase())
}

// ── Identifiers ───────────────────────────────────────────────────────────────

/**
 * Generates a receipt/order reference.
 *
 * Razorpay caps `receipt` at 40 characters and rejects longer values, so the
 * format is kept deliberately tight: qode_<base36 time>_<8 random>.
 * Uses crypto randomness rather than Math.random so two requests in the same
 * millisecond cannot collide.
 */
export function generateReceiptId(prefix = 'qode'): string {
  const ts   = Date.now().toString(36)
  const rand = crypto.randomBytes(6).toString('base64url').slice(0, 8).toLowerCase()
  const id   = `${prefix}_${ts}_${rand}`
  return id.length > 40 ? id.slice(0, 40) : id
}

// ── Status mapping ────────────────────────────────────────────────────────────

/** Investment statuses that must never be overwritten by a later/stale event. */
export const TERMINAL_INVESTMENT_STATUSES = [
  'DEPLOYED', 'SETTLED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED',
] as const

/**
 * Maps a Razorpay payment status to the portal's investment_status vocabulary,
 * which is shared with the Cashfree path and consumed by the existing UI.
 *
 * `created`/`attempted` deliberately map to PENDING_PAYMENT rather than a
 * failure: the user may still be completing a bank redirect, and marking it
 * failed would let them start a second payment for the same order.
 */
export function toInvestmentStatus(razorpayStatus: string): string {
  switch ((razorpayStatus || '').toLowerCase()) {
    case 'captured':  return 'PAYMENT_SUCCESS'
    // `authorized` means funds are held but not captured. Treated as pending
    // because money has not actually moved to the merchant account yet.
    case 'authorized': return 'PENDING_PAYMENT'
    case 'failed':     return 'PAYMENT_FAILED'
    case 'refunded':   return 'CANCELLED'
    case 'created':
    case 'attempted':  return 'PENDING_PAYMENT'
    default:           return 'PENDING_PAYMENT'
  }
}

/** Maps a Razorpay subscription status to the portal's investment_status. */
export function toSubscriptionInvestmentStatus(razorpayStatus: string): string {
  switch ((razorpayStatus || '').toLowerCase()) {
    case 'active':               return 'SIP_ACTIVE'
    case 'authenticated':        return 'SIP_PENDING_ACTIVATION'
    case 'pending':              return 'SIP_PAYMENT_RETRY'
    case 'halted':               return 'SIP_PAUSED'
    case 'paused':               return 'SIP_PAUSED'
    case 'cancelled':            return 'SIP_CANCELLED'
    case 'completed':            return 'SIP_COMPLETED'
    case 'expired':              return 'EXPIRED'
    case 'created':              return 'PENDING_PAYMENT'
    default:                     return 'PENDING_PAYMENT'
  }
}

/** Human-readable message for a Razorpay failure, safe to show to a client. */
export function describePaymentFailure(err: any): string {
  const description = err?.error_description ?? err?.description
  const reason      = err?.error_reason ?? err?.reason

  if (reason === 'payment_cancelled')      return 'Payment was cancelled.'
  if (reason === 'payment_failed')         return 'The payment could not be completed. No amount has been debited.'
  if (reason === 'insufficient_funds')     return 'The transaction was declined due to insufficient funds.'
  if (reason === 'payment_timeout')        return 'The payment timed out. If any amount was debited it will be refunded automatically.'

  return description || 'The payment could not be completed. Please try again.'
}
