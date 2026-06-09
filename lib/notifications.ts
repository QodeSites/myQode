/**
 * lib/notifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised notification service for all payment lifecycle events.
 * Handles: Email (Microsoft Graph) + Expo Push Notifications + in-app (DB-driven).
 *
 * Design principles:
 *  - Notifications NEVER throw. A failed notification must not crash the
 *    payment flow. Every exported function is wrapped in try/catch.
 *  - Fire-and-forget in webhook context. Await in cron context.
 *  - Email and push are sent in parallel (Promise.allSettled).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { graphMailer, isGraphEmailConfigured } from '@/lib/graphEmail'
import pool from '@/lib/db'

const FROM_EMAIL  = process.env.NOTIFICATION_FROM_EMAIL || 'Qode Invest <investments@qodeinvest.com>'
const APP_NAME    = 'Qode Invest'
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

// ── Dev/test override ─────────────────────────────────────────────────────────
// Set NOTIFICATION_TEST_EMAIL in .env.local to redirect ALL outgoing emails
// to a single address during testing. The real client email is ignored.
// Example: NOTIFICATION_TEST_EMAIL=sanket.shinde@qodeinvest.com
// Multiple addresses: NOTIFICATION_TEST_EMAIL=addr1@x.com,addr2@x.com
const TEST_EMAIL_OVERRIDE = process.env.NOTIFICATION_TEST_EMAIL
  ? process.env.NOTIFICATION_TEST_EMAIL.split(',').map((e) => e.trim())
  : null

// ── Event types ───────────────────────────────────────────────────────────────
export type NotificationEvent =
  | 'PAYMENT_SUCCESS'       // one-time: payment captured
  | 'SETTLED'               // one-time: funds received by Qode
  | 'DEPLOYED'              // one-time: money deployed into strategy
  | 'PAYMENT_FAILED'        // one-time: payment failed / reversed
  | 'ORDER_EXPIRED'         // one-time: order expired unpaid
  | 'SIP_ACTIVE'            // SIP: mandate approved, SIP is live
  | 'SIP_MANDATE_FAILED'    // SIP: mandate authorization rejected
  | 'SIP_PAYMENT_SUCCESS'   // SIP: installment debited successfully
  | 'SIP_PAYMENT_FAILED'    // SIP: installment debit failed
  | 'SIP_CANCELLED'         // SIP: subscription cancelled
  | 'SIP_COMPLETED'         // SIP: all installments done

export interface NotificationPayload {
  clientId:          string
  clientName:        string
  email:             string
  amount:            number
  currency?:         string
  orderId?:          string
  subscriptionId?:   string
  strategyType?:     string
  frequency?:        string
  nextChargeDate?:   string    // ISO date string
  failureReason?:    string
  deployedAt?:       string    // ISO date string
  installmentNumber?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatINR(amount: number): string {
  return `₹${Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Email content ─────────────────────────────────────────────────────────────
interface EmailContent { subject: string; html: string }

function buildEmailHtml(title: string, bodyLines: string[], accentColor = '#1A3D2B'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:${accentColor};padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">${APP_NAME}</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 20px;color:#111827;font-size:18px;font-weight:600;">${title}</h2>
            ${bodyLines.map(line =>
              `<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">${line}</p>`
            ).join('\n            ')}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
              This is an automated message from ${APP_NAME}. Please do not reply to this email.<br/>
              For support, contact your relationship manager or write to <a href="mailto:support@qodeinvest.com" style="color:${accentColor};">support@qodeinvest.com</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function getEmailContent(event: NotificationEvent, p: NotificationPayload): EmailContent {
  const amt = formatINR(p.amount)
  const name = p.clientName?.split(' ')[0] || 'there'
  const freq = p.frequency
    ? p.frequency.charAt(0).toUpperCase() + p.frequency.slice(1)
    : ''

  switch (event) {
    case 'PAYMENT_SUCCESS':
      return {
        subject: `✅ Payment Confirmed — ${amt}`,
        html: buildEmailHtml('Payment Confirmed', [
          `Hi ${name},`,
          `Your payment of <strong>${amt}</strong> has been successfully confirmed.`,
          `We have received the funds and they are now being settled to Qode. This typically takes <strong>T+1 business day</strong>.`,
          `You will receive another update as soon as the funds arrive and are deployed into your strategy.`,
          p.orderId ? `<span style="color:#9ca3af;font-size:12px;">Reference: ${p.orderId}</span>` : '',
        ].filter(Boolean)),
      }

    case 'SETTLED':
      return {
        subject: `🏦 Funds Received — Deploying ${amt}`,
        html: buildEmailHtml('Funds Received by Qode', [
          `Hi ${name},`,
          `Qode has received your funds of <strong>${amt}</strong>.`,
          `We are now deploying your investment into your selected strategy${p.strategyType ? ` (<strong>${p.strategyType}</strong>)` : ''}. Deployment typically completes on the same business day.`,
          `You will receive a final confirmation once your money is live in your portfolio.`,
          p.orderId ? `<span style="color:#9ca3af;font-size:12px;">Reference: ${p.orderId}</span>` : '',
        ].filter(Boolean)),
      }

    case 'DEPLOYED':
      return {
        subject: `🚀 Investment Live — ${amt} Deployed`,
        html: buildEmailHtml('Your Investment is Live', [
          `Hi ${name},`,
          `Your investment of <strong>${amt}</strong> has been successfully deployed into your strategy${p.strategyType ? ` (<strong>${p.strategyType}</strong>)` : ''}.`,
          `You can now track the performance of your investment in the <strong>Qode Invest app</strong> under the Portfolio tab.`,
          p.deployedAt ? `Deployed on: <strong>${formatDate(p.deployedAt)}</strong>` : '',
          p.orderId ? `<span style="color:#9ca3af;font-size:12px;">Reference: ${p.orderId}</span>` : '',
        ].filter(Boolean), '#059669'),
      }

    case 'PAYMENT_FAILED':
      return {
        subject: `❌ Payment Failed — Action Required`,
        html: buildEmailHtml('Payment Could Not Be Processed', [
          `Hi ${name},`,
          `Unfortunately, your payment of <strong>${amt}</strong> could not be processed.`,
          p.failureReason ? `Reason: <strong>${p.failureReason}</strong>` : '',
          `Please open the Qode Invest app and try again. If the issue persists, contact your relationship manager.`,
          p.orderId ? `<span style="color:#9ca3af;font-size:12px;">Reference: ${p.orderId}</span>` : '',
        ].filter(Boolean), '#DC2626'),
      }

    case 'ORDER_EXPIRED':
      return {
        subject: `⏰ Payment Order Expired`,
        html: buildEmailHtml('Investment Order Expired', [
          `Hi ${name},`,
          `Your investment order for <strong>${amt}</strong> has expired without a completed payment.`,
          `Please open the Qode Invest app to create a new investment order when you are ready.`,
        ], '#6B7280'),
      }

    case 'SIP_ACTIVE':
      return {
        subject: `✅ SIP Activated — ${amt} ${freq}`,
        html: buildEmailHtml('Your SIP is Now Active', [
          `Hi ${name},`,
          `Your <strong>${freq} SIP of ${amt}</strong> has been successfully activated.`,
          p.nextChargeDate ? `Your first charge is scheduled for <strong>${formatDate(p.nextChargeDate)}</strong>.` : '',
          `Subsequent charges will be automatically debited from your registered bank account on schedule.`,
          `You can manage your SIP (pause, resume, or cancel) anytime from the Qode Invest app.`,
          p.subscriptionId ? `<span style="color:#9ca3af;font-size:12px;">SIP ID: ${p.subscriptionId}</span>` : '',
        ].filter(Boolean), '#059669'),
      }

    case 'SIP_MANDATE_FAILED':
      return {
        subject: `❌ SIP Mandate Authorization Failed`,
        html: buildEmailHtml('SIP Could Not Be Activated', [
          `Hi ${name},`,
          `We were unable to activate your <strong>${freq} SIP of ${amt}</strong>.`,
          `The bank mandate authorization was not completed successfully.`,
          p.failureReason ? `Reason: <strong>${p.failureReason}</strong>` : '',
          `Please open the Qode Invest app and set up your SIP again. If you need assistance, contact your relationship manager.`,
        ].filter(Boolean), '#DC2626'),
      }

    case 'SIP_PAYMENT_SUCCESS':
      return {
        subject: `✅ SIP Installment Processed — ${amt}`,
        html: buildEmailHtml('SIP Installment Successful', [
          `Hi ${name},`,
          p.installmentNumber ? `Your SIP installment #${p.installmentNumber}` : `Your SIP installment`,
          `of <strong>${amt}</strong> has been successfully debited.`,
          `The funds are being settled and will be deployed into your strategy.`,
          p.nextChargeDate ? `Next charge scheduled: <strong>${formatDate(p.nextChargeDate)}</strong>` : '',
          p.subscriptionId ? `<span style="color:#9ca3af;font-size:12px;">SIP ID: ${p.subscriptionId}</span>` : '',
        ].filter(Boolean)),
      }

    case 'SIP_PAYMENT_FAILED':
      return {
        subject: `❌ SIP Installment Failed — Action Required`,
        html: buildEmailHtml('SIP Installment Could Not Be Processed', [
          `Hi ${name},`,
          p.installmentNumber ? `Your SIP installment #${p.installmentNumber}` : `Your SIP installment`,
          `of <strong>${amt}</strong> could not be debited from your bank account.`,
          p.failureReason ? `Reason: <strong>${p.failureReason}</strong>` : '',
          `Please ensure your bank account has sufficient funds. Cashfree may attempt a retry automatically.`,
          `If the issue persists, open the Qode Invest app to review or cancel this SIP.`,
          p.subscriptionId ? `<span style="color:#9ca3af;font-size:12px;">SIP ID: ${p.subscriptionId}</span>` : '',
        ].filter(Boolean), '#DC2626'),
      }

    case 'SIP_CANCELLED':
      return {
        subject: `SIP Cancelled — ${amt} ${freq}`,
        html: buildEmailHtml('SIP Cancelled', [
          `Hi ${name},`,
          `Your <strong>${freq} SIP of ${amt}</strong> has been cancelled.`,
          `No further charges will be made from your bank account for this SIP.`,
          `If you did not request this cancellation, please contact your relationship manager immediately.`,
          p.subscriptionId ? `<span style="color:#9ca3af;font-size:12px;">SIP ID: ${p.subscriptionId}</span>` : '',
        ].filter(Boolean), '#6B7280'),
      }

    case 'SIP_COMPLETED':
      return {
        subject: `🎉 SIP Completed — All Installments Processed`,
        html: buildEmailHtml('SIP Journey Complete', [
          `Hi ${name},`,
          `Your <strong>${freq} SIP of ${amt}</strong> has been completed.`,
          `All installments have been successfully processed. You can view your full investment history in the Qode Invest app.`,
          p.subscriptionId ? `<span style="color:#9ca3af;font-size:12px;">SIP ID: ${p.subscriptionId}</span>` : '',
        ].filter(Boolean), '#059669'),
      }

    default:
      return { subject: 'Update from Qode Invest', html: '' }
  }
}

// ── Push notification content ─────────────────────────────────────────────────
function getPushContent(event: NotificationEvent, p: NotificationPayload): {
  title: string
  body:  string
} {
  const amt  = formatINR(p.amount)
  const freq = p.frequency
    ? p.frequency.charAt(0).toUpperCase() + p.frequency.slice(1)
    : ''

  switch (event) {
    case 'PAYMENT_SUCCESS':
      return { title: 'Payment Confirmed ✅', body: `Your payment of ${amt} is confirmed. Funds are being settled.` }
    case 'SETTLED':
      return { title: 'Funds Received 🏦', body: `Qode has received ${amt}. Deploying into your strategy now.` }
    case 'DEPLOYED':
      return { title: 'Investment Live 🚀', body: `${amt} has been deployed into your strategy${p.strategyType ? ` (${p.strategyType})` : ''}.` }
    case 'PAYMENT_FAILED':
      return { title: 'Payment Failed ❌', body: `Your payment of ${amt} could not be processed. Tap to retry.` }
    case 'ORDER_EXPIRED':
      return { title: 'Order Expired ⏰', body: `Your investment order for ${amt} has expired.` }
    case 'SIP_ACTIVE':
      return { title: 'SIP Activated ✅', body: `Your ${freq} SIP of ${amt} is now active.` }
    case 'SIP_MANDATE_FAILED':
      return { title: 'SIP Activation Failed ❌', body: `Your ${freq} SIP of ${amt} could not be activated.` }
    case 'SIP_PAYMENT_SUCCESS':
      return { title: 'SIP Installment Processed ✅', body: `${amt} debited successfully for your SIP.` }
    case 'SIP_PAYMENT_FAILED':
      return { title: 'SIP Installment Failed ❌', body: `${amt} could not be debited for your SIP. Check your account.` }
    case 'SIP_CANCELLED':
      return { title: 'SIP Cancelled', body: `Your ${freq} SIP of ${amt} has been cancelled.` }
    case 'SIP_COMPLETED':
      return { title: 'SIP Completed 🎉', body: `All installments for your ${freq} SIP of ${amt} are done.` }
    default:
      return { title: APP_NAME, body: 'You have an update on your investment.' }
  }
}

// ── Fetch push tokens from DB ─────────────────────────────────────────────────
async function getPushTokens(clientId: string): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `SELECT push_token FROM client_push_tokens
       WHERE client_id = $1 AND is_active = TRUE`,
      [clientId]
    )
    return rows.map((r: any) => r.push_token)
  } catch (err) {
    console.error('[notifications] Failed to fetch push tokens:', err)
    return []
  }
}

// ── Send Expo push notifications ──────────────────────────────────────────────
async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!tokens.length) return

  // Filter valid Expo push tokens
  const validTokens = tokens.filter(
    t => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')
  )
  if (!validTokens.length) return

  const messages = validTokens.map(token => ({
    to:    token,
    sound: 'default',
    title,
    body,
    data:  data ?? {},
  }))

  // Expo accepts up to 100 messages per request
  const CHUNK = 100
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK)
    const resp = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(chunk),
    })

    if (!resp.ok) {
      console.error('[notifications] Expo push failed:', resp.status, await resp.text())
      continue
    }

    const result = await resp.json()
    // Mark tokens with DeviceNotRegistered errors as inactive
    const toDeactivate: string[] = []
    ;(result.data ?? []).forEach((item: any, idx: number) => {
      if (item.status === 'error' && item.details?.error === 'DeviceNotRegistered') {
        toDeactivate.push(chunk[idx].to)
      }
    })
    if (toDeactivate.length) {
      await pool.query(
        `UPDATE client_push_tokens SET is_active = FALSE
         WHERE push_token = ANY($1)`,
        [toDeactivate]
      ).catch(() => {}) // don't fail for this
    }
  }
}

// ── Send email via Microsoft Graph ────────────────────────────────────────────
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  if (!isGraphEmailConfigured()) {
    console.warn('[notifications] Microsoft Graph email not configured — skipping email')
    return
  }
  await graphMailer.emails.send({ from: FROM_EMAIL, to, subject, html })
}

// ── Main exported function ────────────────────────────────────────────────────
/**
 * Send email + push notification for a payment lifecycle event.
 * Safe to fire-and-forget: Promise<void>, never throws.
 */
export async function notifyClient(
  event:   NotificationEvent,
  payload: NotificationPayload
): Promise<void> {
  try {
    const { subject, html } = getEmailContent(event, payload)
    const { title, body }   = getPushContent(event, payload)
    const tokens = await getPushTokens(payload.clientId)

    const pushData: Record<string, string> = {
      event,
      ...(payload.orderId       ? { orderId:        payload.orderId }       : {}),
      ...(payload.subscriptionId ? { subscriptionId: payload.subscriptionId } : {}),
    }

    // In test/dev: redirect emails to the override address(es) instead of the real client email
    const emailRecipient = TEST_EMAIL_OVERRIDE ?? payload.email

    await Promise.allSettled([
      html
        ? sendEmail(emailRecipient as any, subject, html)
        : Promise.resolve(),
      tokens.length
        ? sendPushNotifications(tokens, title, body, pushData)
        : Promise.resolve(),
    ])
  } catch (err) {
    // Log but never propagate — notification failures must not affect payment processing
    console.error('[notifications] notifyClient error (non-fatal):', err)
  }
}

/**
 * Convenience wrapper to look up the client's email from DB and notify.
 * Fetches email from pms_clients_master by client_id.
 */
export async function notifyClientById(
  clientId: string,
  event:    NotificationEvent,
  payload:  Omit<NotificationPayload, 'clientId' | 'clientName' | 'email'>
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT clientid, email,
              TRIM(CONCAT_WS(' ', firstname, middlename, lastname)) AS full_name
       FROM pms_clients_master
       WHERE clientid = $1 LIMIT 1`,
      [clientId]
    )
    if (!rows.length) {
      console.warn('[notifications] Client not found for notification:', clientId)
      return
    }
    const client = rows[0]
    await notifyClient(event, {
      ...payload,
      clientId:   client.clientid,
      clientName: client.full_name || 'Investor',
      email:      client.email,
    })
  } catch (err) {
    console.error('[notifications] notifyClientById error (non-fatal):', err)
  }
}
