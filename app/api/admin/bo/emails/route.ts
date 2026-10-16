// GET /api/admin/bo/emails?from=yyyy-mm-dd&to=yyyy-mm-dd&type=investor|distributor|internal&status=sent|failed&q=…&page=1&limit=50
//   (staff): the emails the portal sent, web and app (email_log, lib/emailLog.ts), newest first. Dates are IST days,
//   both inclusive; q matches a recipient address, the recipient's name, a client code or the subject.
// GET /api/admin/bo/emails?id=123: one email with its body (null when it carried a code or a password link).
//
// Who sees what: super admins and viewers every email, investors admins the investor emails, partners admins the
// distributor emails; accounts admins none. Recorded from the day logging started — nothing earlier exists here.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const TYPES = ['investor', 'distributor', 'internal']

export async function GET(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'staff')
  if (error) return error
  // The side this admin may read: null = every email.
  const only = admin!.role === 'investors' ? 'investor' : admin!.role === 'partners' ? 'distributor' : null
  if (admin!.role === 'accounts') return NextResponse.json({ error: 'Not available for your role' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  try {
    const exists = (await query(`SELECT to_regclass('public.email_log') AS t`)).rows[0]?.t

    const id = sp.get('id')
    if (id) {
      if (!/^\d+$/.test(id) || !exists) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
      const r = await query(`SELECT * FROM email_log WHERE id = $1`, [id])
      const x: any = r.rows[0]
      if (!x || (only && x.recipient_type !== only)) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
      return NextResponse.json({ email: { ...row(x), html: x.body_html, attachments: x.attachments || [] } })
    }

    const limit = Math.min(200, Math.max(1, Math.floor(Number(sp.get('limit')) || 50)))
    const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
    if (!exists) return NextResponse.json({ items: [], page, limit, total: 0, counts: { investor: 0, distributor: 0, internal: 0, failed: 0 } })

    const where: string[] = []
    const params: any[] = []
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('$?', '$' + params.length)) }
    const from = isDate(sp.get('from')), to = isDate(sp.get('to'))
    if (from) add(`created_at >= ($?::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`, from)
    if (to) add(`created_at < ($?::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`, to)
    if (only) add(`recipient_type = $?`, only)
    const q = (sp.get('q') || '').trim().toLowerCase().slice(0, 100)
    if (q) {
      params.push(`%${q}%`)
      const n = '$' + params.length
      where.push(`(array_to_string(to_addrs || cc_addrs, ' ') ILIKE ${n} OR recipient_name ILIKE ${n} OR subject ILIKE ${n}
                   OR array_to_string(client_codes, ' ') ILIKE ${n})`)
    }
    // The counts below cover the date range and search; type and status narrow only the list.
    const base = [...where], baseParams = [...params]
    const type = sp.get('type')
    if (type && TYPES.includes(type)) add(`recipient_type = $?`, type)
    const status = sp.get('status')
    if (status === 'sent' || status === 'failed') add(`status = $?`, status)
    const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const bw = base.length ? 'WHERE ' + base.join(' AND ') : ''

    const [itemsRes, totalRes, countsRes] = await Promise.all([
      query(`SELECT id, created_at, to_addrs, cc_addrs, from_name, subject, status, error, body_withheld, attachments,
                    recipient_type, recipient_name, client_codes
               FROM email_log ${w} ORDER BY created_at DESC, id DESC
              LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit]),
      query(`SELECT count(*)::int AS n FROM email_log ${w}`, params),
      query(`SELECT count(*) FILTER (WHERE recipient_type = 'investor')::int AS investor,
                    count(*) FILTER (WHERE recipient_type = 'distributor')::int AS distributor,
                    count(*) FILTER (WHERE recipient_type = 'internal')::int AS internal,
                    count(*) FILTER (WHERE status = 'failed')::int AS failed,
                    min(created_at) AS since
               FROM email_log ${bw}`, baseParams),
    ])
    return NextResponse.json({
      items: itemsRes.rows.map(row),
      page, limit, total: totalRes.rows[0].n,
      counts: countsRes.rows[0],
      only,
    })
  } catch (e) {
    console.error('[admin/bo/emails]', e)
    return NextResponse.json({ error: 'Could not load emails' }, { status: 500 })
  }
}

function row(x: any) {
  return {
    id: Number(x.id), at: x.created_at, to: x.to_addrs || [], cc: x.cc_addrs || [], fromName: x.from_name,
    subject: x.subject, status: x.status, error: x.error, bodyWithheld: !!x.body_withheld,
    attachments: (x.attachments || []).length, type: x.recipient_type, name: x.recipient_name, clientCodes: x.client_codes || [],
  }
}
