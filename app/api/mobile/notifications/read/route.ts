// POST /api/mobile/notifications/read  { ids: number[] } | { all: true } → marks inbox items read; returns { unread }.
// Admin viewing a client and the reviewer change nothing (the client's own unread state is kept).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { tablesReady } from '@/lib/appNotify'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer || user!.isImpersonated || !(await tablesReady())) return NextResponse.json({ unread: 0, skipped: true })
  let body: any = {}
  try { body = await request.json() } catch {}
  const email = String(user!.email || '').trim().toLowerCase()
  const ids = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => Math.floor(Number(x))).filter((x: number) => x > 0).slice(0, 500) : []
  if (!body?.all && !ids.length) return NextResponse.json({ error: 'ids or all is required' }, { status: 400 })
  try {
    await query(
      body?.all
        ? `UPDATE app_notifications SET read_at = NOW() WHERE email = $1 AND read_at IS NULL`
        : `UPDATE app_notifications SET read_at = NOW() WHERE email = $1 AND read_at IS NULL AND id = ANY($2)`,
      body?.all ? [email] : [email, ids])
    const n = await query(`SELECT count(*)::int AS n FROM app_notifications WHERE email = $1 AND read_at IS NULL AND created_at > NOW() - interval '3 days'`, [email])
    return NextResponse.json({ unread: n.rows[0]?.n || 0 })
  } catch (err) {
    console.error('[mobile/notifications/read]', err)
    return NextResponse.json({ error: 'Could not update' }, { status: 500 })
  }
}
