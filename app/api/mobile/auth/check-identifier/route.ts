// POST /api/mobile/auth/check-identifier
// Lightweight pre-login check — confirms whether an email or account code
// exists before the password modal opens. Returns no sensitive data.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

// Admin virtual account — always "exists" for the purpose of this check
const ADMIN_EMAIL = 'admin@qodeinvest.com'

export async function POST(request: NextRequest) {
  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const identifier: string | undefined = body?.identifier ?? body?.email
    if (!identifier?.trim()) {
      return NextResponse.json({ error: 'identifier is required' }, { status: 400 })
    }

    // Virtual accounts — always exist (not in DB), never require setup
    const VIRTUAL_ACCOUNTS = ['admin@qodeinvest.com', 'reviewer@qodeinvest.com']
    if (VIRTUAL_ACCOUNTS.includes(identifier.trim().toLowerCase())) {
      return NextResponse.json({ exists: true, requiresSetup: false })
    }

    const id = identifier.trim()
    const result = await query(
      `SELECT email, password FROM pms_clients_master
       WHERE email = $1 OR clientcode ILIKE $2
       LIMIT 1`,
      [id, id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ exists: false, requiresSetup: false })
    }

    const row = result.rows[0]
    // A user still needs to set a password only if they're on the default password.
    const requiresSetup = row.password === 'Qode@123'

    return NextResponse.json({
      exists: true,
      requiresSetup,
      // Return the registered email so the setup flow can pre-fill it even when
      // the user signed in with an account code.
      email: requiresSetup ? row.email : undefined,
    })
  } catch (err) {
    console.error('[mobile/auth/check-identifier]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
