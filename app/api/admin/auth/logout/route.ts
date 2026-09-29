import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE, currentAdmin } from '@/lib/adminAuth'
import { logAuthEvent } from '@/lib/authEvents'

export async function POST(req: NextRequest) {
  const admin = await currentAdmin(req).catch(() => null)
  if (admin) void logAuthEvent(req, { email: admin.email, event: 'logout', platform: 'admin', meta: { via: 'web' } })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
