// POST /api/admin/bo/impersonate { email, target: 'portal' | 'app' } (super)
//  - portal → { redirectUrl }: a signed one-time link (lib/impersonation.ts) that opens the web portal as the user.
//  - app    → { token, expiresIn, user }: a 4 h mobile JWT exactly like that user's own login, marked
//             isImpersonated / impersonatedBy (lib/mobileSession.ts).
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { normEmail, readJson } from '@/lib/adminUsers'
import { findLoginRow, mobileSessionForEmail } from '@/lib/mobileSession'
import { investorPortalImpersonation, distributorPortalImpersonation } from '@/lib/impersonation'
import { query } from '@/lib/db'

const APP_TTL = 60 * 60 * 4

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  const target = body.target === 'app' ? 'app' : body.target === 'portal' ? 'portal' : null
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (!target) return NextResponse.json({ error: "target must be 'portal' or 'app'" }, { status: 400 })

  try {
    if (target === 'app') {
      const { session, error: e, code, status } = await mobileSessionForEmail(email)
      if (!session) return NextResponse.json({ error: e, code }, { status: status || 400 })
      // Never carry admin rights into an impersonated session.
      const { isSuperAdmin: _drop, ...base } = session.payload
      const payload = { ...base, isImpersonated: true, impersonatedBy: admin!.email }
      const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: APP_TTL })
      await audit(req, admin!, 'user.impersonate', email, { target })
      return NextResponse.json({
        token,
        expiresIn: APP_TTL,
        user: { ...session.user, isSuperAdmin: false, isImpersonated: true, impersonatedBy: admin!.email },
      })
    }

    // portal: sign in as the row the user's own login would pick (an investor row wins over a distributor row).
    const stored = (await query(
      `SELECT email FROM pms_clients_master WHERE lower(trim(email)) = $1
        ORDER BY head_of_family DESC NULLS LAST, clientcode ASC NULLS LAST LIMIT 1`, [email],
    )).rows[0]?.email
    const row = stored ? await findLoginRow(stored) : null
    if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const imp = row.clientcode
      ? await investorPortalImpersonation(row.clientcode, admin!.email)
      : await distributorPortalImpersonation(row.email, admin!.email)
    if (!imp) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    await audit(req, admin!, 'user.impersonate', email, { target, clientCode: row.clientcode || null })
    return NextResponse.json({ redirectUrl: imp.redirectUrl })
  } catch (e) {
    console.error('[admin/bo/impersonate]', e)
    return NextResponse.json({ error: 'Could not start impersonation' }, { status: 500 })
  }
}
