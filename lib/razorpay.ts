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
