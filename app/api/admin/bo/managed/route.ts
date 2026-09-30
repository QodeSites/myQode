// Managed accounts (OneView's book: people QUS…, accounts QAC…) for the admin console. lib/managedAccounts.ts.
// GET  (super)  ?q=…            → { people: [{ icode, name, email, total, accounts: [{ qcode, strategy, value, asOf, closed }] }] }
// POST (super)  { icode }       → { token, expiresIn, user }: a read-only 4 h app session viewing that person's accounts
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { readJson } from '@/lib/adminUsers'
import { managedPeople, managedPerson, managedSessionPayload } from '@/lib/managedAccounts'

export const dynamic = 'force-dynamic'
const APP_TTL = 60 * 60 * 4

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'super')
  if (error) return error
  try {
    return NextResponse.json({ people: await managedPeople(req.nextUrl.searchParams.get('q') || '') })
  } catch (e) {
    console.error('[admin/bo/managed GET]', e)
    return NextResponse.json({ error: 'Could not load managed accounts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const icode = String(body.icode || '').trim().toUpperCase()
  if (!icode) return NextResponse.json({ error: 'icode is required' }, { status: 400 })
  try {
    const p = await managedPerson(icode)
    if (!p || !p.accounts.length) return NextResponse.json({ error: 'No managed accounts found for this person' }, { status: 404 })
    const payload = managedSessionPayload(p, admin!.email)
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: APP_TTL })
    await audit(req, admin!, 'managed.impersonate', icode, { accounts: payload.accountCodes })
    return NextResponse.json({
      token, expiresIn: APP_TTL,
      user: { clientId: p.icode, clientCode: payload.clientCode, name: p.name, email: p.email, accountCodes: payload.accountCodes,
        isHeadOfFamily: false, isSuperAdmin: false, isImpersonated: true, impersonatedBy: admin!.email, viewOnly: true, managed: true },
    })
  } catch (e) {
    console.error('[admin/bo/managed POST]', e)
    return NextResponse.json({ error: 'Could not start the view' }, { status: 500 })
  }
}
