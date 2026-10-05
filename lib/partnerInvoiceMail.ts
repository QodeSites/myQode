// Emails sent when a partner raises an invoice in the portal (app/api/distributor/invoice-issue):
//
//   1. partnerships@qodeinvest.com: the invoice — key figures, the partner's details, the invoice itself inline and as
//      an attached file (the same document the partner downloads as a PDF). Reply-to is the partner.
//   2. the partner: "we've received your invoice", with the figures echoed back (lib/mobileAckMail).
//
// Who receives them:
//   PARTNER_INVOICE_EMAIL_OVERRIDE / MOBILE_AUTH_EMAIL_OVERRIDE set   the testers (subject names the intended one)
//   production, no override                                           partnerships@ and the partner
//   any other server                                                  nothing (logged)
// Failures are logged, never surfaced: the invoice is already recorded.
import { graphMailer, isGraphEmailConfigured } from '@/lib/graphEmail'
import { sendClientAck } from '@/lib/mobileAckMail'

const IS_PROD = process.env.NODE_ENV === 'production'
const PARTNERSHIPS_EMAIL = 'partnerships@qodeinvest.com'
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type IssuedInvoice = {
  partnerEmail: string
  invoiceNumber: string
  invoiceDate: string
  periodLabel: string
  amountBeforeTax: number
  taxAmount: number
  totalAmount: number
  html?: string | null              // the invoice document the portal built (optional: the app may not send it)
}
type Profile = { legal_name?: string; gstin?: string; pan?: string; bank_name?: string; bank_account_number?: string; bank_ifsc?: string } | null

// The invoice document comes from the partner's browser: keep its markup, drop anything active.
function cleanDoc(html: string): string {
  return html
    .slice(0, 1_500_000)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|form|base|meta[^>]*http-equiv)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
}
const body = (doc: string) => (doc.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? doc)

function internalRecipients(): { to: string[]; prefix: string } | null {
  const override = (process.env.PARTNER_INVOICE_EMAIL_OVERRIDE || process.env.MOBILE_AUTH_EMAIL_OVERRIDE || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (override.length) return { to: override, prefix: `[TEST · for ${PARTNERSHIPS_EMAIL}] ` }
  if (IS_PROD) return { to: [PARTNERSHIPS_EMAIL], prefix: '' }
  return null
}

export async function sendPartnerInvoiceMails(inv: IssuedInvoice, profile: Profile, partnerName: string | null): Promise<void> {
  const who = profile?.legal_name || partnerName || inv.partnerEmail
  const rows: Array<[string, unknown]> = [
    ['Partner', who], ['Partner email', inv.partnerEmail], ['GSTIN', profile?.gstin], ['PAN', profile?.pan],
    ['Invoice no.', inv.invoiceNumber], ['Invoice date', inv.invoiceDate], ['Period', inv.periodLabel],
    ['Amount before tax', inr(inv.amountBeforeTax)], ['GST', inr(inv.taxAmount)], ['Total payable', inr(inv.totalAmount)],
    ['Bank', [profile?.bank_name, profile?.bank_account_number, profile?.bank_ifsc].filter(Boolean).join(' · ')],
  ]
  const doc = inv.html ? cleanDoc(inv.html) : ''

  // 1. partnerships@
  try {
    const plan = internalRecipients()
    if (!plan) console.log(`[partner-invoice] not sent (dev server): invoice ${inv.invoiceNumber} from ${inv.partnerEmail}`)
    else if (!isGraphEmailConfigured()) console.log(`[partner-invoice] mail not configured — would send invoice ${inv.invoiceNumber}`)
    else {
      const table = rows.filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')
      const html = `<div style="font-family:Arial,sans-serif;max-width:720px">
        <p>A partner has raised an invoice in the myQode partner portal.</p>
        <table style="border-collapse:collapse;font-size:14px">${table}</table>
        <p style="color:#555;font-size:13px">Check the total against the partner's fee statement for ${esc(inv.periodLabel)} before paying. Reply to this email to reach the partner.</p>
        ${doc ? `<hr style="margin:20px 0"/><div>${body(doc)}</div>` : '<p style="color:#555;font-size:13px">The invoice document was not attached (raised from the app); the partner has the PDF.</p>'}
      </div>`
      const file = `Invoice ${inv.invoiceNumber} - ${who}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.html'
      const res = await graphMailer.emails.send({
        from: `myQode Partner Portal <${PARTNERSHIPS_EMAIL}>`, to: plan.to, replyTo: inv.partnerEmail,
        subject: `${plan.prefix}Invoice ${inv.invoiceNumber} from ${who} · ${inv.periodLabel} · ${inr(inv.totalAmount)}`,
        html, ...(doc ? { attachments: [{ name: file, contentType: 'text/html', content: doc }] } : {}),
      })
      if (res?.error) console.warn('[partner-invoice] partnerships mail failed:', res.error.message)
    }
  } catch (err) { console.warn('[partner-invoice] partnerships mail failed:', (err as any)?.message) }

  // 2. the partner
  await sendClientAck({
    to: inv.partnerEmail, name: who, from: 'partnerships',
    subject: `We’ve received your invoice ${inv.invoiceNumber}`, title: 'Invoice received',
    intro: `We’ve received invoice ${inv.invoiceNumber} for ${inv.periodLabel}, raised from the myQode partner portal.`,
    details: [['Invoice no.', inv.invoiceNumber], ['Invoice date', inv.invoiceDate], ['Period', inv.periodLabel],
      ['Amount before tax', inr(inv.amountBeforeTax)], ['GST', inr(inv.taxAmount)], ['Total', inr(inv.totalAmount)]],
    next: 'Our partnerships team will review it against your fee statement and process the payment. If anything needs correcting, we’ll write to you. You don’t need to send the invoice again.',
  })
}
