// Investor Relations email for the mobile API: one place that decides WHO receives the IR notifications
// (withdrawal, switch, strategy question, discussion, account request, payment completed, SIP set up).
//
// Production: investor.relations@qodeinvest.com — the same inbox the web's account-services page uses.
// Testing:    MOBILE_IR_EMAIL_OVERRIDE=<address>[,<address>…] in .env sends every one of them there instead, with the
//             subject prefixed so it is obviously a test. Remove the variable in production.
export const IR_EMAIL = 'investor.relations@qodeinvest.com'

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
          <p><strong>Client ID:</strong> ${p.clientId ?? '—'}</p>
          <p><strong>User Email:</strong> ${p.userEmail ?? '—'}</p>
          <p><strong>Amount:</strong> ${inr}${p.kind === 'sip' && p.frequency ? ' · ' + p.frequency : ''}</p>
          ${p.method ? `<p><strong>Method:</strong> ${p.method}</p>` : ''}
          <p><strong>Razorpay reference:</strong> ${p.reference}</p>
          <p><strong>Status:</strong> ${p.kind === 'sip' ? 'Mandate authorised — instalments will be debited on schedule' : 'Captured by the payment gateway'}</p>
        </div>
      </div>
    </div>`
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      }),
    })
    if (!res.ok) console.warn('[mobileIrMail] send-email answered', res.status)
  } catch (err) {
    console.warn('[mobileIrMail] failed:', (err as any)?.message)
  }
}
