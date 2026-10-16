// Admins: the single list of who can use the admin side (web /admin and the app's admin mode), and their role.
// GET    (super)                          → { items: [{ email, name, role, passwordSet, lastLoginAt, app }], roles }
// PUT    (super) { email, role, name? }   → adds an admin or changes their role
// PATCH  (super) { email, rawDataEmails } → the investors whose raw-data workbook a non-super admin may download
//                                            (lib/adminAuth.ts canDownloadRawData; super admins may download any)
// DELETE (super) ?email=…                 → removes admin access (the row and password stay, without a role)
// A super admin cannot change or remove their own role, so the last super admin can never lock everyone out.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, ensureAdminTables, adminRoles, clearAdminRoles, audit, ADMIN_ROLES, type AdminRole } from '@/lib/adminAuth'
import { normEmail, readJson } from '@/lib/adminUsers'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'super')
  if (error) return error
  try {
    await ensureAdminTables()
    const roles = await adminRoles()
    const emails = [...roles.keys()]
    const rows = emails.length
      ? (await query(`SELECT email, name, password IS NOT NULL AS password_set, last_login_at, raw_data_emails FROM admin_users WHERE email = ANY($1::text[])`, [emails])).rows
      : []
    const byEmail = new Map<string, any>(rows.map((r: any) => [r.email, r]))
    const order = (r: AdminRole) => ADMIN_ROLES.indexOf(r)
    return NextResponse.json({
      roles: ADMIN_ROLES,
      items: emails.map(email => {
        const r = byEmail.get(email); const x = roles.get(email)!
        return { email, name: r?.name || x.name || email.split('@')[0], role: x.role, passwordSet: !!r?.password_set, lastLoginAt: r?.last_login_at ?? null, app: x.role !== 'viewer', rawDataEmails: r?.raw_data_emails || [] }
      }).sort((a, b) => order(a.role) - order(b.role) || a.email.localeCompare(b.email)),
    })
  } catch (e) {
    console.error('[admin/bo/admins]', e)
    return NextResponse.json({ error: 'Could not load admins' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  const role = String(body.role || '') as AdminRole
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (!ADMIN_ROLES.includes(role)) return NextResponse.json({ error: 'Choose a role: ' + ADMIN_ROLES.join(', ') }, { status: 400 })
  if (email === admin!.email && role !== 'super') return NextResponse.json({ error: 'You cannot lower your own role' }, { status: 400 })
  try {
    await ensureAdminTables()
    const before = (await query(`SELECT role FROM admin_users WHERE email = $1`, [email])).rows[0]?.role ?? null
    await query(
      `INSERT INTO admin_users (email, name, role, role_updated_at, role_updated_by) VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, role_updated_at = now(), role_updated_by = EXCLUDED.role_updated_by,
         name = COALESCE(EXCLUDED.name, admin_users.name)`,
      [email, body.name ? String(body.name).trim().slice(0, 120) : null, role, admin!.email])
    clearAdminRoles()
    await audit(req, admin!, 'admin.role', email, { from: before, to: role })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/bo/admins] PUT', e)
    return NextResponse.json({ error: 'Could not save the role' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError
  const email = normEmail(body.email)
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  const list = [...new Set((Array.isArray(body.rawDataEmails) ? body.rawDataEmails : []).map((v: unknown) => normEmail(v)).filter(Boolean))] as string[]
  if (list.length > 50) return NextResponse.json({ error: 'At most 50 investors' }, { status: 400 })
  try {
    await ensureAdminTables()
    if (!(await adminRoles()).has(email)) return NextResponse.json({ error: 'Not an admin' }, { status: 404 })
    // Only investor logins (a client master row with a client code) can be listed.
    const found = list.length
      ? (await query(`SELECT DISTINCT lower(trim(email)) AS e FROM pms_clients_master WHERE lower(trim(email)) = ANY($1::text[]) AND clientcode IS NOT NULL`, [list])).rows.map((r: any) => r.e)
      : []
    const unknown = list.filter(e => !found.includes(e))
    if (unknown.length) return NextResponse.json({ error: 'Not an investor login: ' + unknown.join(', ') }, { status: 400 })
    const before = (await query(`SELECT raw_data_emails FROM admin_users WHERE email = $1`, [email])).rows[0]?.raw_data_emails || []
    await query(`UPDATE admin_users SET raw_data_emails = $2 WHERE email = $1`, [email, list])
    await audit(req, admin!, 'admin.raw_data_access', email, { from: before, to: list })
    return NextResponse.json({ ok: true, rawDataEmails: list })
  } catch (e) {
    console.error('[admin/bo/admins] PATCH', e)
    return NextResponse.json({ error: 'Could not save raw-data access' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const email = normEmail(req.nextUrl.searchParams.get('email'))
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (email === admin!.email) return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 })
  try {
    await ensureAdminTables()
    const before = (await query(`UPDATE admin_users SET role = NULL, role_updated_at = now(), role_updated_by = $2 WHERE email = $1 RETURNING role`, [email, admin!.email])).rowCount
    clearAdminRoles()
    await audit(req, admin!, 'admin.remove', email, { removed: !!before })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/bo/admins] DELETE', e)
    return NextResponse.json({ error: 'Could not remove the admin' }, { status: 500 })
  }
}
