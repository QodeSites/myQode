// POST /api/admin/bo/impersonate { email } — "Open as this user" (12 Oct 2026: one way only, the new dashboard).
//  → { token, expiresIn, user }: a 4 h session exactly like that user's own login, marked isImpersonated /
//    impersonatedBy (lib/mobileSession.ts), which the web app (/app) and the phone app open.
// Who may: super admins anyone; 'investors' admins investors; 'partners' admins partners and, to view only,
// investors too (12 Oct 2026: Krutika opens her partners' clients). The old web portal
// ('portal') is retired: everyone uses the new dashboard.
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { requireAdmin, audit, canAct, forbidden } from '@/lib/adminAuth'
import { normEmail, readJson, userTypeOf, scopeOfType } from '@/lib/adminUsers'
import { mobileSessionForEmail } from '@/lib/mobileSession'

const APP_TTL = 60 * 60 * 4

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super', ['investors', 'partners'])
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (body.target === 'portal') return NextResponse.json({ error: 'The old web portal is retired. Open the user in the new dashboard.', code: 'PORTAL_RETIRED' }, { status: 400 })

  try {
    const type = await userTypeOf(email)
    if (!type) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (!canAct(admin, scopeOfType(type)) && !(admin!.role === 'partners' && type === 'investor')) return forbidden()
    const { session, error: e, code, status } = await mobileSessionForEmail(email)
    if (!session) return NextResponse.json({ error: e, code }, { status: status || 400 })
    // Never carry admin rights into an impersonated session.
    const { isSuperAdmin: _drop, ...base } = session.payload
    const payload = { ...base, isImpersonated: true, impersonatedBy: admin!.email }
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: APP_TTL })
    await audit(req, admin!, 'user.impersonate', email, { target: 'app', type })
    return NextResponse.json({
      token,
      expiresIn: APP_TTL,
      user: { ...session.user, isSuperAdmin: false, isImpersonated: true, impersonatedBy: admin!.email },
    })
  } catch (e) {
    console.error('[admin/bo/impersonate]', e)
    return NextResponse.json({ error: 'Could not start impersonation' }, { status: 500 })
  }
}
