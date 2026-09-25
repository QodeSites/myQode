// POST /api/mobile/distributor/ticket   { topic, aboutInvestor?, message }
// The partner app's "Raise a ticket" — a port of app/api/distributor/ticket: same topics, limits, inquiry record
// (type distributor_ticket) and email to the partnerships team. Differences, both safer:
//   - identity comes from the signed mobile JWT (requireMobileDistributor), not the unsigned web cookie;
//   - the email result is checked: if both the record and the email fail, the partner is told, not shown success.
// While testing, MOBILE_IR_EMAIL_OVERRIDE (lib/mobileIrMail) receives the email instead of partnerships@.
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'
import { query } from '@/lib/db1'
import { graphMailer } from '@/lib/graphEmail'

const PARTNERSHIPS = 'partnerships@qodeinvest.com'
const TOPICS: Record<string, string> = {
  onboarding: 'Onboarding help',
  investor: 'Question about an investor',
  payout: 'Payout or brokerage',
  reporting: 'Reporting or statements',
  access: 'Portal access',
  other: 'Other',
}
const MAX_MESSAGE = 4000
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const override = () => (process.env.MOBILE_IR_EMAIL_OVERRIDE || '').split(',').map((s) => s.trim()).filter(Boolean)

export async function POST(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const topicKey = String(body?.topic || '')
  if (!TOPICS[topicKey]) return NextResponse.json({ error: 'Pick a topic' }, { status: 400 })
  const message = String(body?.message || '').trim()
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  if (message.length > MAX_MESSAGE) return NextResponse.json({ error: `Message must be under ${MAX_MESSAGE} characters` }, { status: 400 })
  // Only the two topics that ask "which investor?" keep that field (the web sends a stale value for others).
  const aboutInvestor = topicKey === 'investor' || topicKey === 'onboarding' ? String(body?.aboutInvestor || '').trim().slice(0, 200) : ''

  const d = distributor!
  const topicLabel = TOPICS[topicKey]
  const testTo = override()
  const subject = (testTo.length ? '[TEST · PARTNERSHIPS] ' : '') + `Partner ticket — ${topicLabel} — ${d.clientname}`
  const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Partner Ticket</h1>
        </div>
        <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Raised via:</strong> myQode partner app</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-IN')}</p>
          <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
            <p><strong>Partner:</strong> ${esc(d.clientname)}</p>
            <p><strong>Email:</strong> ${esc(d.email)}</p>
            <p><strong>Topic:</strong> ${esc(topicLabel)}</p>
            ${aboutInvestor ? `<p><strong>About investor:</strong> ${esc(aboutInvestor)}</p>` : ''}
            <p><strong>Message:</strong></p>
            <p>${esc(message).replace(/\n/g, '<br/>')}</p>
          </div>
        </div>
      </div>`

  let inquiryId: string | null = null
  try {
    const result = await query(
      `INSERT INTO pms_clients_tracker.qode_microsite_inquiries
         (type, nuvama_code, client_id, user_email, subject, status, priority, data, email_to, email_from, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
       RETURNING id`,
      ['distributor_ticket', `PARTNER:${d.referralSlug ?? d.email}`, null, d.email, subject, 'pending', 'normal',
        JSON.stringify({ partner: d.clientname, topic: topicKey, topicLabel, aboutInvestor: aboutInvestor || null, message, source: 'mobile_app' }),
        testTo.length ? testTo.join(',') : PARTNERSHIPS, PARTNERSHIPS],
    )
    inquiryId = result?.rows?.[0]?.id ?? null
  } catch (err) {
    console.error('[mobile/distributor/ticket] insert failed:', err)
  }

  const sent: any = await graphMailer.emails.send({ from: PARTNERSHIPS, to: testTo.length ? testTo : [PARTNERSHIPS], replyTo: d.email, subject, html }).catch((e: any) => ({ error: e }))
  if (sent?.error) console.error('[mobile/distributor/ticket] email failed:', sent.error)
  if (sent?.error && !inquiryId) {
    return NextResponse.json({ error: 'We couldn’t send that. Please try again, or email partnerships@qodeinvest.com.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, inquiryId })
}
