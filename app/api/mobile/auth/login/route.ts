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
import { resolveDistributorByEmail } from '@/lib/distributorIdentity'
import { findLoginRow, distributorMobileSession, investorActiveAccounts, allAccountsClosed, investorAccountCodes, investorMobileSession } from '@/lib/mobileSession'
import { isAppAdmin, checkAdminPassword, audit } from '@/lib/adminAuth'
import { logAuthEvent } from '@/lib/authEvents'

// Reviewer account — used by App Store / Play Store reviewers.
// Shows hardcoded dummy data so no real client data is exposed during review.
const REVIEWER_EMAIL    = 'reviewer@qodeinvest.com'
const REVIEWER_PASSWORD = 'Review@123'

// Admin account — a virtual account not in pms_clients_master.
// Password comes from MOBILE_ADMIN_PASSWORD; when it is unset the admin login is disabled.
const ADMIN_EMAIL    = 'admin@qodeinvest.com'
const ADMIN_PASSWORD = process.env.MOBILE_ADMIN_PASSWORD || ''

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
    // Optional, from the app's Client / Distributor switch. The role is still decided by the row (an investor
    // row is an investor whatever was picked); the switch only turns a wrong pick into a clear message.
    const wantRole: 'client' | 'distributor' | null = body?.role === 'distributor' ? 'distributor' : body?.role === 'client' ? 'client' : null
    const username: string | undefined = typeof rawUsername === 'string' ? rawUsername.trim() : rawUsername
    const password: string | undefined = body?.password

    // Client-reported OS (Platform.OS from the RN app) — 'ios' | 'android' only.
    // Anything else (missing, web, simulator quirks) is treated as unknown and
    // simply doesn't get counted toward either OS bucket.
    const rawPlatform = typeof body?.platform === 'string' ? body.platform.toLowerCase() : undefined
    const clientOS: 'ios' | 'android' | null =
      rawPlatform === 'ios' || rawPlatform === 'android' ? rawPlatform : null
    // Analytics (auth_events): every outcome of this request, never the password.
    const logApp = (event: 'login_success' | 'login_failed', email: string | null | undefined, reason?: string, platform: 'app' | 'admin' = 'app', meta?: Record<string, unknown>) =>
      void logAuthEvent(request, { email: email ?? null, event, reason: reason ?? null, platform, os: clientOS, meta })

    // Dev bypass: password is optional in development so Expo Go / simulator
    // testing can log in to any real account without knowing its password.
    // Development skips password checks (passwordless dev picker). MOBILE_LOGIN_ENFORCE_PASSWORD=1 turns the real
    // checks back on while still on the dev server, so first-time password setup and wrong-password handling
    // can be tested as a client would see them.
    const isDevelopment = process.env.NODE_ENV === 'development' && process.env.MOBILE_LOGIN_ENFORCE_PASSWORD !== '1'

    // ── Reviewer bypass (Play Store / App Store review) ───────────────────────
    // Checked FIRST — before the dev-mode password bypass — so reviewer credentials
    // always require the correct password regardless of NODE_ENV.
    if (username?.toLowerCase() === REVIEWER_EMAIL && password === REVIEWER_PASSWORD) {
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
      logApp('login_success', REVIEWER_EMAIL, undefined, 'app', { role: 'reviewer' })
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

    // ── App admin (APP_ADMIN_EMAILS ⊂ BACKOFFICE_ADMINS, password in admin_users) ──
    // Signs the app in to admin mode: a super-admin token that can impersonate anyone and use /api/admin/*.
    // Checked first, so an admin email never falls through to the client lookup.
    if (isAppAdmin(username)) {
      const { admin, error } = await checkAdminPassword(username, password || '')
      if (!admin) {
        logApp('login_failed', username, /too many/i.test(String(error)) ? 'locked' : 'wrong_password', 'admin', { via: 'app' })
        return NextResponse.json({ error }, { status: 401 })
      }
      await audit(request, admin, 'admin.login', null, { via: 'app' })
      logApp('login_success', admin.email, undefined, 'admin', { via: 'app' })
      const payload: MobileAuthUser & { isAdmin: boolean; name: string } = {
        userId: 'admin:' + admin.email, email: admin.email, clientCode: 'ADMIN', clientId: 'admin',
        accountCodes: [], ownerIds: [], groupId: null as any, isHeadOfFamily: false, isSuperAdmin: true, isAdmin: true, name: admin.name,
      }
      const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '12h' })
      return NextResponse.json({
        token, expiresIn: 60 * 60 * 12,
        user: { clientId: 'admin', clientCode: 'ADMIN', name: admin.name, email: admin.email, accountCodes: [], isHeadOfFamily: false, isSuperAdmin: true, isAdmin: true },
      })
    }

    // ── Admin bypass ─────────────────────────────────────────────────────────────
    // Virtual admin account — not in pms_clients_master.
    // Checked BEFORE the dev-mode password bypass so that dev mode sending
    // password='' cannot accidentally match (password is always required here).
    if (username.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
        logApp('login_failed', ADMIN_EMAIL, 'wrong_password', 'admin', { via: 'app' })
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
      logApp('login_success', ADMIN_EMAIL, undefined, 'admin', { via: 'app' })
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
    const loginRow = await findLoginRow(username)
    const userResult = { rows: loginRow ? [loginRow] : [] }

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
      // The identifier matched nobody: store it only if it looks like an email (not a typo'd password).
      logApp('login_failed', /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username) ? username : null, 'unknown_user')
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
        // Same as the web: the default password is the only one that moves on to first-time setup.
        if (password !== 'Qode@123') {
          logApp('login_failed', user.email, 'wrong_password')
          return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
        }
        console.log('[login] blocked — PASSWORD_SETUP_REQUIRED for', user.clientcode)
        logApp('login_failed', user.email, 'no_password_set')
        return NextResponse.json(
          { error: 'Password setup required', code: 'PASSWORD_SETUP_REQUIRED' },
          { status: 403 }
        )
      }

      const isValid = await bcrypt.compare(password!, user.password)
      if (!isValid) {
        console.log('[login] blocked — invalid password for', user.clientcode)
        logApp('login_failed', user.email, 'wrong_password')
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
    }

    // ── Distributor (partner) login ───────────────────────────────────────────
    // Same rule as the web (lib/distributorIdentity.ts): a row with no clientcode whose email resolves as a
    // distributor. Investor rows sort first in the lookup above, so a person who is both an investor and a
    // partner signs in as the investor — as on the web. A distributor gets no accountCodes; their book is
    // read through /api/mobile/distributor/*, which re-check the role on every call.
    if (!user.clientcode) {
      const distributor = await resolveDistributorByEmail(user.email)
      if (distributor) {
        if (wantRole === 'client') {
          logApp('login_failed', user.email, 'role_mismatch', 'app', { role: 'distributor' })
          return NextResponse.json({ error: 'This email is a partner login. Switch to Partner to sign in.', code: 'ROLE_MISMATCH', role: 'distributor' }, { status: 403 })
        }
        await query(
          `UPDATE pms_clients_master
           SET last_login_at = NOW(), login_count = COALESCE(login_count, 0) + 1,
               last_app_login_at = NOW(), app_login_count = COALESCE(app_login_count, 0) + 1,
               first_app_login_at = COALESCE(first_app_login_at, NOW())
           WHERE lower(email) = $1 AND clientcode IS NULL`,
          [distributor.email]
        ).catch((e: any) => console.warn('[login] distributor login tracking failed', e?.message))
        await query(
          `INSERT INTO login_events (email, platform, os) VALUES ($1, 'app', $2)`,
          [user.email, clientOS]
        ).catch(() => {})

        const { payload, user: distributorUser } = distributorMobileSession(user.email, distributor)
        const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '30d' })
        console.log('[login] distributor →', distributor.clientname)
        logApp('login_success', user.email, undefined, 'app', { role: 'distributor' })
        return NextResponse.json({
          token,
          expiresIn: 60 * 60 * 24 * 30,
          user: distributorUser,
        })
      }
    }

    if (wantRole === 'distributor') {
      logApp('login_failed', user.email, 'role_mismatch', 'app', { role: 'investor' })
      return NextResponse.json({ error: 'This email is an investor login, not a partner login. Switch to Investor to sign in.', code: 'ROLE_MISMATCH', role: 'client' }, { status: 403 })
    }

    // Fetch all account codes for this owner — exclude matured/closed accounts
    // maturity_date IS NULL means open-ended (no fixed term), otherwise only include future-dated ones
    const accounts = await investorActiveAccounts(user)

    // ── All-accounts-closed guard ─────────────────────────────────────────────
    // If the active-account query came back empty, check whether ALL accounts
    // for this email actually exist but have a maturity_date in the past.
    // If so, the client's portfolio has been fully closed — return a clear error
    // instead of silently issuing a JWT with no accountCodes.
    if (accounts.length === 0) {
      if (await allAccountsClosed(user.email)) {
        logApp('login_failed', user.email, 'account_closed')
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

    const accountCodes = investorAccountCodes(user, accounts)

    // Track login. OS-specific columns/timestamps only update when the client
    // actually reported a recognized platform — an unrecognized value still
    // counts toward the combined app_login_count, just not toward iOS/Android.
    await query(
      clientOS === 'ios'
        ? `UPDATE pms_clients_master
           SET last_login_at = NOW(), login_count = COALESCE(login_count, 0) + 1,
               last_app_login_at = NOW(), app_login_count = COALESCE(app_login_count, 0) + 1,
               first_app_login_at = COALESCE(first_app_login_at, NOW()),
               last_ios_login_at = NOW(), ios_login_count = COALESCE(ios_login_count, 0) + 1
           WHERE email = $1`
        : clientOS === 'android'
        ? `UPDATE pms_clients_master
           SET last_login_at = NOW(), login_count = COALESCE(login_count, 0) + 1,
               last_app_login_at = NOW(), app_login_count = COALESCE(app_login_count, 0) + 1,
               first_app_login_at = COALESCE(first_app_login_at, NOW()),
               last_android_login_at = NOW(), android_login_count = COALESCE(android_login_count, 0) + 1
           WHERE email = $1`
        : `UPDATE pms_clients_master
           SET last_login_at = NOW(), login_count = COALESCE(login_count, 0) + 1,
               last_app_login_at = NOW(), app_login_count = COALESCE(app_login_count, 0) + 1,
               first_app_login_at = COALESCE(first_app_login_at, NOW())
           WHERE email = $1`,
      [user.email]
    )
    await query(
      `INSERT INTO login_events (email, platform, os) VALUES ($1, 'app', $2)`,
      [user.email, clientOS]
    )

    const { payload, user: investorUser } = investorMobileSession(user, accountCodes)
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '30d' })
    logApp('login_success', user.email, undefined, 'app', { role: 'investor', dev: isDevelopment || undefined })

    return NextResponse.json({
      token,
      expiresIn: 60 * 60 * 24 * 30, // seconds
      user: investorUser,
    })
  } catch (error) {
    console.error('[mobile/auth/login] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
