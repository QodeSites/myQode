// GET /api/mobile/notifications?limit=50&before=<id> → the signed-in login's inbox for the last 3 days (older entries drop off), newest first (lib/appNotify.ts).
//   { items: [{ id, category, title, body, link, createdAt, read }], unread, hasMore }
// Admin viewing a client sees that client's inbox. The App Store reviewer gets a fixed sample.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { tablesReady } from '@/lib/appNotify'

export const dynamic = 'force-dynamic'

const SAMPLE = [
  { id: 3, category: 'portfolio', title: 'Your August update', body: 'Your portfolio returned +2.1% in August and was worth ₹48.2 L at month end.', link: 'tab:portfolio', hoursAgo: 20 },
  { id: 2, category: 'reading', title: 'New newsletter', body: 'Our latest newsletter is ready to read in the app.', link: 'page:newsletters', hoursAgo: 70 },
  { id: 1, category: 'money', title: 'Investment recorded', body: '₹5 L was added to your Qode All Weather account on 12 Aug.', link: 'page:transactions', hoursAgo: 300 },
]

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) {
    const now = Date.now()
    return NextResponse.json({ items: SAMPLE.map(({ hoursAgo, ...x }) => ({ ...x, createdAt: new Date(now - hoursAgo * 3600000).toISOString(), read: hoursAgo > 24 })), unread: 1, hasMore: false })
  }
  if (!(await tablesReady())) return NextResponse.json({ items: [], unread: 0, hasMore: false })
  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, Math.floor(Number(sp.get('limit')) || 50)))
  const before = Math.floor(Number(sp.get('before')) || 0)
  const email = String(user!.email || '').trim().toLowerCase()
  try {
    const [items, unread] = await Promise.all([
      query(
        `SELECT id, category, title, body, link, created_at, read_at FROM app_notifications
          WHERE email = $1 AND created_at > NOW() - interval '3 days'
            AND ($2 = 0 OR (created_at, id) < (SELECT created_at, id FROM app_notifications WHERE id = $2))
          ORDER BY created_at DESC, id DESC LIMIT $3`, [email, before, limit + 1]),
      query(`SELECT count(*)::int AS n FROM app_notifications WHERE email = $1 AND read_at IS NULL AND created_at > NOW() - interval '3 days'`, [email]),
    ])
    const rows = items.rows.slice(0, limit)
    return NextResponse.json({
      items: rows.map((r: any) => ({ id: Number(r.id), category: r.category, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: !!r.read_at })),
      unread: unread.rows[0]?.n || 0,
      hasMore: items.rows.length > limit,
    })
  } catch (err) {
    console.error('[mobile/notifications]', err)
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 })
  }
}
