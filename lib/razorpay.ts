// Razorpay helpers for the mobile one-time payment flow (app/api/mobile/payments/razorpay/*).
// Uses Razorpay's REST API directly (basic auth) — no SDK dependency.
//
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_ENVIRONMENT (test|live)
// Safety with TEST keys (rzp_test_*): the real client's email/phone are NEVER sent to Razorpay, so no
// gateway receipt/SMS can reach them while testing with a real account.
import crypto from 'crypto'

const API = 'https://api.razorpay.com/v1'

export function razorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID || ''
  const keySecret = process.env.RAZORPAY_KEY_SECRET || ''
  if (!keyId || !keySecret) throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)')
  const isTest = keyId.startsWith('rzp_test_') || (process.env.RAZORPAY_ENVIRONMENT || '').toLowerCase() === 'test'
  return { keyId, keySecret, isTest, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '' }
}

async function rz(path: string, init?: RequestInit) {
  const { keyId, keySecret } = razorpayConfig()
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
  const body: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error?.description || `Razorpay ${path} failed (${res.status})`)
  return body
}

// amount in rupees → Razorpay wants paise
export function createRazorpayOrder(amountRupees: number, receipt: string, notes: Record<string, string>) {
  return rz('/orders', { method: 'POST', body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt, notes }) })
}

// ── SIP (Razorpay Subscriptions) ─────────────────────────────────────────────
// A Plan is just an amount+interval template — created fresh per SIP (not reused across
// clients), same as the web's Cashfree plan_name being unique per subscription.
// Verified live against the test API (2026-09-23): POST /plans → { id, ... },
// POST /subscriptions → { id, status:'created', short_url, ... }.
const FREQUENCY_TO_PERIOD: Record<string, { period: string; interval: number }> = {
  daily:     { period: 'daily',   interval: 1 },
  weekly:    { period: 'weekly',  interval: 1 },
  monthly:   { period: 'monthly', interval: 1 },
  quarterly: { period: 'monthly', interval: 3 },
  yearly:    { period: 'yearly',  interval: 1 },
}
export function frequencyToPeriod(frequency: string) {
  return FREQUENCY_TO_PERIOD[frequency] || FREQUENCY_TO_PERIOD.monthly
}

export function createRazorpayPlan(amountRupees: number, frequency: string, planName: string) {
  const { period, interval } = frequencyToPeriod(frequency)
  return rz('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period, interval,
      item: { name: planName, amount: Math.round(amountRupees * 100), currency: 'INR', description: `Qode SIP · ${frequency}` },
    }),
  })
}

// Client communication is decided by the KEYS, not by code paths, so production behaves like the web
// with nothing to remember: TEST keys → the client is never contacted (Razorpay notify off, placeholder
// contact, no server notifications); LIVE keys → Razorpay's mandate/charge emails+SMS and our own
// notifications are on. RAZORPAY_NOTIFY_CLIENT=true|false overrides the server-side part explicitly.
export function shouldNotifyClient() {
  const flag = (process.env.RAZORPAY_NOTIFY_CLIENT || '').toLowerCase()
  if (flag === 'true') return true
  if (flag === 'false') return false
  return !razorpayConfig().isTest
}

// What Checkout is told about the payer. Three modes:
//   test keys                      → placeholders (nothing can reach anyone)
//   live keys, notifications off   → name only: the person paying types their OWN email/phone on Checkout,
//                                     so Razorpay's receipts go to them, never to the client on file
//                                     (LIVE testing with a real client account and real money)
//   live keys, notifications on    → the client's real email/phone (production)
export function checkoutContact(name: string, email: string | null | undefined, phone: string | null | undefined) {
  const cfg = razorpayConfig()
  if (cfg.isTest) return { name, email: 'test@razorpay.com', contact: '9999999999' }
  if (!shouldNotifyClient()) return { name }
  return { name, email: email || undefined, contact: phone || undefined }
}

// total_count: Razorpay requires a finite cycle count (max charges), even for an "indefinite" SIP.
// customer_notify: Razorpay's own emails/SMS to the customer about the mandate and each charge — on with
// live keys (what the web's Cashfree flow does with notification_channel EMAIL+SMS), off with test keys.
// expire_by: the client must authorise within 2 days, else Razorpay marks the subscription 'expired' by
// itself — abandoned set-ups don't sit as pending mandates forever.
export function createRazorpaySubscription(planId: string, totalCount: number, notes: Record<string, string>, startAt?: number) {
  return rz('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId, total_count: totalCount, quantity: 1, customer_notify: shouldNotifyClient() ? 1 : 0,
      expire_by: Math.floor(Date.now() / 1000) + 2 * 24 * 3600,
      ...(startAt ? { start_at: startAt } : {}),
      notes,
    }),
  })
}

export function fetchRazorpaySubscription(subscriptionId: string) {
  return rz('/subscriptions/' + encodeURIComponent(subscriptionId))
}

// Pause/resume take no parameters (Razorpay rejects pause_at/resume_at: "not required and should not be
// sent"). ONLY an `active` subscription (first instalment already charged) can be paused; pausing one that
// is merely `authenticated` (mandate registered, first charge pending) CANCELS it — verified live. The
// pause-resume-sip route checks the live status first for that reason.
export function pauseRazorpaySubscription(subscriptionId: string) {
  return rz('/subscriptions/' + encodeURIComponent(subscriptionId) + '/pause', { method: 'POST', body: '{}' })
}
export function resumeRazorpaySubscription(subscriptionId: string) {
  return rz('/subscriptions/' + encodeURIComponent(subscriptionId) + '/resume', { method: 'POST', body: '{}' })
}
export function cancelRazorpaySubscription(subscriptionId: string, cancelAtCycleEnd = false) {
  return rz('/subscriptions/' + encodeURIComponent(subscriptionId) + '/cancel', { method: 'POST', body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }) })
}

export function fetchRazorpayPayment(paymentId: string) {
  return rz('/payments/' + encodeURIComponent(paymentId))
}

export function fetchRazorpayOrder(orderId: string) {
  return rz('/orders/' + encodeURIComponent(orderId))
}

export function fetchRazorpayOrderPayments(orderId: string) {
  return rz('/orders/' + encodeURIComponent(orderId) + '/payments')
}

const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex')
const safeEq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b)
  return A.length === B.length && crypto.timingSafeEqual(A, B)
}

// Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  return safeEq(hmac(razorpayConfig().keySecret, `${orderId}|${paymentId}`), String(signature || ''))
}

// Subscription checkout success uses a DIFFERENT formula: payment_id + "|" + subscription_id (order swapped).
export function verifySubscriptionSignature(subscriptionId: string, paymentId: string, signature: string) {
  return safeEq(hmac(razorpayConfig().keySecret, `${paymentId}|${subscriptionId}`), String(signature || ''))
}

// Webhook: X-Razorpay-Signature = HMAC_SHA256(raw body, webhook_secret)
export function verifyWebhookSignature(rawBody: string, signature: string) {
  const { webhookSecret } = razorpayConfig()
  if (!webhookSecret) return false
  return safeEq(hmac(webhookSecret, rawBody), String(signature || ''))
}

// Short-lived link token so the hosted checkout page can be opened in a WebView without the JWT in the URL.
export function checkoutToken(orderId: string, exp: number) {
  return hmac(razorpayConfig().keySecret, `checkout|${orderId}|${exp}`)
}
export function verifyCheckoutToken(orderId: string, exp: number, token: string) {
  return exp > Date.now() && safeEq(checkoutToken(orderId, exp), String(token || ''))
}

// Razorpay payment.method → the jsonb shape the existing investment-status route already displays
export function paymentMethodJson(p: any) {
  const m = p?.method
  if (m === 'upi') return { upi: { channel: 'collect', upi_id: p.vpa || null } }
  if (m === 'netbanking') return { netbanking: { netbanking_bank_name: p.bank || null } }
  if (m === 'card') return { card: { card_network: p.card?.network || null, card_number: p.card?.last4 ? 'XXXX' + p.card.last4 : null } }
  if (m === 'wallet') return { wallet: { provider: p.wallet || null } }
  return m ? { [m]: {} } : null
}
