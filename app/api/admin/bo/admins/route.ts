// GET /api/admin/bo/admins (super): BACKOFFICE_ADMINS joined with admin_users.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, ensureAdminTables, backofficeAdminEmails, isAppAdmin } from '@/lib/adminAuth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'super')
  if (error) return error
  try {
    await ensureAdminTables()
    const emails = backofficeAdminEmails()
    const rows = emails.length
      ? (await query(`SELECT email, name, password IS NOT NULL AS password_set, last_login_at FROM admin_users WHERE email = ANY($1::text[])`, [emails])).rows
      : []
    const byEmail = new Map(rows.map((r: any) => [r.email, r]))
    return NextResponse.json({
      items: emails.map(email => {
        const r: any = byEmail.get(email)
        return { email, name: r?.name || email.split('@')[0], passwordSet: !!r?.password_set, lastLoginAt: r?.last_login_at ?? null, app: isAppAdmin(email) }
      }),
    })
  } catch (e) {
    console.error('[admin/bo/admins]', e)
    return NextResponse.json({ error: 'Could not load admins' }, { status: 500 })
  }
}
