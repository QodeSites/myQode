// POST /api/mobile/engagement/referral
// Submit an investor referral. The referred person becomes a Zoho CRM Lead (Lead Source "Investor Referral", its
// Referring Investor = the logged-in client's Investor record; lib/zohoLeads.ts, 14 Oct 2026). Only the Lead: no Desk
// ticket and no email of ours (decided 14 Oct 2026) — the referral is recorded for Past Requests, where it shows the
// Lead's status. If Zoho refuses the Lead, the referral is not lost: it goes to IR by email as before, with an
// acknowledgement to the client.
import { internalMailHeaders } from '@/lib/webSession'
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { sendClientAck, clientName } from '@/lib/mobileAckMail'
import { upsertReferralLead, type ReferralLeadResult } from '@/lib/zohoLeads'
import { query } from '@/lib/db'
import { requestChannel, submittedVia, internalBase } from '@/lib/requestChannel'
import { irRecipient, irSubject } from '@/lib/mobileIrMail'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  // App Store / Play Store reviewer (mock accounts): the form works, but nothing reaches Investor Relations.
  if (user!.isReviewer) return NextResponse.json({ success: true, inquiry_id: 'REVIEW-' + Date.now().toString().slice(-6) })

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
    // "+CC number" from the app's country picker (older builds send bare digits: treated as Indian).
    const intl = String(phone).trim().match(/^\+(\d{1,4})\s*(\d+)$/)
    const cc = intl ? intl[1] : '91'
    const mobile = intl ? intl[2] : String(phone).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')
    if (String(name).trim().replace(/[^A-Za-z]/g, '').length < 2 || String(name).length > 80) return NextResponse.json({ error: 'Please enter the referred person’s full name.' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim())) return NextResponse.json({ error: 'That email address doesn’t look right.' }, { status: 400 })
    if (cc === '91' ? !/^[6-9]\d{9}$/.test(mobile) : !/^\d{6,15}$/.test(mobile)) {
      return NextResponse.json({ error: cc === '91' ? 'Enter a valid 10-digit Indian mobile number.' : 'Enter a valid mobile number (6 to 15 digits).' }, { status: 400 })
    }
    if (description && String(description).length > 500) return NextResponse.json({ error: 'Please keep the note under 500 characters.' }, { status: 400 })

    const channel = requestChannel(request)   // Web / App (lib/requestChannel.ts)

    // Zoho CRM Lead for the referred person, linked to the client who referred them (Referring Investor). The
    // account's holder name picks the right Investor record when one email covers a family.
    let lead: ReferralLeadResult | null = null
    try {
      const holder = (await query(`SELECT clientname FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`, [accountId])).rows[0]?.clientname || null
      lead = await upsertReferralLead({
        name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), note: description || null, channel,
        referrer: { email: user!.email, accountId, holderName: holder },
      })
    } catch (e: any) {
      console.error('[mobile/engagement/referral] lead not created for', accountId, '-', e?.message)
    }

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Investor Referral</h1>
        </div>
        <div style="background:#fff;padding:20px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Request Type:</strong> Referral Submission</p>
          <p><strong>Submitted via:</strong> ${submittedVia(channel)}</p>
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

    const emailRes = await fetch(`${internalBase()}/api/send-email`, {
      method: 'POST',
      headers: internalMailHeaders(user?.email),
      body: JSON.stringify({
        to: irRecipient(),   // investor.relations@ — or MOBILE_IR_EMAIL_OVERRIDE while testing
        subject: irSubject(`New Investor Referral from ${accountId}`),
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'investor_referral',
        record_only: !!lead,   // with a Lead: recorded only, no email (the Lead is the hand-off to the team)
        channel,               // Web / App, for the request tracking list
        nuvama_code: accountId,
        client_id: user!.clientId,
        user_email: user!.email,
        priority: 'normal',
        referred_investor_name: name,
        referred_investor_email: email,
        referred_investor_phone: phone,
        description: description || '',
        zoho_lead_id: lead?.id ?? null,           // the referred person's Lead in Zoho CRM
        zoho_lead_status: lead?.status ?? 'failed',
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) {
      throw new Error(emailData.error || 'Email send failed')
    }

    // Acknowledgement to the investor — only on the fallback path, when the Lead could not be created.
    if (!lead) await sendClientAck({
      to: user!.email, name: await clientName(user!.email), reference: emailData.inquiry_id,
      subject: 'We’ve received your referral', title: 'Referral received',
      intro: `Thank you for referring ${String(name).trim()} to Qode. We’ve received the details below from the myQode app.`,
      details: [['Referred investor', name], ['Email', email], ['Mobile', phone], ['Note', description], ['Your account', accountId]],
      next: 'Our Investor Relations team will reach out to them and keep you posted. You do not need to send this again.',
    })
    return NextResponse.json({ success: true, inquiry_id: emailData.inquiry_id, lead: lead?.status ?? null })
  } catch (err) {
    console.error('[mobile/engagement/referral]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
