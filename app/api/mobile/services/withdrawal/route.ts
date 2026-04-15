// POST /api/mobile/services/withdrawal
// Submit a withdrawal request. Sends notification email.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const body = await request.json()
    const { accountId, additionalNotes } = body
    const amount = body.amount !== undefined ? parseFloat(String(body.amount)) : NaN

    if (!accountId || !body.amount) {
      return NextResponse.json(
        { error: 'Fields required: accountId, amount' },
        { status: 400 }
      )
    }

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 }
      )
    }

    // Guard against absurdly large withdrawal requests (server-side sanity check)
    const MAX_WITHDRAWAL = 100_000_000 // ₹10 Cr
    if (amount > MAX_WITHDRAWAL) {
      return NextResponse.json(
        { error: `amount exceeds maximum allowed (₹${MAX_WITHDRAWAL.toLocaleString('en-IN')})` },
        { status: 400 }
      )
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Withdrawal Request</h1>
        </div>
        <div style="background:#fff;padding:20px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Request Type:</strong> Withdrawal</p>
          <p><strong>Submitted via:</strong> myQode Mobile App</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div style="background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0">
            <h3 style="margin-top:0;color:#37584F">Request Details</h3>
            <p><strong>Account ID:</strong> ${accountId}</p>
            <p><strong>User Email:</strong> ${user!.email}</p>
            <p><strong>Amount:</strong> ₹${amount}</p>
            ${additionalNotes ? `<p><strong>Additional Notes:</strong> ${String(additionalNotes).replace(/\n/g, '<br>')}</p>` : ''}
          </div>
        </div>
      </div>`

    const emailRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'sanket.shinde@qodeinvest.com',
        subject: `New Withdrawal Request from ${accountId}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'withdrawal',
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        inquirySpecificData: {
          amount,
          additional_notes: additionalNotes || '',
        },
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) {
      throw new Error(emailData.error || 'Email send failed')
    }

    return NextResponse.json({ success: true, inquiry_id: emailData.inquiry_id })
  } catch (err) {
    console.error('[mobile/services/withdrawal]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
