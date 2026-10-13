// Reminders from App analytics to one group of clients: set up a login, install the app, or update it.
// Who is in a group comes from lib/clientUsage.ts (the same rows the page shows), never from the browser.
//   no_password / website_only / old_app   an email from Qode Investor Relations. These clients cannot get a phone
//                                          alert: only the app from 1.3 on registers a phone, and they do not have it.
//   outdated_app                           a phone alert (and the in-app inbox) to clients on the new app whose
//                                          version is behind APP_LATEST_VERSION.
// A client is not reminded again within COOLDOWN_DAYS. Every reminder is one 'reminder.send' row in the admin audit
// log (target = the client's email), which is also where "Reminded on" and the cooldown are read from.
import { query } from '@/lib/db'
import { audit } from '@/lib/adminAuth'
import { sendGraphEmail } from '@/lib/graphEmail'
import { notifyEmails } from '@/lib/appNotify'
import { clientUsage, remindedAt } from '@/lib/clientUsage'

export const COOLDOWN_DAYS = 7
const WEB_URL = 'https://myqode.qodeinvest.com'
const IOS_URL = process.env.APP_IOS_URL ?? 'https://apps.apple.com/in/app/myqode/id6761060137'
const ANDROID_URL = process.env.APP_ANDROID_URL ?? 'https://play.google.com/store/apps/details?id=com.qodeinvest.myqode'
const LOGO = 'https://myqode.qodeinvest.com/icons/android-launchericon-144-144.png'
export const latestVersion = () => process.env.APP_LATEST_VERSION || ''
const older = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) } return false }

export type ReminderKind = 'no_password' | 'website_only' | 'old_app' | 'outdated_app'
type Button = { label: string; url: string }
export const REMINDERS: Record<ReminderKind, { channel: 'email' | 'phone'; group: string; subject: string; message: string; buttons: Button[] }> = {
  no_password: {
    channel: 'email', group: 'No password yet', subject: 'Set up your myQode login',
    message: `Your Qode portfolio is available on myQode, on the web and as an app for your phone. You have not set up your login yet.

It takes a minute: open myQode, enter this email address, and we will send you a code to create your password.

Once you are in, you can see your portfolio value, holdings, transactions and reports at any time.`,
    buttons: [{ label: 'Set up my login', url: WEB_URL }],
  },
  website_only: {
    channel: 'email', group: 'Website only, no app', subject: 'myQode is also an app for your phone',
    message: `You already use myQode on the web. The same account works in the myQode app for iPhone and Android.

In the app you can sign in with Face ID or your fingerprint, and get an alert when your money is received or invested and when your monthly update is ready.

Install it from the store below and sign in with the same email and password.`,
    buttons: [{ label: 'Get it for iPhone', url: IOS_URL }, { label: 'Get it for Android', url: ANDROID_URL }],
  },
  old_app: {
    channel: 'email', group: 'Has the old app, needs to update', subject: 'Please update your myQode app',
    message: `We have released a new version of the myQode app, and your phone still has the older one.

The new version is faster and clearer, and adds sign-in with Face ID or your fingerprint and alerts on your phone.

Updating takes a minute: open the store below and tap Update. Your email and password stay the same.`,
    buttons: [{ label: 'Update on iPhone', url: IOS_URL }, { label: 'Update on Android', url: ANDROID_URL }],
  },
  outdated_app: {
    channel: 'phone', group: 'On an older version of the new app', subject: 'Update myQode',
    message: 'A newer version of myQode is ready. Update from the store for the latest fixes and features.',
    buttons: [],
  },
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
/** The email as the client receives it: Qode header, "Dear <name>", the message as paragraphs, the buttons, the IR signature. */
export function reminderHtml(name: string, message: string, buttons: Button[]) {
  const paras = message.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 16px 0;color:#37584f;font-size:15px;line-height:1.6;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  const btns = buttons.map(b => `<a href="${b.url}" style="background-color:#02422b;color:#dabd38;padding:13px 24px;text-decoration:none;border-radius:10px;font-weight:bold;display:inline-block;margin:0 6px 10px 0;font-size:14px;">${esc(b.label)}</a>`).join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#efecd3;font-family:Lato,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;">
    <div style="margin-bottom:18px;"><img src="${LOGO}" alt="myQode" width="44" height="44" style="border-radius:10px;vertical-align:middle;"> <span style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#02422b;vertical-align:middle;margin-left:8px;">myQode</span></div>
    <div style="background:#f9f7ec;border:1px solid #d9d5b8;border-radius:14px;padding:26px 24px;">
      <p style="margin:0 0 16px 0;color:#002017;font-size:15px;">Dear ${esc(name)},</p>
      ${paras}
      ${btns ? `<div style="margin:22px 0 6px 0;">${btns}</div>` : ''}
      <p style="margin:18px 0 0 0;color:#37584f;font-size:14px;line-height:1.6;">If you need any help, reply to this email or call us on +91-9820300028.</p>
    </div>
    <p style="margin:20px 4px 0 4px;color:#002017;font-size:14px;">Best regards,<br><b style="color:#02422b;">Qode Investor Relations</b><br><span style="color:#37584f;">investor.relations@qodeinvest.com</span></p>
  </div></body></html>`
}

/** Who each reminder would go to right now, and who is left out because they were reminded in the last COOLDOWN_DAYS. */
export async function reminderAudiences() {
  const [data, reminded] = await Promise.all([clientUsage(30), remindedAt()])
  const latest = latestVersion(), cut = Date.now() - COOLDOWN_DAYS * 86400000
  const recent = (email: string) => { const at = reminded.get(email); return !!at && Date.parse(at) > cut }
  const of = (kind: ReminderKind) => {
    const inGroup = data.clients.filter(c => kind === 'outdated_app'
      ? !!(latest && c.hasApp && c.appVersion && c.notificationsOn && older(c.appVersion, latest))
      : c.status === kind)
    return { group: inGroup.length, send: inGroup.filter(c => !recent(c.email)), skipped: inGroup.filter(c => recent(c.email)).length }
  }
  return Object.fromEntries((Object.keys(REMINDERS) as ReminderKind[]).map(k => [k, of(k)])) as Record<ReminderKind, ReturnType<typeof of>>
}
export const reminderAudience = async (kind: ReminderKind) => (await reminderAudiences())[kind]

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function emailOne(to: string, name: string, subject: string, message: string, buttons: Button[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await sendGraphEmail({ from: 'Qode Investor Relations <investor.relations@qodeinvest.com>', to, subject, html: reminderHtml(name, message, buttons) })
    if (!r.error) return null
    if (!/ 429 | 503 | 504 /.test(` ${r.error.message} `)) return r.error.message
    await wait(20000)   // the mailbox is being throttled: wait and try again
  }
  return 'The mailbox kept refusing (too many emails at once)'
}

/** A test to the admin's own email / phone, so the exact message can be read before it goes to clients. */
export async function sendReminderTest(kind: ReminderKind, admin: { email: string; name?: string | null }, subject: string, message: string) {
  const R = REMINDERS[kind]
  if (R.channel === 'phone') {
    const n = await notifyEmails([admin.email], { category: 'updates', title: subject, body: message, dedupeKey: `reminder-test:${Date.now()}` }, { force: true })
    return n ? null : 'Could not queue the test alert'
  }
  return emailOne(admin.email, admin.name || 'Sanket', `[Test] ${subject}`, message, R.buttons)
}

/**
 * Sends the reminder to the group, in the background (the mailbox takes about 25 emails a minute, so a group of 90
 * needs a few minutes). Returns at once with how many were queued. Each client is written to the audit log as they
 * are sent, which is what marks them "Reminded" on the page.
 */
export async function sendReminders(kind: ReminderKind, admin: { email: string }, subject: string, message: string) {
  const R = REMINDERS[kind]
  const { send, skipped } = await reminderAudience(kind)
  if (!send.length) return { queued: 0, skipped }
  await audit(null, admin, 'reminder.batch', kind, { subject, recipients: send.length, skipped, channel: R.channel })
  const run = async () => {
    let ok = 0, failed = 0
    if (R.channel === 'phone') {
      const key = `reminder:${kind}:${Date.now()}`
      await notifyEmails(send.map(c => c.email), { category: 'updates', title: subject, body: message, dedupeKey: key }, { force: true })
      for (const c of send) await audit(null, admin, 'reminder.send', c.email, { kind, channel: 'phone', ok: true })
      ok = send.length
    } else {
      for (const c of send) {
        const err = await emailOne(c.email, c.name, subject, message, R.buttons)
        // A failed email is not recorded as a reminder, so the client stays in the next send
        if (err) { failed++; await audit(null, admin, 'reminder.failed', c.email, { kind, error: err.slice(0, 200) }) }
        else { ok++; await audit(null, admin, 'reminder.send', c.email, { kind, channel: 'email', ok: true }) }
        await wait(2500)
      }
    }
    console.log(`[reminders] ${kind}: ${ok} sent, ${failed} failed, by ${admin.email}`)
  }
  setImmediate(() => { run().catch(e => console.error('[reminders]', e?.message)) })
  return { queued: send.length, skipped }
}

/** Reminder batches sent so far, newest first, for the page's history line. */
export async function reminderHistory() {
  try {
    return (await query(
      `SELECT b.target AS kind, b.admin_email AS by, b.created_at AS at, (b.details->>'recipients')::int AS recipients, b.details->>'subject' AS subject
         FROM admin_audit_log b WHERE b.action = 'reminder.batch' ORDER BY b.created_at DESC LIMIT 10`)).rows
      .map((r: any) => ({ kind: r.kind, by: r.by, at: new Date(r.at).toISOString(), recipients: r.recipients, subject: r.subject }))
  } catch { return [] }
}
