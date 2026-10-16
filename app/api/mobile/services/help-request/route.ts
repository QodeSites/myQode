// POST /api/mobile/services/help-request — "What do you need help with?" on Account Services (15 Oct 2026):
// { accountId, typeCode, message } since 16 Oct 2026: typeCode is a request type from GET /api/request-types (the Desk
// custom module cm_request_types); the ticket is named after that type and carries it in cf_request_type. No (or an
// unknown) typeCode → a "Raise Any Query" ticket without the type. The older { kind } still works:
//   switch   → Desk ticket "Switch Strategy (query)" (a question; the Switch Strategy card creates the Switch Plan)
//   referral → Desk ticket "Referral" (a question; the Referral Program page creates the Lead)
//   family  → Desk ticket "Link Family Accounts"
//   topup   → Desk ticket "Investment Related Query" (adding money, deployment, holdings; paying online is Add funds)
//   details → Desk ticket "Update Details" (nominee, email, phone or bank)
//   other   → Desk ticket "Raise Any Query"
// Each is a Zoho Desk ticket in Investor Relations (lib/zohoDesk.ts); Desk acknowledges the client and notifies the
// team, so no email goes from here. The request is recorded (type help_request) for Past Requests, which shows the
// ticket's status. If Desk is not set up or refuses, the request goes to IR by email with an acknowledgement.
import { internalMailHeaders } from '@/lib/webSession'
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { sendClientAck, clientName } from '@/lib/mobileAckMail'
import { raiseDeskTicket, requestTypeByCode, type DeskRequest } from '@/lib/zohoDesk'
import { requestChannel, submittedVia, internalBase } from '@/lib/requestChannel'
import { irRecipient, irSubject } from '@/lib/mobileIrMail'

const KINDS: Record<string, { desk: DeskRequest['kind']; title: string }> = {
  switch: { desk: 'switch_query', title: 'Switch Strategy' },
  referral: { desk: 'referral', title: 'Refer Someone' },
  family: { desk: 'link_family', title: 'Link Family Accounts' },
  topup: { desk: 'topup', title: 'Investment Related Query' },
  details: { desk: 'update_details', title: 'Update Details' },
  other: { desk: 'discussion', title: 'Raise Any Query' },
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// The same submission arriving twice (the app retries after a slow answer, or a double click): keyed by the login and
// the form's requestKey, the second waits for the first and gets the same answer — one ticket, never two. 15 minutes.
type Answer = { status: number; body: any }
const inflight: Map<string, { at: number; p: Promise<Answer> }> = ((globalThis as any).__qodeHelpInflight ??= new Map())

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  // App Store / Play Store reviewer (mock accounts): the form works, but nothing reaches Investor Relations.
  if (user!.isReviewer) return NextResponse.json({ success: true, inquiry_id: 'REVIEW-' + Date.now().toString().slice(-6) })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const rk = String(body?.requestKey || '').slice(0, 80)
  for (const [k, v] of inflight) if (Date.now() - v.at > 15 * 60_000) inflight.delete(k)
  const key = rk ? `${String(user!.email).toLowerCase()}|${rk}` : ''
  const seen = key ? inflight.get(key) : undefined
  if (seen) { const a = await seen.p; return NextResponse.json(a.body, { status: a.status }) }
  const p = handle(request, user!, body)
  if (key) inflight.set(key, { at: Date.now(), p })
  const a = await p
  if (key && a.status >= 400) inflight.delete(key)   // a refusal may be retried as new
  return NextResponse.json(a.body, { status: a.status })
}

async function handle(request: NextRequest, user: any, body: any): Promise<Answer> {
  const reply = (b: any, status = 200): Answer => ({ status, body: b })
  try {
    const accountId = String(body?.accountId || '')
    const typeCode = String(body?.typeCode || '').trim()
    const message = String(body?.message || '').trim()
    // the chosen request type (its name titles the ticket); without one, the older kinds, else Raise Any Query
    const type = typeCode ? await requestTypeByCode(typeCode) : null
    const kind = type ? 'typed' : KINDS[String(body?.kind || '')] ? String(body.kind) : 'other'
    const k = type ? { desk: 'discussion' as DeskRequest['kind'], title: type.name } : KINDS[kind]
    if (!accountId) return reply({ error: 'Fields required: accountId, typeCode, message' }, 400)
    if (!user!.accountCodes?.includes(accountId)) return reply({ error: 'Forbidden' }, 403)
    if (message.length < 5) return reply({ error: 'Please tell us a little more.' }, 400)
    if (message.length > 2000) return reply({ error: 'Please keep it under 2000 characters.' }, 400)

    const channel = requestChannel(request)   // Web / App (lib/requestChannel.ts)
    const name = await clientName(user!.email)

    const desk = await raiseDeskTicket({
      channel, kind: k.desk, label: type ? type.name : undefined, typeCode: type?.code || null,
      subject: type ? `Request from ${accountId}` : `${k.title} from ${accountId}`, email: user!.email, name, accountId,
      fields: [['Investor ID', user!.clientId], ['Request', message]],
    })

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">${esc(k.title)}</h1>
        </div>
        <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Submitted via:</strong> ${submittedVia(channel)}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
            <p><strong>Account ID:</strong> ${esc(accountId)}</p>
            <p><strong>Investor ID:</strong> ${esc(user!.clientId)}</p>
            <p><strong>Email:</strong> ${esc(user!.email)}</p>
            <p><strong>Request:</strong></p>
            <p>${esc(message).replace(/\n/g, '<br/>')}</p>
          </div>
        </div>
      </div>`

    // Recording the request (for Past Requests) and the fallback email. With a Desk ticket the client is answered as
    // soon as the ticket exists and this runs after (Desk sends the emails), so a slow step never keeps the app waiting.
    const record = async (): Promise<string | null> => {
    const emailRes = await fetch(`${internalBase()}/api/send-email`, {
      method: 'POST',
      headers: internalMailHeaders(user?.email),
      body: JSON.stringify({
        to: irRecipient(),   // investor.relations@ — or MOBILE_IR_EMAIL_OVERRIDE while testing (lib/mobileIrMail.ts)
        subject: irSubject(`${k.title} from ${accountId}`),
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'help_request',
        help_kind: kind,
        type_code: type?.code ?? null,   // the request type chosen (Desk cm_request_types), for Past Requests
        type_name: type?.name ?? null,
        desk_ticket: desk?.ticketNumber ?? null,
        desk_ticket_id: desk?.id ?? null,
        record_only: !!desk,   // Desk notifies the team and the client; the row is kept for tracking
        channel,
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        message,
      }),
    })
    const emailData = await emailRes.json()
    if (!emailRes.ok) throw new Error(emailData.error || 'Email send failed')

    // Acknowledgement to the investor — ours only when there is no Desk ticket (Desk sends its own on creation).
    if (!desk) await sendClientAck({
      to: user!.email, name, reference: emailData.inquiry_id,
      subject: `We’ve received your request: ${k.title}`, title: `${k.title} received`,
      intro: 'We’ve received your request, raised from myQode.',
      details: [['Account', accountId], ['Request', message]],
      next: 'Our Investor Relations team will get back to you within 24 hours. You do not need to send this again.',
    })
    return emailData.inquiry_id ?? null
    }
    if (desk) {
      record().catch(e => console.error('[mobile/services/help-request] ticket #' + desk.ticketNumber + ' raised but not recorded -', e?.message))
      return reply({ success: true, inquiry_id: null, ticket: desk.ticketNumber })
    }
    return reply({ success: true, inquiry_id: await record(), ticket: null })   // no Desk: the email is the request
  } catch (err) {
    console.error('[mobile/services/help-request]', err)
    return reply({ error: 'Internal server error' }, 500)
  }
}
