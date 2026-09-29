// POST /api/mobile/auth/change-password — a signed-in user (investor or partner) sets a new password from inside
// the app. Body: { currentPassword, newPassword }.
//   - the current password is checked (bcrypt), except on a dev server where the login itself skips passwords
//     (NODE_ENV=development without MOBILE_LOGIN_ENFORCE_PASSWORD=1) — the same rule as /auth/login
//   - the new password follows the web's reset rules (/api/auth/reset): 8+ chars, upper, lower, digit, symbol,
//     not the default, and (app rule) no spaces
//   - a partner updates their own row (clientcode IS NULL); an investor updates every row on their email, as
//     the web's reset does, so the family login keeps one password
//   - a read-only "View account" session is rejected by lib/mobileAuth before this runs (non-GET)
// The user gets an acknowledgement email so an unexpected change is noticed.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { sendClientAck, clientName } from '@/lib/mobileAckMail'
import { logAuthEvent, osFrom } from '@/lib/authEvents'

const DEV_NO_PASSWORD = process.env.NODE_ENV === 'development' && process.env.MOBILE_LOGIN_ENFORCE_PASSWORD !== '1'

function passwordProblem(p: string): string | null {
  if (!p || p.length < 8) return 'Password must be at least 8 characters long'
  if (/\s/.test(p)) return 'Password cannot contain spaces'
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) return 'Password must contain uppercase, lowercase, numbers, and special characters'
  if (p === 'Qode@123') return 'Please choose a different password than the default one'
  return null
}

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if ((user as any).isReviewer || (user as any).isSuperAdmin) return NextResponse.json({ error: 'Not available for this account' }, { status: 403 })
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const current = String(body?.currentPassword ?? '')
  const next = String(body?.newPassword ?? '')
  const bad = passwordProblem(next)
  if (bad) return NextResponse.json({ error: bad, code: 'WEAK_PASSWORD' }, { status: 400 })
  if (!DEV_NO_PASSWORD && !current) return NextResponse.json({ error: 'Enter your current password', code: 'CURRENT_REQUIRED' }, { status: 400 })

  const email = String(user!.email || '').trim().toLowerCase()
  const isPartner = !!user!.isDistributor
  try {
    const row = await query(
      `SELECT password FROM pms_clients_master
        WHERE lower(email) = $1 ${isPartner ? 'AND clientcode IS NULL' : 'AND clientcode IS NOT NULL'}
        ORDER BY head_of_family DESC NULLS LAST LIMIT 1`,
      [email],
    )
    if (!row.rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    if (!DEV_NO_PASSWORD) {
      const stored = row.rows[0].password
      const ok = stored && stored !== 'Qode@123' && (await bcrypt.compare(current, stored))
      if (!ok) {
        void logAuthEvent(request, { email, event: 'login_failed', reason: 'wrong_password', platform: 'app', os: osFrom(body), meta: { during: 'change_password' } })
        return NextResponse.json({ error: 'Your current password is incorrect', code: 'WRONG_PASSWORD' }, { status: 401 })
      }
      if (await bcrypt.compare(next, stored)) return NextResponse.json({ error: 'Choose a password you have not used before', code: 'SAME_PASSWORD' }, { status: 400 })
    }
    const hash = await bcrypt.hash(next, 12)
    const upd = await query(
      `UPDATE pms_clients_master SET password = $1
        WHERE lower(email) = $2 ${isPartner ? 'AND clientcode IS NULL' : 'AND clientcode IS NOT NULL'}`,
      [hash, email],
    )
    if (!upd.rowCount) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    await query(`UPDATE password_reset_tokens SET used = TRUE WHERE lower(email) = $1 AND used = FALSE`, [email]).catch(() => {})
    await sendClientAck({
      to: user!.email, name: isPartner ? user!.distributorName || null : await clientName(email), from: isPartner ? 'partnerships' : 'ir',
      subject: 'Your myQode password was changed', title: 'Password changed',
      intro: `Your myQode ${isPartner ? 'Distributor Portal' : 'app'} password was changed just now from the app.`,
      details: [['When', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]],
      next: 'If this was you, there is nothing more to do. Your other devices will need the new password the next time they sign in.',
    })
    void logAuthEvent(request, { email, event: 'password_changed', platform: 'app', os: osFrom(body), meta: { partner: isPartner || undefined } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[mobile/auth/change-password]', err)
    return NextResponse.json({ error: 'Could not change the password. Please try again.' }, { status: 500 })
  }
}
