// Sign-in for the /pay payment demonstration (for the payment gateway's website review): one demo login, checked on
// the server, then an httpOnly cookie for 12 hours. Override the login with PAY_DEMO_EMAIL / PAY_DEMO_PASSWORD.
// This only gates the demonstration page and its order API; it is not a client account and opens nothing else.
import crypto from 'crypto'
import type { NextRequest } from 'next/server'

export const PAY_DEMO_COOKIE = 'pay_demo'
export const PAY_DEMO_MAX_AGE = 12 * 60 * 60

const login = () => ({
  email: (process.env.PAY_DEMO_EMAIL || 'razorpay@qodeinvest.com').trim().toLowerCase(),
  password: process.env.PAY_DEMO_PASSWORD || 'Razorpay@123',
})
const secret = () => process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'qode-pay-demo'
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function checkPayDemoLogin(email: unknown, password: unknown): boolean {
  const l = login()
  return same(String(email || '').trim().toLowerCase(), l.email) && same(String(password || ''), l.password)
}

// cookie value: expiry + HMAC(expiry, login email)
export function payDemoToken(now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + PAY_DEMO_MAX_AGE)
  return exp + '.' + crypto.createHmac('sha256', secret()).update(exp + ':' + login().email).digest('hex')
}

export function isPayDemoSignedIn(req: NextRequest): boolean {
  const v = req.cookies.get(PAY_DEMO_COOKIE)?.value || ''
  const [exp, sig] = v.split('.')
  if (!exp || !sig || Number(exp) * 1000 < Date.now()) return false
  return same(sig, crypto.createHmac('sha256', secret()).update(exp + ':' + login().email).digest('hex'))
}
