// GET /api/admin/bo/feedback?from=yyyy-mm-dd&to=yyyy-mm-dd&page=1&limit=50 (staff): the app's "Your Voice Matters"
// answers (client_feedback, lib/clientFeedback.ts), newest first, with a summary over the same date range (IST days,
// both inclusive):
//   avg*        mean rating 1–5 (2 dp)
//   promoters   recommend = 5, passives recommend = 4, detractors recommend ≤ 3 (NPS buckets on this 1–5 scale)
//   score       (promoters − detractors) / count × 100, rounded; null with no answers
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const avg = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100)

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  const sp = req.nextUrl.searchParams
  const from = isDate(sp.get('from')), to = isDate(sp.get('to'))
  const limit = Math.min(200, Math.max(1, Math.floor(Number(sp.get('limit')) || 50)))
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const emptySummary = { count: 0, avgRecommend: null, avgSatisfaction: null, avgClarity: null, avgEase: null, promoters: 0, passives: 0, detractors: 0, score: null }

  const where: string[] = []
  const params: any[] = []
  if (from) { params.push(from); where.push(`created_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`) }
  if (to) { params.push(to); where.push(`created_at < ($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`) }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''

  try {
    // Nothing submitted yet: the table is only created by the first submission, not by reading.
    const exists = (await query(`SELECT to_regclass('public.client_feedback') AS t`)).rows[0]?.t
    if (!exists) return NextResponse.json({ items: [], page, limit, total: 0, summary: emptySummary })
    const [itemsRes, sumRes] = await Promise.all([
      query(
        `SELECT id, created_at AS at, email, client_code, account_codes, recommend, satisfaction, clarity, ease, comment, platform, app_version
           FROM client_feedback ${w} ORDER BY created_at DESC, id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit]),
      query(
        `SELECT count(*)::int AS count, avg(recommend) AS r, avg(satisfaction) AS s, avg(clarity) AS c, avg(ease) AS e,
                count(*) FILTER (WHERE recommend = 5)::int AS promoters,
                count(*) FILTER (WHERE recommend = 4)::int AS passives,
                count(*) FILTER (WHERE recommend <= 3)::int AS detractors
           FROM client_feedback ${w}`, params),
    ])
    const x = sumRes.rows[0]
    const count = x.count || 0
    return NextResponse.json({
      items: itemsRes.rows.map((r: any) => ({
        id: Number(r.id), at: r.at, email: r.email, clientCode: r.client_code, accountCodes: r.account_codes || [],
        recommend: r.recommend, satisfaction: r.satisfaction, clarity: r.clarity, ease: r.ease,
        comment: r.comment, platform: r.platform, appVersion: r.app_version,
      })),
      page, limit, total: count,
      summary: count ? {
        count, avgRecommend: avg(x.r), avgSatisfaction: avg(x.s), avgClarity: avg(x.c), avgEase: avg(x.e),
        promoters: x.promoters, passives: x.passives, detractors: x.detractors,
        score: Math.round(((x.promoters - x.detractors) / count) * 100),
      } : emptySummary,
    })
  } catch (e) {
    console.error('[admin/bo/feedback]', e)
    return NextResponse.json({ error: 'Could not load feedback' }, { status: 500 })
  }
}
