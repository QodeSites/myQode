// Admin → Notifications (lib/appNotify.ts).
// GET  (staff) → { live, testEmails, devices, outbox, strategies, campaigns: [{ …, stats }] }
// POST (super) { title, body, link?, category?, audience: { type: 'test' | 'all' | 'strategy' | 'emails', value? } }
//   'test' sends only to the admin's own login (always allowed); anything else needs PUSH_LIVE=1 on the server.
//   Returns { campaignId, recipients }. Audited as notifications.send.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { query } from '@/lib/db'
import { tablesReady, pushLive, testEmails, appAudience, notifyEmails, Category } from '@/lib/appNotify'

export const dynamic = 'force-dynamic'

const LINKS = ['tab:home', 'tab:portfolio', 'tab:reports', 'tab:docs', 'tab:services', 'page:newsletters', 'page:perspectives', 'page:transactions', 'page:sip', 'sheet:add']
const CATS: Category[] = ['updates', 'reading', 'portfolio']

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  if (!(await tablesReady())) return NextResponse.json({ ready: false, live: pushLive(), testEmails: testEmails(), campaigns: [] })
  try {
    const [camps, dev, outbox, strat] = await Promise.all([
      query(
        `SELECT c.id, c.title, c.body, c.link, c.category, c.audience, c.created_by, c.created_at, c.recipients,
                count(n.id)::int AS total,
                count(n.id) FILTER (WHERE n.push_status IN ('delivered', 'unconfirmed'))::int AS delivered,
                count(n.id) FILTER (WHERE n.push_status IN ('pending', 'sending', 'sent'))::int AS in_flight,
                count(n.id) FILTER (WHERE n.push_status = 'failed')::int AS failed,
                count(n.id) FILTER (WHERE n.push_status = 'no_device')::int AS no_device,
                count(n.id) FILTER (WHERE n.push_status IN ('muted', 'expired'))::int AS muted,
                count(n.id) FILTER (WHERE n.read_at IS NOT NULL)::int AS read
           FROM app_notification_campaigns c LEFT JOIN app_notifications n ON n.campaign_id = c.id
          GROUP BY c.id ORDER BY c.id DESC LIMIT 50`),
      query(`SELECT count(*) FILTER (WHERE is_active)::int AS active, count(DISTINCT email) FILTER (WHERE is_active)::int AS logins,
                    count(*) FILTER (WHERE is_active AND platform = 'ios')::int AS ios, count(*) FILTER (WHERE is_active AND platform = 'android')::int AS android
               FROM app_push_devices`),
      query(`SELECT count(*) FILTER (WHERE push_status IN ('pending', 'sending'))::int AS pending,
                    count(*) FILTER (WHERE push_status = 'failed' AND created_at > NOW() - interval '1 day')::int AS failed24h,
                    count(*) FILTER (WHERE created_at > NOW() - interval '1 day')::int AS created24h
               FROM app_notifications`),
      query(`SELECT DISTINCT schemename FROM pms_clients_master WHERE schemename IS NOT NULL AND first_app_login_at IS NOT NULL ORDER BY 1`),
    ])
    return NextResponse.json({
      ready: true, live: pushLive(), testEmails: testEmails(), links: LINKS,
      devices: dev.rows[0], outbox: outbox.rows[0], strategies: strat.rows.map((r: any) => r.schemename),
      campaigns: camps.rows.map((c: any) => ({
        id: Number(c.id), title: c.title, body: c.body, link: c.link, category: c.category, audience: c.audience,
        createdBy: c.created_by, createdAt: c.created_at, recipients: c.recipients,
        stats: { total: c.total, delivered: c.delivered, inFlight: c.in_flight, failed: c.failed, noDevice: c.no_device, muted: c.muted, read: c.read },
      })),
    })
  } catch (err) {
    console.error('[admin/bo/notifications GET]', err)
    return NextResponse.json({ error: 'Could not load' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  if (!(await tablesReady())) return NextResponse.json({ error: 'Notification tables are not created yet' }, { status: 503 })
  let b: any = {}
  try { b = await req.json() } catch {}
  const title = String(b?.title || '').trim(), body = String(b?.body || '').trim()
  const link = b?.link && LINKS.includes(b.link) ? b.link : null
  const type = String(b?.audience?.type || '')
  // A test may use any category, so each kind of notification can be tried on the admin's own phone.
  const category: Category = CATS.includes(b?.category) || (type === 'test' && b?.category === 'money') ? b.category : 'updates'
  if (!title || title.length > 90) return NextResponse.json({ error: 'Title is required (up to 90 characters)' }, { status: 400 })
  if (!body || body.length > 300) return NextResponse.json({ error: 'Message is required (up to 300 characters)' }, { status: 400 })
  if (!['test', 'all', 'strategy', 'emails'].includes(type)) return NextResponse.json({ error: 'Choose who receives it' }, { status: 400 })
  if (type !== 'test' && !pushLive()) {
    return NextResponse.json({ error: 'Notifications are not live yet (PUSH_LIVE=1 on the server). Send a test to yourself.', code: 'NOT_LIVE' }, { status: 409 })
  }

  let emails: string[] = []
  if (type === 'test') emails = [admin!.email]
  else if (type === 'all') emails = await appAudience()
  else if (type === 'strategy') {
    if (!b?.audience?.value) return NextResponse.json({ error: 'Choose a strategy' }, { status: 400 })
    emails = await appAudience(String(b.audience.value))
  } else {
    emails = String(b?.audience?.value || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (!emails.length) return NextResponse.json({ error: 'Add at least one email' }, { status: 400 })
  }
  emails = [...new Set(emails.map(e => e.toLowerCase()))]
  if (!emails.length) return NextResponse.json({ error: 'Nobody matches this audience' }, { status: 400 })

  try {
    const audience = { type, value: type === 'strategy' ? String(b.audience.value) : type === 'emails' ? emails : null }
    const c = await query(
      `INSERT INTO app_notification_campaigns (title, body, link, category, audience, created_by, recipients) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [title, body, link, category, JSON.stringify(audience), admin!.email, emails.length])
    const campaignId = Number(c.rows[0].id)
    const written = await notifyEmails(emails, { category, title, body, link, dedupeKey: `campaign:${campaignId}`, campaignId }, { force: type === 'test' })
    await audit(req, admin!, 'notifications.send', type === 'test' ? admin!.email : type, { campaignId, title, recipients: written, audience: type })
    return NextResponse.json({ campaignId, recipients: written })
  } catch (err) {
    console.error('[admin/bo/notifications POST]', err)
    return NextResponse.json({ error: 'Could not send' }, { status: 500 })
  }
}
