// Acknowledgement email to the person who raised a request from the app (investor or partner): "we received
// your <withdrawal / switch / referral / …>". Investor Relations gets its own notification exactly as before —
// this is the copy the client keeps.
//
// Who receives it:
//   MOBILE_AUTH_EMAIL_OVERRIDE set   the testers, in every environment (subject names the intended recipient)
//   production, no override           the client (the signed-in email)
//   any other server, no override     nothing is sent — a dev server never mails a real client
// Failures are logged, never surfaced: the request itself has already succeeded.
import { graphMailer, isGraphEmailConfigured } from '@/lib/graphEmail'

const IS_PROD = process.env.NODE_ENV === 'production'
const APP_URL = process.env.APP_URL ?? 'https://myqode.qodeinvest.com'
const IR_EMAIL = 'investor.relations@qodeinvest.com'
const PARTNERSHIPS_EMAIL = 'partnerships@qodeinvest.com'

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type AckMail = {
  to: string                        // the client's email
  name?: string | null              // greeting name ("Dear Rekha") — falls back to "Dear Investor" / "Dear Partner"
  subject: string                   // e.g. "We've received your withdrawal request"
  title: string                     // heading in the email
  intro: string                     // one sentence: what was received
  details?: Array<[string, unknown]> // the request, echoed back (label, value) — empty values are skipped
  reference?: string | null         // inquiry id, when there is one
  next?: string                     // what happens next (default: IR will be in touch)
  from?: 'ir' | 'partnerships'      // signature block; default IR
}

// The override wins in EVERY environment (as lib/authMailRedirect and lib/mobileIrMail do), so a test machine that
// happens to run in production mode still never mails a real client while the override is set.
function recipients(clientEmail: string): { to: string[]; prefix: string } | null {
  const override = (process.env.MOBILE_AUTH_EMAIL_OVERRIDE || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (override.length) return { to: override, prefix: `[TEST · for ${clientEmail}] ` }
  if (IS_PROD) return { to: [clientEmail], prefix: '' }
  return null
}

export function ackHtml(m: AckMail): string {
  const rows = (m.details || []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  const who = m.from === 'partnerships' ? 'Qode Partnerships' : 'Qode Investor Relations'
  const addr = m.from === 'partnerships' ? PARTNERSHIPS_EMAIL : IR_EMAIL
  const greet = m.name && String(m.name).trim() ? `Dear ${esc(String(m.name).trim())},` : m.from === 'partnerships' ? 'Dear Partner,' : 'Dear Investor,'
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3;color:#002017">
      <div style="background:#02422B;padding:18px;border-radius:8px;margin-bottom:16px;text-align:center">
        <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif;font-size:22px">${esc(m.title)}</h1>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #37584F;border-radius:8px;line-height:1.6">
        <p style="margin:0 0 12px">${greet}</p>
        <p style="margin:0 0 12px">${esc(m.intro)}</p>
        ${rows.length ? `<div style="background:#EFECD3;padding:12px 14px;border-left:4px solid #DABD38;margin:14px 0">
          ${rows.map(([k, v]) => `<p style="margin:4px 0"><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join('')}
        </div>` : ''}
        <p style="margin:0 0 12px">${esc(m.next || `Our ${who.replace('Qode ', '')} team will review it and get back to you shortly. You do not need to send it again.`)}</p>
        ${m.reference ? `<p style="margin:0 0 12px;color:#37584F;font-size:13px">Reference: ${esc(m.reference)}</p>` : ''}
        <p style="margin:0;color:#37584F;font-size:13px">If you did not make this request, please write to <a href="mailto:${addr}" style="color:#02422B">${addr}</a> straight away.</p>
      </div>
      <div style="margin-top:18px;font-size:13px;color:#37584F">
        <p style="margin:0 0 4px">Best regards,</p>
        <p style="margin:0 0 4px;color:#02422B;font-weight:bold;font-size:15px">${who}</p>
        <p style="margin:0"><a href="mailto:${addr}" style="color:#02422B;text-decoration:none">${addr}</a></p>
        <p style="margin:10px 0 0"><img src="${APP_URL}/signature/image.png" alt="Qode" style="height:120px"></p>
      </div>
    </div>`
}

/** Sends the acknowledgement (or, on a test server, redirects / skips it). Never throws. */
export async function sendClientAck(m: AckMail): Promise<void> {
  try {
    const plan = recipients(m.to)
    if (!plan) { console.log(`[ack] not sent (dev server, no MOBILE_AUTH_EMAIL_OVERRIDE): "${m.subject}" → ${m.to}`); return }
    if (!isGraphEmailConfigured()) { console.log(`[ack] mail not configured — would send "${m.subject}" to ${plan.to.join(',')}`); return }
    const from = m.from === 'partnerships' ? `Qode Partnerships <${PARTNERSHIPS_EMAIL}>` : `Qode Investor Relations <${IR_EMAIL}>`
    const res = await graphMailer.emails.send({ from, to: plan.to, subject: plan.prefix + m.subject, html: ackHtml(m) })
    if (res?.error) console.warn('[ack] send failed:', res.error.message)
  } catch (err) {
    console.warn('[ack] failed:', (err as any)?.message)
  }
}

// The client's name for the greeting — from the portal row on that email (the JWT carries no name). Best effort.
export async function clientName(email: string): Promise<string | null> {
  try {
    const { query } = await import('@/lib/db')
    const r = await query(
      `SELECT salutation, firstname, lastname FROM pms_clients_master WHERE lower(email) = $1 ORDER BY head_of_family DESC NULLS LAST LIMIT 1`,
      [String(email || '').trim().toLowerCase()],
    )
    const row = r.rows[0]
    if (!row) return null
    return [row.salutation, row.firstname, row.lastname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null
  } catch { return null }
}
