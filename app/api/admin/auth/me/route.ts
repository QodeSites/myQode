// The signed-in backoffice admin (web cookie, app Bearer token or Microsoft session), or 401.
import { NextRequest, NextResponse } from 'next/server'
import { currentAdmin } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const admin = await currentAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401 })
  return NextResponse.json({ admin: { email: admin.email, name: admin.name, level: admin.level, via: admin.via } })
}
