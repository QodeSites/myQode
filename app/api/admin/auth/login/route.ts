// Backoffice sign-in (web). POST { email, password } → sets the httpOnly `qode-admin` cookie.
// The app signs in through /api/mobile/auth/login, which issues an admin JWT for the same accounts.
import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPassword, signAdminToken, ADMIN_COOKIE, adminCookieOptions, audit } from '@/lib/adminAuth'

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { admin, error } = await checkAdminPassword(body.email, body.password)
  if (!admin) return NextResponse.json({ error }, { status: 401 })
  await audit(req, admin, 'admin.login', null, { via: 'web' })
  const res = NextResponse.json({ admin: { email: admin.email, name: admin.name, level: admin.level } })
  res.cookies.set(ADMIN_COOKIE, signAdminToken(admin), adminCookieOptions)
  return res
}
