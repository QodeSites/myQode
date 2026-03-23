// POST /api/mobile/auth/login
// Issues a JWT for mobile app clients (React Native / Expo).
// Uses the same credential validation as the existing web login but returns
// a Bearer token instead of setting HTTP-only cookies, so the mobile app can
// store it in SecureStore and send it with each request.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { MobileAuthUser } from '@/lib/mobileAuth'
import { REVIEWER_ACCOUNT_CODES } from '@/lib/reviewerMock'

const REVIEWER_EMAIL    = 'reviewer@qodeinvest.com'
const REVIEWER_PASSWORD = 'Review@123'

export async function POST(request: NextRequest) {
  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body. Set Content-Type: application/json.' },
        { status: 400 }
      )
    }

    // Accept both `username` and `email` as the login identifier
    const username: string | undefined = body?.username ?? body?.email
    const password: string | undefined = body?.password

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Fields required: username (or email) and password', received: Object.keys(body ?? {}) },
        { status: 400 }
      )
    }

    // ── Reviewer bypass (Play Store / App Store review) ───────────────────────
    if (username.toLowerCase() === REVIEWER_EMAIL && password === REVIEWER_PASSWORD) {
      const payload: MobileAuthUser = {
        userId: 'reviewer',
        email: REVIEWER_EMAIL,
        clientCode: 'DEMO001',
        clientId: 'reviewer',
        accountCodes: REVIEWER_ACCOUNT_CODES,
        ownerIds: ['DEMO_OWNER'],
        groupId: null as any,
        isHeadOfFamily: false,
        isReviewer: true,
      }
      const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '30d' })
      return NextResponse.json({
        token,
        expiresIn: 60 * 60 * 24 * 30,
        user: {
          clientId: 'reviewer',
          clientCode: 'DEMO001',
          name: 'Demo User',
          email: REVIEWER_EMAIL,
          accountCodes: REVIEWER_ACCOUNT_CODES,
          isHeadOfFamily: false,
          isSuperAdmin: false,
        },
      })
    }

    // Look up user
    const userResult = await query(
      `SELECT clientid, clientcode, email, groupid, password, head_of_family, ownerid,
              salutation, firstname, middlename, lastname
       FROM pms_clients_master
       WHERE (email = $1 OR clientcode = $1)
       LIMIT 1`,
      [username]
    )

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const user = userResult.rows[0]

    // Reject default/unset password
    if (!user.password || user.password === 'Qode@123') {
      return NextResponse.json(
        { error: 'Password setup required', code: 'PASSWORD_SETUP_REQUIRED' },
        { status: 403 }
      )
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Fetch all account codes for this owner
    let accountsResult;
    if (user.head_of_family) {
      accountsResult = await query(
        'SELECT clientid, clientcode, ownerid FROM pms_clients_master WHERE groupid = $1',
        [user.groupid]
      )
    } else {
      accountsResult = await query(
        'SELECT clientid, clientcode, ownerid FROM pms_clients_master WHERE email = $1',
        [user.email]
      )
    }

    const accounts = accountsResult.rows
    const individualCodes: string[] = accounts.map((a: any) => a.clientcode).filter(Boolean)

    // Include group-level and owner-level consolidated account codes so the
    // portfolio APIs (which check accountCodes) allow GROUP/OWNER aggregated views.
    // These match rows in pms_master_sheet where account_code = groupid / ownerid.
    const uniqueOwnerIds: string[] = [...new Set(
      accounts.map((a: any) => a.ownerid).filter(Boolean)
    )] as string[]
    const groupCode: string[] = user.head_of_family && user.groupid ? [user.groupid] : []

    const accountCodes: string[] = [...individualCodes, ...uniqueOwnerIds, ...groupCode]

    // Track login
    await query(
      `UPDATE pms_clients_master
       SET last_login_at = NOW(), login_count = COALESCE(login_count, 0) + 1
       WHERE clientcode = $1`,
      [user.clientcode]
    )

    const clientName = [user.salutation, user.firstname, user.middlename, user.lastname]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    const SUPER_ADMIN_EMAIL = 'karan@qodeinvest.com'
    const isSuperAdmin = user.email.toLowerCase() === SUPER_ADMIN_EMAIL

    const payload: MobileAuthUser = {
      userId: user.clientid,
      email: user.email,
      clientCode: user.clientcode,
      clientId: user.clientid,
      accountCodes,
      ownerIds: [user.ownerid || user.clientid],
      groupId: user.groupid,
      isHeadOfFamily: user.head_of_family,
      ...(isSuperAdmin && { isSuperAdmin: true }),
    }

    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '30d' })

    return NextResponse.json({
      token,
      expiresIn: 60 * 60 * 24 * 30, // seconds
      user: {
        clientId: user.clientid,
        clientCode: user.clientcode,
        name: clientName,
        email: user.email,
        accountCodes,
        isHeadOfFamily: user.head_of_family,
        isSuperAdmin,
      },
    })
  } catch (error) {
    console.error('[mobile/auth/login] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
