// POST /api/mobile/documents/request — "Request document" from the app's Documents tab (app addition: the web's
// document vault only lists what is there). Emails Investor Relations the same way the account-services requests
// do (send-email, inquiry_type 'raised_request', so it appears in the admin queries console) and sends the
// investor an acknowledgement.
// Body: { accountId, category: 'pms-agreement' | 'account-opening' | 'cml' | 'other', message? }
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { irRecipient, irSubject, IR_EMAIL } from '@/lib/mobileIrMail'
import { sendClientAck, clientName } from '@/lib/mobileAckMail'

const CATEGORIES: Record<string, string> = {
  'pms-agreement': 'PMS Agreement',
  'account-opening': 'Account Opening Documents',
  'cml': 'CML',
  'other': 'Other document',
}
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const accountId = String(body?.accountId || '').trim()
  const category = String(body?.category || '').trim()
  const message = String(body?.message || '').trim()
  if (!accountId || !CATEGORIES[category]) return NextResponse.json({ error: 'Fields required: accountId, category' }, { status: 400 })
  if (!user!.accountCodes?.includes(accountId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (category === 'other' && message.length < 5) return NextResponse.json({ error: 'Tell us which document you need.' }, { status: 400 })
  if (message.length > 1000) return NextResponse.json({ error: 'Please keep the note under 1000 characters.' }, { status: 400 })
  const label = CATEGORIES[category]

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
      <div style="background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center">
        <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Document Request</h1>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #37584F;border-radius:8px">
        <p><strong>Request Type:</strong> Document Request</p>
        <p><strong>Submitted via:</strong> myQode Mobile App</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        <div style="background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0">
          <p><strong>Account Code:</strong> ${esc(accountId)}</p>
          <p><strong>Client ID:</strong> ${esc(user!.clientId || '—')}</p>
          <p><strong>User Email:</strong> ${esc(user!.email)}</p>
          <p><strong>Document:</strong> ${esc(label)}</p>
          ${message ? `<p><strong>Note:</strong> ${esc(message).replace(/\n/g, '<br/>')}</p>` : ''}
        </div>
        <p style="color:#37584F;font-size:13px">The investor's Documents tab shows no file in this section for this account. Please upload it to the client's S3 folder or reply to the investor directly.</p>
      </div>
    </div>`
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: irRecipient(), subject: irSubject(`Document Request — ${label} — ${accountId}`), html,
        from: IR_EMAIL, fromName: 'Qode Investor Relations', inquiry_type: 'raised_request',
        nuvama_code: accountId, client_id: user!.clientId || '', user_email: user!.email, priority: 'normal',
        request_kind: 'document', document_category: category, document_label: label, message,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Email send failed')
    await sendClientAck({
      to: user!.email, name: await clientName(user!.email), reference: data.inquiry_id,
      subject: 'We’ve received your document request', title: 'Document request received',
      intro: 'We’ve received your request from the myQode app.',
      details: [['Account', accountId], ['Document', label], ['Note', message]],
      next: 'Our Investor Relations team will share the document with you, or let you know if it is still being prepared. You do not need to send this again.',
    })
    return NextResponse.json({ success: true, inquiry_id: data.inquiry_id })
  } catch (err) {
    console.error('[mobile/documents/request]', err)
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 502 })
  }
}
