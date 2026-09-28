// GET /api/admin/bo/audit?limit=100&admin=&action=&target= (super): the backoffice audit log, newest first.
// admin and target match exactly (case-insensitive); action matches as a prefix ('user.' finds every user action).
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, ensureAdminTables } from '@/lib/adminAuth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'super')
  if (error) return error
  const sp = req.nextUrl.searchParams
  const limit = Math.min(500, Math.max(1, Math.floor(Number(sp.get('limit')) || 100)))
  const where: string[] = []
  const params: any[] = []
  const add = (sql: string, v: string) => { params.push(v); where.push(sql.replace('?', '$' + params.length)) }
  const admin = (sp.get('admin') || '').trim().toLowerCase()
  const action = (sp.get('action') || '').trim()
  const target = (sp.get('target') || '').trim().toLowerCase()
  if (admin) add('lower(admin_email) = ?', admin)
  if (action) add("action LIKE ? ESCAPE '\\'", action.replace(/[\\%_]/g, m => '\\' + m) + '%')
  if (target) add('lower(target) = ?', target)
  params.push(limit)
  try {
    await ensureAdminTables()
    const r = await query(
      `SELECT id, created_at AS at, admin_email AS admin, action, target, details, ip
         FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    )
    return NextResponse.json({ items: r.rows.map((x: any) => ({ ...x, id: Number(x.id) })) })
  } catch (e) {
    console.error('[admin/bo/audit]', e)
    return NextResponse.json({ error: 'Could not load the audit log' }, { status: 500 })
  }
}
