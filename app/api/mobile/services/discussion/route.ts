// POST /api/mobile/services/discussion
// Raise a general query / discussion topic with the IR team.
import { internalMailHeaders } from '@/lib/webSession'
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { sendClientAck, clientName } from '@/lib/mobileAckMail'
import { raiseDeskTicket } from '@/lib/zohoDesk'
import { requestChannel, submittedVia, internalBase } from '@/lib/requestChannel'
import { irRecipient, irSubject } from '@/lib/mobileIrMail'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  // App Store / Play Store reviewer (mock accounts): the form works, but nothing reaches Investor Relations.
  if (user!.isReviewer) return NextResponse.json({ success: true, inquiry_id: 'REVIEW-' + Date.now().toString().slice(-6) })

  try {
    const body = await request.json()
    const { accountId, topic } = body

    if (!accountId || !topic?.trim()) {
      return NextResponse.json(
        { error: 'Fields required: accountId, topic' },
        { status: 400 }
      )
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (String(topic).trim().length > 2000) return NextResponse.json({ error: 'Please keep it under 2000 characters.' }, { status: 400 })

    const channel = requestChannel(request)   // Web / App (lib/requestChannel.ts)

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Investor Query</h1>
        </div>
        <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Submitted via:</strong> ${submittedVia(channel)}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
            <p><strong>Account ID:</strong> ${accountId}</p>
            <p><strong>Investor ID:</strong> ${user!.clientId}</p>
            <p><strong>Email:</strong> ${user!.email}</p>
            <p><strong>Topic / Query:</strong></p>
            <p>${String(topic).replace(/\n/g, '<br/>')}</p>
          </div>
        </div>
      </div>`

    // Zoho Desk ticket (lib/zohoDesk.ts); null when Desk is not set up here or refused — the request carries on by email.
    const desk = await raiseDeskTicket({
      channel,
      kind: 'discussion', subject: `Discussion request from ${accountId}`, email: user!.email, name: await clientName(user!.email), accountId,
      fields: [['Investor ID', user!.clientId], ['Topic', String(topic).trim()]],
    })

    const emailRes = await fetch(`${internalBase()}/api/send-email`, {
      method: 'POST',
      headers: internalMailHeaders(user?.email),
      body: JSON.stringify({
        to: irRecipient(),   // investor.relations@ — or MOBILE_IR_EMAIL_OVERRIDE while testing (lib/mobileIrMail.ts)
        subject: irSubject(`New Query from ${accountId}`),
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'discussion',
        desk_ticket: desk?.ticketNumber ?? null,
        desk_ticket_id: desk?.id ?? null,
        record_only: !!desk,   // Desk notifies the team and the client; the row is kept for tracking
        channel,               // Web / App, for the request tracking list
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        topic: topic.trim(),
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) throw new Error(emailData.error || 'Email send failed')

    // Acknowledgement to the investor — ours only when there is no Desk ticket (Desk sends its own on creation).
    if (!desk) await sendClientAck({
      to: user!.email, name: await clientName(user!.email), reference: emailData.inquiry_id,
      subject: 'We’ve received your discussion request', title: 'Discussion request received',
      intro: 'We’ve received your request for a discussion with Investor Relations, raised from the myQode app.',
      details: [['Account', accountId], ['Topic', topic]],
      next: 'Our Investor Relations team will get in touch to arrange a time. You do not need to send this again.',
    })
    return NextResponse.json({ success: true, inquiry_id: emailData.inquiry_id, ticket: desk?.ticketNumber ?? null })
  } catch (err) {
    console.error('[mobile/services/discussion]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
