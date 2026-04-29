// POST /api/mobile/services/strategy-inquiry
// Submit a strategy question to the fund manager team.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

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

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Strategy Inquiry</h1>
        </div>
        <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Submitted via:</strong> myQode Mobile App</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
            <p><strong>Account ID:</strong> ${accountId}</p>
            <p><strong>Client ID:</strong> ${user!.clientId}</p>
            <p><strong>Email:</strong> ${user!.email}</p>
            <p><strong>Question:</strong></p>
            <p>${String(question).replace(/\n/g, '<br/>')}</p>
          </div>
        </div>
      </div>`

    const emailRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'investor.relations@qodeinvest.com',
        subject: `Strategy Question from ${accountId}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'strategy',
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        question: question.trim(),
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) throw new Error(emailData.error || 'Email send failed')

    return NextResponse.json({ success: true, inquiry_id: emailData.inquiry_id })
  } catch (err) {
    console.error('[mobile/services/strategy-inquiry]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
