import { signWebSession, WEB_SESSION_COOKIE } from '@/lib/webSession'
// Investor Relations email for the mobile API: one place that decides WHO receives the IR notifications
// (withdrawal, switch, strategy question, discussion, account request, payment completed, SIP set up).
//
// Production: investor.relations@qodeinvest.com — the same inbox the web's account-services page uses.
// Testing:    MOBILE_IR_EMAIL_OVERRIDE=<address>[,<address>…] in .env sends every one of them there instead, with the
//             subject prefixed so it is obviously a test. Remove the variable in production.
export const IR_EMAIL = 'investor.relations@qodeinvest.com'
import { raiseDeskTicket } from '@/lib/zohoDesk'
import { fetchRazorpayOrder, fetchRazorpaySubscription } from '@/lib/razorpay'

// Web or App for a payment: stored as the channel note on the Razorpay order / subscription when it was created
// (create-order, setup-sip), so any of the routes that confirm a payment can tell. Older ones have none → null.
async function paymentChannel(kind: 'one_time' | 'sip', reference: string): Promise<'Web' | 'App' | null> {
  try {
    const o: any = kind === 'sip' ? await fetchRazorpaySubscription(reference) : await fetchRazorpayOrder(reference)
    const c = String(o?.notes?.channel || '')
    return c === 'Web' || c === 'App' ? c : null
  } catch { return null }
}

// The client behind a payment when the caller has no signed-in user (a Razorpay webhook): email and name from
// pms_clients_master by account code.
async function clientOfAccount(accountId: string): Promise<{ email: string | null; name: string | null }> {
  try {
    const { query } = await import('@/lib/db')
    const r = await query(
      `SELECT email, trim(concat_ws(' ', salutation, firstname, lastname)) AS name FROM pms_clients_master
        WHERE clientcode = $1 AND email IS NOT NULL ORDER BY head_of_family DESC NULLS LAST LIMIT 1`, [accountId])
    return { email: r.rows[0]?.email || null, name: r.rows[0]?.name || null }
  } catch { return { email: null, name: null } }
}

export function irRecipient(): string[] {
  const list = (process.env.MOBILE_IR_EMAIL_OVERRIDE || '').split(',').map((s) => s.trim()).filter(Boolean)
  return list.length ? list : [IR_EMAIL]
}

export function irSubject(subject: string): string {
  return (process.env.MOBILE_IR_EMAIL_OVERRIDE || '').trim() ? `[TEST · IR] ${subject}` : subject
}

// The web's "Payment Completed" email to IR (app/(protected)/experience/account-services/page.tsx sends it from
// the browser once Cashfree confirms). Mobile sends the same notification server-side when a Razorpay payment
// or SIP mandate is first confirmed — callers only invoke this on the PENDING → success transition, so a
// re-delivered webhook or a second verify never emails twice. Failures are logged, never surfaced to the client.
export async function notifyIrPayment(p: {
  kind: 'one_time' | 'sip'
  accountId: string
  clientId: string | null
  userEmail: string | null
  amount: number
  reference: string          // Razorpay order / subscription id
  frequency?: string | null
  method?: string | null
}) {
  const inr = '₹' + Number(p.amount || 0).toLocaleString('en-IN')
  const title = p.kind === 'sip' ? 'SIP Mandate Registered' : 'Payment Completed'
  const subject = irSubject(
    p.kind === 'sip'
      ? `SIP Set Up - ${inr} ${p.frequency ? String(p.frequency).toUpperCase() + ' ' : ''}| ${p.accountId} | myQode App`
      : `Payment Completed - ${inr} Investment | ${p.accountId} | myQode App`,
  )
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
      <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
        <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">${title}</h1>
      </div>
      <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
        <p><strong>Submitted via:</strong> myQode Mobile App (Razorpay)</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
          <p><strong>Account Code:</strong> ${p.accountId}</p>
          <p><strong>Investor ID:</strong> ${p.clientId ? String(p.clientId).replace(/\.0+$/, '') : '—'}</p>
          <p><strong>User Email:</strong> ${p.userEmail ?? '—'}</p>
          <p><strong>Amount:</strong> ${inr}${p.kind === 'sip' && p.frequency ? ' · ' + p.frequency : ''}</p>
          ${p.method ? `<p><strong>Method:</strong> ${p.method}</p>` : ''}
          <p><strong>Razorpay reference:</strong> ${p.reference}</p>
          <p><strong>Status:</strong> ${p.kind === 'sip' ? 'Mandate authorised — instalments will be debited on schedule' : 'Captured by the payment gateway'}</p>
        </div>
      </div>
    </div>`
  // Zoho Desk ticket for Add Funds (lib/zohoDesk.ts), the client as its contact; null when Desk is not set up here.
  const who = await clientOfAccount(p.accountId)
  const contact = p.userEmail || who.email
  const desk = contact ? await raiseDeskTicket({
    kind: p.kind === 'sip' ? 'sip' : 'add_funds',
    subject: p.kind === 'sip' ? `SIP set up, ${inr}${p.frequency ? ' ' + p.frequency : ''}, ${p.accountId}` : `Payment received, ${inr}, ${p.accountId}`,
    email: contact, name: who.name, accountId: p.accountId, priority: 'High', channel: await paymentChannel(p.kind, p.reference),
    fields: [['Investor ID', p.clientId ? String(p.clientId).replace(/\.0+$/, '') : null], ['Amount', inr], ['Frequency', p.kind === 'sip' ? p.frequency : null],
      ['Method', p.method], ['Razorpay reference', p.reference],
      ['Status', p.kind === 'sip' ? 'Mandate authorised; instalments will be debited on schedule' : 'Captured by the payment gateway']],
  }) : null
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST',
      // a signed session so /api/send-email accepts this server-side call (lib/webSession.ts)
      headers: { 'Content-Type': 'application/json', Cookie: `${WEB_SESSION_COOKIE}=${signWebSession([], { email: p.userEmail || IR_EMAIL })}` },
      body: JSON.stringify({
        to: irRecipient(),
        subject,
        html,
        from: IR_EMAIL,
        fromName: 'Qode Investor Relations',
        inquiry_type: p.kind === 'sip' ? 'sip_success' : 'payment_success',
        nuvama_code: p.accountId,
        client_id: p.clientId ?? '',
        user_email: p.userEmail || IR_EMAIL,
        priority: 'high',
        payment_amount: p.amount,
        investment_type: p.kind === 'sip' ? 'SIP' : 'One-time',
        transaction_id: p.reference,
        payment_status: 'success',
        gateway: 'razorpay',
        desk_ticket: desk?.ticketNumber ?? null,
      }),
    })
    if (!res.ok) console.warn('[mobileIrMail] send-email answered', res.status)
  } catch (err) {
    console.warn('[mobileIrMail] failed:', (err as any)?.message)
  }
}
