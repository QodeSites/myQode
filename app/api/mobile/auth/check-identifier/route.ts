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

    // Admin virtual account — always exists
    if (identifier.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({ exists: true })
    }

    const id = identifier.trim()
    const result = await query(
      `SELECT 1 FROM pms_clients_master
       WHERE email = $1 OR clientcode ILIKE $2
       LIMIT 1`,
      [id, id]
    )

    return NextResponse.json({ exists: result.rows.length > 0 })
  } catch (err) {
    console.error('[mobile/auth/check-identifier]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
