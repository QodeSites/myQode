// POST /api/mobile/services/strategy-inquiry
// Submit a strategy question to the fund manager team.
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
    const { accountId, question } = body

    if (!accountId || !question?.trim()) {
      return NextResponse.json(
        { error: 'Fields required: accountId, question' },
        { status: 400 }
      )
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (String(question).trim().length > 2000) return NextResponse.json({ error: 'Please keep it under 2000 characters.' }, { status: 400 })

    const channel = requestChannel(request)   // Web / App (lib/requestChannel.ts)

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Strategy Inquiry</h1>
        </div>
        <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Submitted via:</strong> ${submittedVia(channel)}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
            <p><strong>Account ID:</strong> ${accountId}</p>
            <p><strong>Investor ID:</strong> ${user!.clientId}</p>
            <p><strong>Email:</strong> ${user!.email}</p>
            <p><strong>Question:</strong></p>
            <p>${String(question).replace(/\n/g, '<br/>')}</p>
          </div>
        </div>
      </div>`

    // Zoho Desk ticket (lib/zohoDesk.ts); null when Desk is not set up here or refused — the request carries on by email.
    const desk = await raiseDeskTicket({
      channel,
      kind: 'strategy', subject: `Strategy question from ${accountId}`, email: user!.email, name: await clientName(user!.email), accountId,
      fields: [['Investor ID', user!.clientId], ['Question', String(question).trim()]],
    })

    const emailRes = await fetch(`${internalBase()}/api/send-email`, {
      method: 'POST',
      headers: internalMailHeaders(user?.email),
      body: JSON.stringify({
        to: irRecipient(),   // investor.relations@ — or MOBILE_IR_EMAIL_OVERRIDE while testing (lib/mobileIrMail.ts)
        subject: irSubject(`Strategy Question from ${accountId}`),
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'strategy',
        desk_ticket: desk?.ticketNumber ?? null,
        desk_ticket_id: desk?.id ?? null,
        record_only: !!desk,   // Desk notifies the team and the client; the row is kept for tracking
        channel,               // Web / App, for the request tracking list
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        question: question.trim(),
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) throw new Error(emailData.error || 'Email send failed')

    // Acknowledgement to the investor — ours only when there is no Desk ticket (Desk sends its own on creation).
    if (!desk) await sendClientAck({
      to: user!.email, name: await clientName(user!.email), reference: emailData.inquiry_id,
      subject: 'We’ve received your question', title: 'Question received',
      intro: 'We’ve received your question for the investment team, raised from the myQode app.',
      details: [['Account', accountId], ['Your question', question]],
    })
    return NextResponse.json({ success: true, inquiry_id: emailData.inquiry_id, ticket: desk?.ticketNumber ?? null })
  } catch (err) {
    console.error('[mobile/services/strategy-inquiry]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
