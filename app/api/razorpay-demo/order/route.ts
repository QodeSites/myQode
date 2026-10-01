// POST /api/razorpay-demo/order { amount, strategy, name?, email? } → { orderId, amount, currency, keyId, environment }
// The public payment demonstration at /pay (for the payment gateway's website review): creates a real Razorpay order
// tagged demo=true so the reviewer can see the exact checkout clients use in the myQode app. Nothing is recorded in
// myQode (no payment_transactions row, no client account, no email). Real client top-ups only happen signed in, in the app.
// Needs the /pay demo sign-in (lib/payDemoAuth.ts).
import { NextRequest, NextResponse } from 'next/server'
import { razorpayConfig, createRazorpayOrder } from '@/lib/razorpay'
import { isPayDemoSignedIn } from '@/lib/payDemoAuth'

export const dynamic = 'force-dynamic'

const STRATEGIES = ['Qode All Weather', 'Qode Growth Fund', 'Qode Tactical Fund']
const MIN = 1, MAX = 100000

// A few orders per minute per address is plenty for a demonstration.
const hits = new Map<string, number[]>()
const limited = (ip: string) => {
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 60_000)
  recent.push(now); hits.set(ip, recent)
  return recent.length > 5
}

export async function POST(req: NextRequest) {
  if (!isPayDemoSignedIn(req)) return NextResponse.json({ error: 'Please sign in to the demonstration first.' }, { status: 401 })
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (limited(ip)) return NextResponse.json({ error: 'Too many attempts. Please wait a minute.' }, { status: 429 })
  let b: any = {}
  try { b = await req.json() } catch {}
  const amount = Math.round(Number(b?.amount) * 100) / 100
  const strategy = STRATEGIES.includes(b?.strategy) ? b.strategy : STRATEGIES[0]
  if (!(amount >= MIN && amount <= MAX)) return NextResponse.json({ error: `Enter an amount between ₹${MIN} and ₹${MAX.toLocaleString('en-IN')}` }, { status: 400 })
  try {
    const cfg = razorpayConfig()
    const receipt = `qode_web_demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const order: any = await createRazorpayOrder(amount, receipt, {
      source: 'myqode_web_demo', demo: 'true', strategy,
      payer_name: String(b?.name || '').slice(0, 60), payer_email: String(b?.email || '').slice(0, 80),
    })
    return NextResponse.json({ orderId: order.id, amount, currency: 'INR', keyId: cfg.keyId, environment: cfg.isTest ? 'test' : 'live' })
  } catch (e) {
    console.error('[razorpay-demo/order]', (e as Error).message)
    return NextResponse.json({ error: 'Payments are not available right now. Please try again later.' }, { status: 503 })
  }
}
