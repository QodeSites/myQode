// GET /api/mobile/auth/me
// Returns fresh user profile for the authenticated user.
// Called by the mobile app on every startup (after restoring the stored JWT)
// to refresh name, accountCodes, and admin flags without requiring re-login.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  // Reviewer and admin virtual accounts — return JWT payload directly (not in DB)
  if (user!.isReviewer) {
    return NextResponse.json({
      clientId:      user!.clientId,
      clientCode:    user!.clientCode,
      name:          'Demo User',
      email:         user!.email,
      accountCodes:  user!.accountCodes,
      isHeadOfFamily: user!.isHeadOfFamily,
      isSuperAdmin:  false,
      isReviewer:    true,
    })
  }

  if (user!.isSuperAdmin && user!.clientId === 'admin') {
    return NextResponse.json({
      clientId:      'admin',
      clientCode:    'ADMIN',
      name:          'Admin',
      email:         user!.email,
      accountCodes:  [],
      isHeadOfFamily: false,
      isSuperAdmin:  true,
    })
  }

  try {
    // Fetch fresh profile from DB
    const result = await query(
      `SELECT clientid, clientcode, email, groupid, head_of_family, ownerid,
              salutation, firstname, middlename, lastname
       FROM pms_clients_master
       WHERE clientid = $1
       LIMIT 1`,
      [user!.clientId]
    )

    if (!result.rows.length) {
      // Client not found — return JWT payload as fallback so the app isn't broken
      return NextResponse.json({
        clientId:      user!.clientId,
        clientCode:    user!.clientCode,
        name:          '',
        email:         user!.email,
        accountCodes:  user!.accountCodes,
        isHeadOfFamily: user!.isHeadOfFamily,
      })
    }

    const row = result.rows[0]
    const clientName = [row.salutation, row.firstname, row.middlename, row.lastname]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

    const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? 'karan@qodeinvest.com').toLowerCase()
    const isSuperAdmin = row.email.toLowerCase() === SUPER_ADMIN_EMAIL

    // Return fresh accountCodes from the JWT (they were computed at login time from DB
    // and are embedded in the token — re-computing here would require the same multi-join
    // query as login, which is expensive and out of scope for a /me refresh).
    // If accountCodes need to change (e.g. new account added), the user must re-login.
    return NextResponse.json({
      clientId:      row.clientid,
      clientCode:    row.clientcode,
      name:          clientName,
      email:         row.email,
      accountCodes:  user!.accountCodes,   // from JWT — authoritative until re-login
      isHeadOfFamily: row.head_of_family ?? false,
      isSuperAdmin,
    })
  } catch (err) {
    console.error('[mobile/auth/me]', err)
    // Fall back to JWT payload so the app keeps working on DB errors
    return NextResponse.json({
      clientId:      user!.clientId,
      clientCode:    user!.clientCode,
      name:          '',
      email:         user!.email,
      accountCodes:  user!.accountCodes,
      isHeadOfFamily: user!.isHeadOfFamily,
      isSuperAdmin:  user!.isSuperAdmin ?? false,
    })
  }
}
