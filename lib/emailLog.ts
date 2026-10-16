// email_log: every email the portal sends (web and app), written by lib/graphEmail.ts after each Graph sendMail and
// read by the backoffice (GET /api/admin/bo/emails, /admin/emails). Main DB; the table is created on first use, like
// lib/clientFeedback.ts.
//
// Never stored: one-time codes and sign-in links. An email whose subject is about a verification code or a password
// reset keeps its subject and recipients but no body, and in every other body the query string of any link that carries
// a token / code / signature is removed (setup and invite links). Attachments are kept as names and sizes only.
//
// recipient_type is fixed when the email is sent, from pms_clients_master: 'investor' when a recipient is an
// investor (a row with a client code), 'distributor' when one is a partner (a row without one), else 'internal'
// (Qode's own mailboxes: the IR copies of app requests, partner-invoice mails to accounts, …).
import { query } from '@/lib/db'

let ready: Promise<unknown> | null = null
export function ensureEmailLogTable() {
  if (!ready) {
    ready = query(`
      CREATE TABLE IF NOT EXISTS email_log (
        id bigserial PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        to_addrs text[] NOT NULL DEFAULT '{}',
        cc_addrs text[] NOT NULL DEFAULT '{}',
        bcc_addrs text[] NOT NULL DEFAULT '{}',
        from_name text,
        subject text,
        body_html text,
        body_withheld boolean NOT NULL DEFAULT false,
        attachments jsonb,
        status text NOT NULL,
        error text,
        graph_request_id text,
        recipient_type text,
        recipient_name text,
        client_codes text[]
      );
      CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC);
      CREATE INDEX IF NOT EXISTS email_log_to_idx ON email_log USING gin (to_addrs);
    `).catch(e => { ready = null; throw e })
  }
  return ready
}

/** Subjects of emails that carry a one-time code or a password link: their body is never stored. */
const SECRET_SUBJECT = /verification code|one[- ]?time|passcode|\botp\b|reset (your )?password|sign[- ]?in code|login code/i
/** Query-string keys that make a link a credential (setup / reset / magic links, signed URLs). */
const SECRET_PARAM = /[?&](token|code|otp|key|sig|signature|auth|session|reset|t)=/i

/** The body as stored: every link whose query string carries a credential loses that query string. */
export function redactBody(html: string): string {
  return html.replace(/https?:\/\/[^\s"'<>]+/g, url => (SECRET_PARAM.test(url) ? url.split('?')[0] + '?[removed]' : url))
}

const addrs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map(a => a.trim().toLowerCase())

export interface EmailLogEntry {
  to: unknown
  cc?: unknown
  bcc?: unknown
  fromName?: string
  subject: string
  html: string
  attachments?: Array<{ name: string; content: string | Buffer }>
  /** Force the body not to be stored (the subject rule above catches the usual cases). */
  sensitive?: boolean
  ok: boolean
  error?: string | null
  requestId?: string | null
}

/** Record one send. Never throws: logging must not change whether or how an email goes out. */
export async function logEmail(e: EmailLogEntry): Promise<void> {
  try {
    await ensureEmailLogTable()
    const to = addrs(e.to), cc = addrs(e.cc), bcc = addrs(e.bcc)
    const withheld = !!e.sensitive || SECRET_SUBJECT.test(e.subject || '')
    const who = await query<{ clientcode: string | null; clientname: string | null; person: string | null }>(
      `SELECT clientcode, clientname,
              NULLIF(trim(concat_ws(' ', salutation, firstname, middlename, lastname)), '') AS person
         FROM pms_clients_master WHERE lower(trim(email)) = ANY($1::text[])
        ORDER BY clientcode IS NULL, head_of_family DESC NULLS LAST, clientcode`, [[...to, ...cc]])
    const rows = who.rows
    const investor = rows.find(r => r.clientcode)
    const partner = rows.find(r => !r.clientcode)
    const type = investor ? 'investor' : partner ? 'distributor' : 'internal'
    const name = investor ? investor.person || investor.clientname : partner ? partner.clientname || partner.person : null
    const codes = [...new Set(rows.map(r => r.clientcode).filter((c): c is string => !!c))]
    await query(
      `INSERT INTO email_log (to_addrs, cc_addrs, bcc_addrs, from_name, subject, body_html, body_withheld, attachments,
                              status, error, graph_request_id, recipient_type, recipient_name, client_codes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [to, cc, bcc, e.fromName || null, e.subject || '', withheld ? null : redactBody(e.html || ''), withheld,
       e.attachments?.length ? JSON.stringify(e.attachments.map(a => ({ name: a.name, size: Buffer.byteLength(a.content) }))) : null,
       e.ok ? 'sent' : 'failed', e.error ? String(e.error).slice(0, 1000) : null, e.requestId || null,
       type, name, codes])
  } catch (err: any) {
    console.warn('[emailLog] not recorded:', err?.message)
  }
}
