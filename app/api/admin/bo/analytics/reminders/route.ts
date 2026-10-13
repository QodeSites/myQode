// Reminders to a group of clients from App analytics (lib/clientReminders.ts).
// GET  (staff) → { kinds: { <kind>: { channel, group, subject, message, buttons, recipients, skipped } }, cooldownDays, latestVersion, history }
// POST (super, or an investors admin) { kind, subject, message, mode }
//   mode 'preview' → { recipients, skipped, names, html }: nothing is sent
//   mode 'test'    → the message goes only to the admin's own email / phone
//   mode 'send'    → queued to the whole group (minus anyone reminded in the last 7 days); sent in the background
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { COOLDOWN_DAYS, REMINDERS, ReminderKind, latestVersion, reminderAudience, reminderAudiences, reminderHistory, reminderHtml, sendReminderTest, sendReminders } from '@/lib/clientReminders'

export const dynamic = 'force-dynamic'
const KINDS = Object.keys(REMINDERS) as ReminderKind[]

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  try {
    const kinds: Record<string, unknown> = {}
    const all = await reminderAudiences()
    for (const k of KINDS) kinds[k] = { ...REMINDERS[k], recipients: all[k].send.length, skipped: all[k].skipped }
    return NextResponse.json({ kinds, cooldownDays: COOLDOWN_DAYS, latestVersion: latestVersion(), history: await reminderHistory() })
  } catch (e) {
    console.error('[bo/analytics/reminders GET]', e)
    return NextResponse.json({ error: 'Could not load the reminders' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super', 'investors')
  if (error) return error
  let b: any = {}
  try { b = await req.json() } catch {}
  const kind = b?.kind as ReminderKind
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Choose which group to remind' }, { status: 400 })
  const R = REMINDERS[kind]
  const subject = String(b?.subject || '').trim(), message = String(b?.message || '').trim()
  const max = R.channel === 'phone' ? 300 : 2000
  if (!subject || subject.length > 90) return NextResponse.json({ error: 'A subject is required (up to 90 characters)' }, { status: 400 })
  if (!message || message.length > max) return NextResponse.json({ error: `A message is required (up to ${max} characters)` }, { status: 400 })
  try {
    if (b?.mode === 'test') {
      const err = await sendReminderTest(kind, admin!, subject, message)
      if (err) return NextResponse.json({ error: err }, { status: 502 })
      await audit(req, admin!, 'reminder.test', kind, { subject })
      return NextResponse.json({ ok: true, to: admin!.email })
    }
    if (b?.mode === 'send') return NextResponse.json(await sendReminders(kind, admin!, subject, message))
    const a = await reminderAudience(kind)
    return NextResponse.json({
      recipients: a.send.length, skipped: a.skipped, names: a.send.slice(0, 200).map(c => c.name),
      html: R.channel === 'email' ? reminderHtml(a.send[0]?.name || 'Client Name', message, R.buttons) : null,
    })
  } catch (e) {
    console.error('[bo/analytics/reminders POST]', e)
    return NextResponse.json({ error: 'Could not send the reminder' }, { status: 500 })
  }
}
