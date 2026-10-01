// Sign-in for the /pay payment demonstration (lib/payDemoAuth.ts).
//   GET    → { signedIn }
//   POST   { email, password } → { ok } and the pay_demo cookie, or 401
//   DELETE → signs out
import { NextRequest, NextResponse } from 'next/server'
import { checkPayDemoLogin, isPayDemoSignedIn, payDemoToken, PAY_DEMO_COOKIE, PAY_DEMO_MAX_AGE } from '@/lib/payDemoAuth'

export const dynamic = 'force-dynamic'

// a handful of attempts per minute per address
const hits = new Map<string, number[]>()
const limited = (ip: string) => {
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 60_000)
  recent.push(now); hits.set(ip, recent)
  return recent.length > 8
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ signedIn: isPayDemoSignedIn(req) })
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (limited(ip)) return NextResponse.json({ error: 'Too many attempts. Please wait a minute.' }, { status: 429 })
  let b: any = {}
  try { b = await req.json() } catch {}
  if (!checkPayDemoLogin(b?.email, b?.password)) return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(PAY_DEMO_COOKIE, payDemoToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: PAY_DEMO_MAX_AGE })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(PAY_DEMO_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
