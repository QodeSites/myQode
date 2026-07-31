// POST /api/mobile/admin/impersonate
// Issues a new JWT scoped to a specific client, letting the super-admin
// view the app exactly as that client would see it.
// RESTRICTED: only accessible to accounts with isSuperAdmin=true in the JWT
// (karan@qodeinvest.com and admin@qodeinvest.com).
//
// Body: { clientCode: string }
// Returns: { token, expiresIn, user }  — same shape as /api/mobile/auth/login
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth, requireSuperAdmin } from '@/lib/mobileAuth'
import type { MobileAuthUser } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import jwt from 'jsonwebtoken'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const adminError = requireSuperAdmin(user!)
  if (adminError) return adminError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { clientCode } = body
  if (!clientCode) {
    return NextResponse.json({ error: 'clientCode is required' }, { status: 400 })
  }

  try {
    // Look up the target client
    const clientResult = await query(
      `SELECT clientid, clientcode, email, groupid, head_of_family, ownerid,
              salutation, firstname, middlename, lastname, onboarding_status
       FROM pms_clients_master
       WHERE clientcode = $1
       LIMIT 1`,
      [clientCode]
    )

    if (clientResult.rows.length === 0) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const target = clientResult.rows[0]

    // Get all account codes this client can access (same logic as login)
    let accountsResult
    if (target.head_of_family) {
      accountsResult = await query(
        `SELECT clientid, clientcode, ownerid FROM pms_clients_master
         WHERE groupid = $1
           AND (maturity_date IS NULL OR maturity_date > NOW())`,
        [target.groupid]
      )
    } else {
      accountsResult = await query(
        `SELECT clientid, clientcode, ownerid FROM pms_clients_master
         WHERE ownerid = $1
           AND (maturity_date IS NULL OR maturity_date > NOW())`,
        [target.ownerid]
      )
    }

    const accounts = accountsResult.rows
    const individualCodes: string[] = accounts.map((r: any) => r.clientcode).filter(Boolean)

    // Include group-level and owner-level consolidated account codes so portfolio
    // APIs allow GROUP/OWNER aggregated views (rows in pms_master_sheet where
    // account_code = groupid / ownerid).
    // NOTE: not stripped of the ".0" suffix — the mobile app sends the raw
    // value as `accountId` and authorisation is a strict includes() check.
    // See the same note in /api/mobile/auth/login.
    const uniqueOwnerIds: string[] = [...new Set(
      accounts.map((r: any) => r.ownerid).filter(Boolean)
    )] as string[]
    const groupCode: string[] = target.head_of_family && target.groupid ? [target.groupid] : []

    const accountCodes: string[] = [...individualCodes, ...uniqueOwnerIds, ...groupCode]

    const clientName = [target.salutation, target.firstname, target.middlename, target.lastname]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

    const payload: MobileAuthUser = {
      userId: target.clientid,
      email: target.email,
      clientCode: target.clientcode,
      clientId: target.clientid,
      accountCodes,
      ownerIds: [target.ownerid || target.clientid],
      groupId: target.groupid,
      isHeadOfFamily: target.head_of_family,
      isImpersonated: true,
      impersonatedBy: user!.email,   // karan@qodeinvest.com
    }

    // Impersonation tokens are short-lived (4 hours)
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '4h' })

    return NextResponse.json({
      token,
      expiresIn: 60 * 60 * 4,
      user: {
        clientId: target.clientid,
        clientCode: target.clientcode,
        name: clientName,
        email: target.email,
        accountCodes,
        isHeadOfFamily: target.head_of_family,
        isImpersonated: true,
        impersonatedBy: user!.email,
        onboardingStatus: target.onboarding_status,
      },
    })
  } catch (err) {
    console.error('[mobile/admin/impersonate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
