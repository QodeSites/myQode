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

// Reviewer account — used by App Store / Play Store reviewers.
// Shows hardcoded dummy data so no real client data is exposed during review.
const REVIEWER_EMAIL    = 'reviewer@qodeinvest.com'
const REVIEWER_PASSWORD = 'Review@123'

// Admin account — a virtual account not in pms_clients_master.
// Hardcoded credentials for the dedicated impersonation account.
const ADMIN_EMAIL    = 'admin@qodeinvest.com'
const ADMIN_PASSWORD = 'AdminQode#@2026'

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
    // Strip any extra whitespace a user may have typed or copy-pasted around the email
    const rawUsername: string | undefined = body?.username ?? body?.email
    const username: string | undefined = typeof rawUsername === 'string' ? rawUsername.trim() : rawUsername
    const password: string | undefined = body?.password

    // Dev bypass: password is optional in development so Expo Go / simulator
    // testing can log in to any real account without knowing its password.
    const isDevelopment = process.env.NODE_ENV === 'development'

    // ── Reviewer bypass (Play Store / App Store review) ───────────────────────
    // Checked FIRST — before the dev-mode password bypass — so reviewer credentials
    // always require the correct password regardless of NODE_ENV.
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

    if (!username || (!password && !isDevelopment)) {
      return NextResponse.json(
        { error: 'Fields required: username (or email) and password', received: Object.keys(body ?? {}) },
        { status: 400 }
      )
    }

    // ── Admin bypass ─────────────────────────────────────────────────────────────
    // Virtual admin account — not in pms_clients_master.
    // Checked BEFORE the dev-mode password bypass so that dev mode sending
    // password='' cannot accidentally match (password is always required here).
    if (username.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
      const payload: MobileAuthUser = {
        userId: 'admin',
        email: ADMIN_EMAIL,
        clientCode: 'ADMIN',
        clientId: 'admin',
        accountCodes: [],
        ownerIds: [],
        groupId: null as any,
        isHeadOfFamily: false,
        isSuperAdmin: true,
      }
      const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '12h' })
      return NextResponse.json({
        token,
        expiresIn: 60 * 60 * 12,
        user: {
          clientId: 'admin',
          clientCode: 'ADMIN',
          name: 'Admin',
          email: ADMIN_EMAIL,
          accountCodes: [],
          isHeadOfFamily: false,
          isSuperAdmin: true,
        },
      })
    }

    // Look up user — prefer head_of_family=true row when multiple rows share the same email
    // (one person can have accounts across multiple schemes, only one row has head_of_family=true)
    const userResult = await query(
      `SELECT clientid, clientcode, email, groupid, password, head_of_family, ownerid,
              salutation, firstname, middlename, lastname
       FROM pms_clients_master
       WHERE (email = $1 OR UPPER(clientcode) = UPPER($1))
       ORDER BY head_of_family DESC NULLS LAST, clientcode ASC
       LIMIT 1`,
      [username]
    )

    console.log('[login] user lookup →', {
      identifier: username,
      found: userResult.rows.length > 0,
      row: userResult.rows[0]
        ? {
            clientcode:     userResult.rows[0].clientcode,
            email:          userResult.rows[0].email,
            groupid:        userResult.rows[0].groupid,
            head_of_family: userResult.rows[0].head_of_family,
            ownerid:        userResult.rows[0].ownerid,
            hasPassword:    !!userResult.rows[0].password,
          }
        : null,
    })

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'No account found for this email or ID. Please check and try again.', code: 'USER_NOT_FOUND' },
        { status: 401 }
      )
    }

    const user = userResult.rows[0]

    // Skip all password checks in development — allows passwordless login in Expo Go / simulator.
    if (!isDevelopment) {
      // Reject default/unset password
      if (!user.password || user.password === 'Qode@123') {
        console.log('[login] blocked — PASSWORD_SETUP_REQUIRED for', user.clientcode)
        return NextResponse.json(
          { error: 'Password setup required', code: 'PASSWORD_SETUP_REQUIRED' },
          { status: 403 }
        )
      }

      const isValid = await bcrypt.compare(password!, user.password)
      if (!isValid) {
        console.log('[login] blocked — invalid password for', user.clientcode)
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
    }

    // Fetch all account codes for this owner — exclude matured/closed accounts
    // maturity_date IS NULL means open-ended (no fixed term), otherwise only include future-dated ones
    let accountsResult;
    let accountsFetchMethod: string;

    if (user.head_of_family) {
      accountsResult = await query(
        `SELECT clientid, clientcode, ownerid, maturity_date FROM pms_clients_master
         WHERE groupid = $1
           AND (maturity_date IS NULL OR maturity_date > NOW())`,
        [user.groupid]
      )
      accountsFetchMethod = `groupid=${user.groupid} (head of family)`

      // Edge case: entire group may be matured (e.g. client moved to a new group).
      // Fall back to email lookup so active accounts in other groups are still visible.
      if (accountsResult.rows.length === 0) {
        console.log('[login] group has 0 active accounts — falling back to email lookup', {
          groupid: user.groupid,
          email:   user.email,
        })
        accountsResult = await query(
          `SELECT clientid, clientcode, ownerid, maturity_date FROM pms_clients_master
           WHERE email = $1
             AND (maturity_date IS NULL OR maturity_date > NOW())`,
          [user.email]
        )
        accountsFetchMethod = `email=${user.email} (fallback — group fully matured)`
      }
    } else {
      accountsResult = await query(
        `SELECT clientid, clientcode, ownerid, maturity_date FROM pms_clients_master
         WHERE email = $1
           AND (maturity_date IS NULL OR maturity_date > NOW())`,
        [user.email]
      )
      accountsFetchMethod = `email=${user.email}`
    }

    console.log('[login] accounts fetched →', {
      method:   accountsFetchMethod,
      count:    accountsResult.rows.length,
      accounts: accountsResult.rows.map((a: any) => ({
        clientcode:    a.clientcode,
        ownerid:       a.ownerid,
        maturity_date: a.maturity_date ?? 'NULL (open-ended)',
      })),
    })

    const accounts = accountsResult.rows

    // ── All-accounts-closed guard ─────────────────────────────────────────────
    // If the active-account query came back empty, check whether ALL accounts
    // for this email actually exist but have a maturity_date in the past.
    // If so, the client's portfolio has been fully closed — return a clear error
    // instead of silently issuing a JWT with no accountCodes.
    if (accounts.length === 0) {
      const allAccountsResult = await query(
        `SELECT clientcode, maturity_date
         FROM pms_clients_master
         WHERE email = $1`,
        [user.email]
      )

      const allRows = allAccountsResult.rows
      const hasAnyRow = allRows.length > 0
      const allMatured = hasAnyRow && allRows.every(
        (r: any) => r.maturity_date && new Date(r.maturity_date) <= new Date()
      )

      console.log('[login] no active accounts →', {
        email:       user.email,
        totalRows:   allRows.length,
        allMatured,
        maturityDates: allRows.map((r: any) => ({
          clientcode:    r.clientcode,
          maturity_date: r.maturity_date ?? 'NULL',
        })),
      })

      if (allMatured) {
        return NextResponse.json(
          {
            error: 'Your account has been closed. If you think this is an error, please contact our IR team.',
            code: 'ACCOUNT_CLOSED',
          },
          { status: 403 }
        )
      }
      // If not all matured (e.g. maturity_date not yet populated), fall through
      // and issue the JWT — the portfolio screens will simply show no data.
    }

    const individualCodes: string[] = accounts.map((a: any) => a.clientcode).filter(Boolean)

    // Include group-level and owner-level consolidated account codes so the
    // portfolio APIs (which check accountCodes) allow GROUP/OWNER aggregated views.
    // These match rows in pms_master_sheet where account_code = groupid / ownerid.
    const uniqueOwnerIds: string[] = [...new Set(
      accounts.map((a: any) => a.ownerid).filter(Boolean)
    )] as string[]
    const groupCode: string[] = user.head_of_family && user.groupid ? [user.groupid] : []

    const accountCodes: string[] = [...individualCodes, ...uniqueOwnerIds, ...groupCode]

    console.log('[login] JWT accountCodes →', {
      individualCodes,
      uniqueOwnerIds,
      groupCode,
      total: accountCodes,
    })

    // Track login
    await query(
      `UPDATE pms_clients_master
       SET last_login_at = NOW(), login_count = COALESCE(login_count, 0) + 1,
           last_app_login_at = NOW(), app_login_count = COALESCE(app_login_count, 0) + 1,
           first_app_login_at = COALESCE(first_app_login_at, NOW())
       WHERE email = $1`,
      [user.email]
    )
    await query(`INSERT INTO login_events (email, platform) VALUES ($1, 'app')`, [user.email])

    const clientName = [user.salutation, user.firstname, user.middlename, user.lastname]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Super admin email comes from environment so it can be changed without a code deploy.
    // Set SUPER_ADMIN_EMAIL in .env.local / production environment.
    const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? 'karan@qodeinvest.com').toLowerCase()
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
