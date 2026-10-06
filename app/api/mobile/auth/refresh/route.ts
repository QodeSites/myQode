// POST /api/mobile/auth/refresh
// Re-issues a 30-day token for a still-valid one, so a client who keeps using the app never has to sign in
// again (the app calls this on start-up once the token is more than a day old). Admin, impersonation and
// reviewer tokens are not extended. A distributor's role is re-checked; an investor's account codes are the
// ones already in the token (as /auth/me: they change only on a fresh sign-in).
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { verifyMobileAuth, type MobileAuthUser } from '@/lib/mobileAuth'
import { resolveDistributorByEmail } from '@/lib/distributorIdentity'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isImpersonated || user!.isReviewer || (user!.isSuperAdmin && user!.clientId === 'admin')) {
    return NextResponse.json({ error: 'This session cannot be extended' }, { status: 403 })
  }
  try {
    if (user!.isDistributor) {
      const d = await resolveDistributorByEmail(user!.email)
      if (!d) return NextResponse.json({ error: 'This partner login is no longer active.', code: 'NOT_DISTRIBUTOR' }, { status: 401 })
    } else {
      const { rows } = await query(`SELECT 1 FROM pms_clients_master WHERE clientid = $1 LIMIT 1`, [user!.clientId])
      if (!rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 401 })
    }
    const { iat, exp, ...payload } = user as MobileAuthUser & { iat?: number; exp?: number }
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '30d' })
    return NextResponse.json({ token, expiresIn: 60 * 60 * 24 * 30 })
  } catch (err) {
    console.error('[mobile/auth/refresh]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
