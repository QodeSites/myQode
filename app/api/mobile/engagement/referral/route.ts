// POST /api/mobile/engagement/referral
// Submit an investor referral. Sends notification email to IR team.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { irRecipient, irSubject } from '@/lib/mobileIrMail'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const body = await request.json()
    const { accountId, name, email, phone, description } = body

    if (!name || !email || !phone || !accountId) {
      return NextResponse.json(
        { error: 'Fields required: accountId, name, email, phone' },
        { status: 400 }
      )
    }

    if (!user!.accountCodes?.includes(accountId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Same rules as the app (src/validate.js): a real name, a valid email, a 10-digit Indian mobile.
    const mobile = String(phone).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')
    if (String(name).trim().replace(/[^A-Za-z]/g, '').length < 2 || String(name).length > 80) return NextResponse.json({ error: 'Please enter the referred person’s full name.' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim())) return NextResponse.json({ error: 'That email address doesn’t look right.' }, { status: 400 })
    if (!/^[6-9]\d{9}$/.test(mobile)) return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number.' }, { status: 400 })
    if (description && String(description).length > 500) return NextResponse.json({ error: 'Please keep the note under 500 characters.' }, { status: 400 })

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Investor Referral</h1>
        </div>
        <div style="background:#fff;padding:20px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Request Type:</strong> Referral Submission</p>
          <p><strong>Submitted via:</strong> myQode Mobile App</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div style="background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0">
            <h3 style="margin-top:0;color:#37584F">Referral Details</h3>
            <p><strong>Account ID:</strong> ${accountId}</p>
            <p><strong>Referring User Email:</strong> ${user!.email}</p>
            <p><strong>Referred Investor Name:</strong> ${name}</p>
            <p><strong>Referred Investor Email:</strong> ${email}</p>
            <p><strong>Referred Investor Phone:</strong> ${phone}</p>
            ${description ? `<p><strong>Description:</strong> ${description}</p>` : ''}
          </div>
        </div>
      </div>`

    const emailRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: irRecipient(),   // investor.relations@ — or MOBILE_IR_EMAIL_OVERRIDE while testing
        subject: irSubject(`New Investor Referral from ${accountId}`),
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'investor_referral',
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        referred_investor_name: name,
        referred_investor_email: email,
        referred_investor_phone: phone,
        description: description || '',
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) {
      throw new Error(emailData.error || 'Email send failed')
    }

    return NextResponse.json({ success: true, inquiry_id: emailData.inquiry_id })
  } catch (err) {
    console.error('[mobile/engagement/referral]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
