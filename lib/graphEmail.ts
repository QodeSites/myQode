/**
 * lib/graphEmail.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Microsoft Graph email sender — drop-in replacement for Resend.
 *
 * Uses the OAuth2 client-credentials flow against the "Qode Email Sender"
 * Azure AD app registration and POSTs to the Graph `sendMail` endpoint.
 *
 * The public surface intentionally mirrors Resend so call sites can keep using
 * `mailer.emails.send({ from, to, subject, html, cc })`:
 *   - `sendGraphEmail(payload)` → low-level function
 *   - `graphMailer.emails.send(payload)` → Resend-compatible shim
 *
 * All mail is sent FROM the mailbox configured in MS_GRAPH_EMAIL_FROM (the
 * mailbox the app registration is authorised for). Any display name passed in
 * the call-site `from` (e.g. "Qode Advisors <noreply@…>") is preserved; the
 * underlying address is normalised to MS_GRAPH_EMAIL_FROM.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TENANT_ID = process.env.MS_GRAPH_EMAIL_TENANT_ID
const CLIENT_ID = process.env.MS_GRAPH_EMAIL_CLIENT_ID
const CLIENT_SECRET = process.env.MS_GRAPH_EMAIL_CLIENT_SECRET
const SENDER_MAILBOX =
  process.env.MS_GRAPH_EMAIL_FROM || 'investor.relations@qodeinvest.com'

type AddressInput = string | string[] | undefined | null

export interface SendEmailPayload {
  /** "Display Name <addr@x.com>" or "addr@x.com". Only the display name is used. */
  from?: string
  to: AddressInput
  cc?: AddressInput
  bcc?: AddressInput
  replyTo?: AddressInput
  subject: string
  html: string
  text?: string
}

export interface SendEmailResult {
  data: { id: string } | null
  error: { message: string; name?: string } | null
}

/** Whether the Microsoft Graph email credentials are configured. */
export function isGraphEmailConfigured(): boolean {
  return Boolean(TENANT_ID && CLIENT_ID && CLIENT_SECRET)
}

// ── Token cache ───────────────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  // Reuse the cached token until 60s before expiry.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  )

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Graph token request failed: ${res.status} ${detail}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  return cachedToken.token
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDisplayName(from?: string): string | undefined {
  if (!from) return undefined
  const m = from.match(/^\s*(.*?)\s*<[^>]+>\s*$/)
  const name = m?.[1]?.trim()
  return name || undefined
}

function toRecipients(value: AddressInput): Array<{ emailAddress: { address: string } }> {
  if (!value) return []
  const arr = Array.isArray(value) ? value : [value]
  return arr
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map((address) => ({ emailAddress: { address: address.trim() } }))
}

// ── Environment-based recipient routing ──────────────────────────────────────
//
// Outside production, ALL mail is diverted to a single inbox. This is not a
// convenience — it is what stops a developer testing the payment flow from
// emailing a real investor about a payment that never happened.
//
// The redirect is applied here, at the single point every send passes through,
// rather than at ~15 individual call sites: a call site added later is covered
// automatically, and there is exactly one place to audit.

/** Where all non-production mail is diverted. */
const DEV_REDIRECT_TO = process.env.DEV_EMAIL_REDIRECT_TO || 'tech@qodeinvest.com'

/** Default internal recipient in production. */
const PROD_INTERNAL_TO =
  process.env.INTERNAL_EMAIL_TO || 'investor.relations@qodeinvest.com'

/**
 * True only in a real production deployment.
 *
 * Defaults to non-production when NODE_ENV is unset, so an environment we
 * cannot positively identify diverts mail rather than sending it to clients.
 * Failing safe matters more here than convenience.
 */
export function isProductionEmail(): boolean {
  if (process.env.EMAIL_ENVIRONMENT) {
    return process.env.EMAIL_ENVIRONMENT.toLowerCase() === 'production'
  }
  return process.env.NODE_ENV === 'production'
}

/** The internal team address for the current environment. */
export function internalRecipient(): string {
  return isProductionEmail() ? PROD_INTERNAL_TO : DEV_REDIRECT_TO
}

function flatten(value: AddressInput): string[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value])
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map((a) => a.trim())
}

/**
 * Applies the environment routing rule to a payload.
 *
 * In production the payload is returned untouched. Outside production every
 * recipient is replaced with the redirect inbox, cc/bcc are dropped entirely
 * (so a stray cc cannot reach a client), and the subject is prefixed with the
 * original recipients so the diverted mail is still intelligible.
 */
function applyEnvironmentRouting(payload: SendEmailPayload): SendEmailPayload {
  if (isProductionEmail()) return payload

  const originalTo = flatten(payload.to)
  const originalCc = flatten(payload.cc)
  const originalBcc = flatten(payload.bcc)
  const all = [...originalTo, ...originalCc, ...originalBcc]

  console.log(
    `[graphEmail] non-production: diverting to ${DEV_REDIRECT_TO} ` +
    `(would have gone to ${all.join(', ') || 'nobody'})`,
  )

  const banner =
    `<div style="background:#fff4d6;border-left:4px solid #dabd38;padding:12px 16px;` +
    `margin-bottom:20px;font-family:Arial,sans-serif;font-size:13px;color:#37584f">` +
    `<strong>Test email — not sent to the real recipient.</strong><br>` +
    `Environment: ${process.env.NODE_ENV || 'unknown'}<br>` +
    `In production this would go to: ${originalTo.join(', ') || '(none)'}` +
    (originalCc.length ? `<br>cc: ${originalCc.join(', ')}` : '') +
    (originalBcc.length ? `<br>bcc: ${originalBcc.join(', ')}` : '') +
    `</div>`

  return {
    ...payload,
    to: DEV_REDIRECT_TO,
    cc: undefined,
    bcc: undefined,
    subject: `[TEST → ${originalTo[0] ?? 'unknown'}] ${payload.subject}`,
    html: banner + payload.html,
  }
}

// ── Core send ─────────────────────────────────────────────────────────────────
export async function sendGraphEmail(
  rawPayload: SendEmailPayload
): Promise<SendEmailResult> {
  if (!isGraphEmailConfigured()) {
    const message =
      'Microsoft Graph email is not configured (missing MS_GRAPH_EMAIL_* env vars)'
    console.warn('[graphEmail]', message)
    return { data: null, error: { message } }
  }

  // Divert everything away from real recipients outside production. Applied
  // before any recipient is read, so nothing downstream can bypass it.
  const payload = applyEnvironmentRouting(rawPayload)

  const toRecipientsList = toRecipients(payload.to)
  if (toRecipientsList.length === 0) {
    const message = 'No valid "to" recipients provided'
    console.warn('[graphEmail]', message)
    return { data: null, error: { message } }
  }

  try {
    const token = await getAccessToken()
    const displayName = parseDisplayName(payload.from)

    const message: Record<string, unknown> = {
      subject: payload.subject,
      body: { contentType: 'HTML', content: payload.html },
      toRecipients: toRecipientsList,
      from: {
        emailAddress: {
          address: SENDER_MAILBOX,
          ...(displayName ? { name: displayName } : {}),
        },
      },
    }

    const cc = toRecipients(payload.cc)
    if (cc.length) message.ccRecipients = cc
    const bcc = toRecipients(payload.bcc)
    if (bcc.length) message.bccRecipients = bcc
    const replyTo = toRecipients(payload.replyTo)
    if (replyTo.length) message.replyTo = replyTo

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        SENDER_MAILBOX
      )}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      }
    )

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const errMessage = `Graph sendMail failed: ${res.status} ${detail}`
      console.error('[graphEmail]', errMessage)
      return { data: null, error: { message: errMessage } }
    }

    // Graph sendMail returns 202 Accepted with an empty body (no message id).
    // Synthesise an id from the request-id header for log traceability so the
    // shape stays compatible with Resend's `{ data: { id } }`.
    const requestId =
      res.headers.get('request-id') || res.headers.get('client-request-id') || 'sent'
    return { data: { id: `graph-${requestId}` }, error: null }
  } catch (err: any) {
    console.error('[graphEmail] send error:', err)
    return {
      data: null,
      error: { message: err?.message ?? 'Unknown error', name: err?.name },
    }
  }
}

// ── Resend-compatible shim ────────────────────────────────────────────────────
// Lets existing call sites keep `mailer.emails.send(payload)` unchanged.
export const graphMailer = {
  emails: {
    send: sendGraphEmail,
  },
}
