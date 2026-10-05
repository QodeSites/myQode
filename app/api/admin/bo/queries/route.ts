// Admin → Queries: every question and request from investors and partners, sorted, with the person behind it, and
// everything the IR team needs to answer and close it. Source: pms_clients_tracker.qode_microsite_inquiries (written
// by the web portal's forms, the app's service requests and partner tickets) + qode_inquiry_notes (the history).
//
// Each record is classified here (nothing changes in the table):
//   kind     query | payment (automatic "payment completed / SIP set up" notices) | reply (a sent answer, threaded)
//   who      investor (an account code of a client) | partner (a distributor ticket, or a partner's email) | staff
//   test     "[TEST" / "QA TEST" in the subject or message, demo / dev accounts, or sent from a Qode address that
//            is not a client's — unless an admin marked it otherwise (data._test = 'yes' | 'no')
//   state    open | in_progress (assigned) | resolved
//
// GET  (staff)  ?id=…   → { item, notes, replies }          GET (staff) → { items, counts }
// POST (staff)  { id, action: 'reply' | 'note' | 'assign' | 'priority' | 'resolve' | 'reopen' | 'markTest', … }
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { query as q1 } from '@/lib/db1'
import { query } from '@/lib/db'
import { graphMailer } from '@/lib/graphEmail'

export const dynamic = 'force-dynamic'
const T = 'pms_clients_tracker.qode_microsite_inquiries', N = 'pms_clients_tracker.qode_inquiry_notes'
const PAYMENT_TYPES = ['payment_success', 'new_strategy_payment_success', 'sip_success']
const TYPE_LABEL: Record<string, string> = {
  switch: 'Strategy switch', raised_request: 'Service request', strategy: 'Strategy question', discussion: 'Discussion request',
  withdrawal: 'Withdrawal', feedback: 'Feedback', testimonial: 'Testimonial', investor_referral: 'Referral',
  distributor_ticket: 'Partner ticket', payment_success: 'Payment received', new_strategy_payment_success: 'New strategy payment',
  sip_success: 'SIP set up', admin_response: 'Reply',
}
const IR = 'investor.relations@qodeinvest.com'

type Row = Record<string, any>
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()
const isClientCode = (c: unknown) => /^Q[A-Z]{2}\d+$/i.test(String(c ?? ''))

async function people(rows: Row[]) {
  const codes = [...new Set(rows.map(r => String(r.nuvama_code || '').toUpperCase()).filter(isClientCode))]
  const emails = [...new Set(rows.map(r => lc(r.user_email)).filter(Boolean))]
  const [byCode, byEmail] = await Promise.all([
    codes.length ? query(`SELECT upper(clientcode) code, trim(clientname) name, lower(trim(email)) email, mobile FROM pms_clients_master WHERE upper(clientcode) = ANY($1)`, [codes]) : { rows: [] },
    emails.length ? query(`SELECT lower(trim(email)) email, bool_or(clientcode IS NOT NULL) client, bool_or(clientcode IS NULL AND clientname IS NOT NULL) partner,
                                   max(trim(clientname)) FILTER (WHERE clientcode IS NULL) partner_name, max(trim(clientname)) FILTER (WHERE clientcode IS NOT NULL) client_name
                              FROM pms_clients_master WHERE lower(trim(email)) = ANY($1) GROUP BY 1`, [emails]) : { rows: [] },
  ])
  return { code: new Map((byCode.rows as Row[]).map(r => [r.code, r])), email: new Map((byEmail.rows as Row[]).map(r => [r.email, r])) }
}

function classify(r: Row, P: Awaited<ReturnType<typeof people>>) {
  const email = lc(r.user_email), code = String(r.nuvama_code || '').toUpperCase(), d = r.data || {}
  const client = P.code.get(code), byEmail = P.email.get(email)
  const kind = r.type === 'admin_response' || r.parent_inquiry_id ? 'reply' : PAYMENT_TYPES.includes(r.type) ? 'payment' : 'query'
  const who = r.type === 'distributor_ticket' || (byEmail?.partner && !byEmail?.client) ? 'partner'
    : client || byEmail?.client ? 'investor' : email.endsWith('@qodeinvest.com') ? 'staff' : 'investor'
  const text = `${r.subject || ''} ${JSON.stringify(d)}`.toLowerCase()
  const msgOnly = String(d.message || d.question || d.description || d.topic || '').trim().toLowerCase()
  const testReason = /\[test/.test(text) ? 'Marked [TEST] by a test build' : /qa test|\btest only\b/.test(text) ? 'Says “QA test” / “test only”'
    : /^(test|testing|test test|abc|asdf|xyz|hello|hi)[.!]*$/.test(msgOnly) || /^test\b/.test(lc(d.referred_investor_name)) ? 'The message is just “test”'
    : /^(demo|dev-)/i.test(code) ? 'Demo / development account'
    : email.endsWith('@qodeinvest.com') && !byEmail?.client && r.type !== 'distributor_ticket' ? 'Sent from a Qode staff address' : null
  const autoTest = !!testReason
  const test = r.status === 'test' || (d._test === 'yes') || (d._test !== 'no' && autoTest)
  const state = r.status === 'resolved' ? 'resolved' : r.assigned_to ? 'in_progress' : 'open'
  const name = who === 'partner' ? (d.partner?.name || d.partner || byEmail?.partner_name || r.user_email)
    : (client?.name || byEmail?.client_name || r.user_email || 'Unknown')
  const message = d.message || d.question || d.description || d.topic || d.inquirySpecificData?.message || d.inquirySpecificData?.comments || ''
  return {
    id: r.id, type: r.type, typeLabel: TYPE_LABEL[r.type] || String(r.type || 'Query').replace(/_/g, ' '),
    kind, who, test, autoTest, testReason: r.status === 'test' || d._test === 'yes' ? 'Marked as a test by an admin' : testReason, state, priority: r.priority || 'normal',
    subject: String(r.subject || '').replace(/^\[TEST · IR\]\s*/, ''), preview: String(typeof message === 'string' ? message : JSON.stringify(message)).slice(0, 180),
    name: typeof name === 'string' ? name : String(name), email: r.user_email, code: isClientCode(code) ? code : null, mobile: client?.mobile ? String(client.mobile).replace(/\.0+$/, '') : null,
    createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at, assignedTo: r.assigned_to, lastBy: r.last_updated_by,
    replies: Array.isArray(d.admin_responses) ? d.admin_responses.length : 0,
    ageHours: Math.round((Date.now() - new Date(r.created_at).getTime()) / 3600000),
  }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  const id = req.nextUrl.searchParams.get('id')
  try {
    if (id) {
      const r = (await q1(`SELECT * FROM ${T} WHERE id::text = $1`, [id])).rows[0]
      if (!r) return NextResponse.json({ error: 'Query not found' }, { status: 404 })
      const [notes, children] = await Promise.all([
        q1(`SELECT id, admin_email, note_type, content, old_value, new_value, created_at FROM ${N} WHERE inquiry_id::text = $1 ORDER BY created_at`, [id]),
        q1(`SELECT * FROM ${T} WHERE parent_inquiry_id::text = $1 OR (thread_id IS NOT NULL AND thread_id::text = $2 AND id::text <> $1) ORDER BY created_at`, [id, r.thread_id || '__none__']),
      ])
      const P = await people([r, ...children.rows])
      const d = r.data || {}
      const sent = [...(Array.isArray(d.admin_responses) ? d.admin_responses : []),
        ...children.rows.map((c: Row) => ({ message: c.data?.message, sent_by: c.data?.sent_by || c.last_updated_by, sent_at: c.created_at, cc: c.data?.cc || [] }))]
      const { admin_responses, _test, ...fields } = d
      return NextResponse.json({ item: classify(r, P), fields, replies: sent, notes: notes.rows })
    }
    const rows = (await q1(`SELECT * FROM ${T} WHERE created_at > NOW() - interval '400 days' ORDER BY created_at DESC LIMIT 2000`)).rows
    const P = await people(rows)
    const items = rows.map(r => classify(r, P)).filter(x => x.kind !== 'reply')
    const real = items.filter(x => !x.test)
    const counts = {
      open: real.filter(x => x.kind === 'query' && x.state === 'open').length,
      inProgress: real.filter(x => x.kind === 'query' && x.state === 'in_progress').length,
      overdue: real.filter(x => x.kind === 'query' && x.state !== 'resolved' && x.ageHours > 48).length,
      resolvedWeek: real.filter(x => x.kind === 'query' && x.resolvedAt && Date.now() - new Date(x.resolvedAt).getTime() < 7 * 86400000).length,
      investors: real.filter(x => x.kind === 'query' && x.who === 'investor' && x.state !== 'resolved').length,
      partners: real.filter(x => x.kind === 'query' && x.who === 'partner' && x.state !== 'resolved').length,
      tests: items.filter(x => x.test).length, payments: real.filter(x => x.kind === 'payment').length,
      medianResolveHours: (() => { const h = real.filter(x => x.kind === 'query' && x.resolvedAt).map(x => (new Date(x.resolvedAt).getTime() - new Date(x.createdAt).getTime()) / 3600000).sort((a, b) => a - b); return h.length ? Math.round(h[Math.floor(h.length / 2)]) : null })(),
    }
    return NextResponse.json({ items, counts })
  } catch (e: any) {
    console.error('[admin/bo/queries] GET', e)
    return NextResponse.json({ error: 'Could not load queries' }, { status: 500 })
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'staff')
  if (error) return error
  let b: any = {}
  try { b = await req.json() } catch {}
  const id = String(b?.id || ''), action = String(b?.action || '')
  const r = (await q1(`SELECT * FROM ${T} WHERE id::text = $1`, [id])).rows[0]
  if (!r) return NextResponse.json({ error: 'Query not found' }, { status: 404 })
  const me = admin!.email
  const note = (type: string, content: string, oldV: string | null = null, newV: string | null = null) =>
    q1(`INSERT INTO ${N} (inquiry_id, admin_email, note_type, content, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)`, [r.id, me, type, content, oldV, newV])
  try {
    switch (action) {
      case 'reply': {
        const to = [].concat(b.to || r.user_email).map(String).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
        const cc = [].concat(b.cc || []).map(String).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
        const message = String(b.message || '').trim(), subject = String(b.subject || `Re: ${String(r.subject || '').replace(/^\[TEST · IR\]\s*/, '')}`).slice(0, 200)
        if (!to.length || !message) return NextResponse.json({ error: 'A recipient and a message are needed' }, { status: 400 })
        const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:600px;color:#002017;line-height:1.6">
          <p>${esc(message).replace(/\n/g, '<br>')}</p>
          <p style="margin-top:24px;color:#37584f">Investor Relations<br>Qode Advisors LLP<br><a href="mailto:${IR}">${IR}</a></p>
          <hr style="border:none;border-top:1px solid #e3e0cc;margin:20px 0"><p style="font-size:12px;color:#7a8a82">Your query: ${esc(String(r.subject || '').replace(/^\[TEST · IR\]\s*/, ''))}</p></div>`
        const sent = await graphMailer.emails.send({ from: `Qode Investor Relations <${IR}>`, to, ...(cc.length ? { cc } : {}), subject, html } as any)
        if ((sent as any)?.error) return NextResponse.json({ error: 'Email failed: ' + (sent as any).error.message }, { status: 502 })
        await q1(`UPDATE ${T} SET updated_at = NOW(), last_updated_by = $1, assigned_to = COALESCE(assigned_to, $1),
                    data = jsonb_set(COALESCE(data, '{}'::jsonb), '{admin_responses}', COALESCE(data->'admin_responses', '[]'::jsonb) || $2::jsonb)
                  WHERE id = $3`, [me, JSON.stringify([{ message, cc, to, subject, sent_by: me, sent_at: new Date().toISOString() }]), r.id])
        await note('reply', `Replied to ${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''}`)
        if (b.resolve) {
          await q1(`UPDATE ${T} SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(), last_updated_by = $1 WHERE id = $2`, [me, r.id])
          await note('status_change', 'Resolved with the reply', r.status, 'resolved')
        }
        await audit(req, admin!, 'queries.reply', String(r.id), { to, resolve: !!b.resolve })
        return NextResponse.json({ ok: true })
      }
      case 'note': {
        const text = String(b.text || '').trim()
        if (!text) return NextResponse.json({ error: 'Write the note first' }, { status: 400 })
        await note('note', text.slice(0, 4000))
        await q1(`UPDATE ${T} SET updated_at = NOW(), last_updated_by = $1 WHERE id = $2`, [me, r.id])
        return NextResponse.json({ ok: true })
      }
      case 'assign': {
        const to = b.email === null ? null : String(b.email || me).trim().toLowerCase()
        await q1(`UPDATE ${T} SET assigned_to = $1, updated_at = NOW(), last_updated_by = $2 WHERE id = $3`, [to, me, r.id])
        await note('assignment', to ? `Assigned to ${to}` : 'Unassigned', r.assigned_to, to)
        return NextResponse.json({ ok: true })
      }
      case 'priority': {
        const p = ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : null
        if (!p) return NextResponse.json({ error: 'Priority must be low, normal, high or urgent' }, { status: 400 })
        await q1(`UPDATE ${T} SET priority = $1, updated_at = NOW(), last_updated_by = $2 WHERE id = $3`, [p, me, r.id])
        await note('priority_change', `Priority ${r.priority || 'normal'} → ${p}`, r.priority, p)
        return NextResponse.json({ ok: true })
      }
      case 'resolve':
      case 'reopen': {
        const to = action === 'resolve' ? 'resolved' : 'pending'
        await q1(`UPDATE ${T} SET status = $1, resolved_at = ${action === 'resolve' ? 'NOW()' : 'NULL'}, updated_at = NOW(), last_updated_by = $2 WHERE id = $3`, [to, me, r.id])
        await note('status_change', (action === 'resolve' ? 'Resolved' : 'Reopened') + (b.text ? `: ${String(b.text).slice(0, 2000)}` : ''), r.status, to)
        await audit(req, admin!, 'queries.' + action, String(r.id))
        return NextResponse.json({ ok: true })
      }
      case 'markTest': {
        const v = b.test ? 'yes' : 'no'
        await q1(`UPDATE ${T} SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{_test}', to_jsonb($1::text)), updated_at = NOW(), last_updated_by = $2,
                    status = CASE WHEN status = 'test' AND $1 = 'no' THEN 'pending' ELSE status END WHERE id = $3`, [v, me, r.id])
        await note('note', b.test ? 'Marked as a test (hidden from the queue)' : 'Marked as a real query')
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e: any) {
    console.error('[admin/bo/queries] POST', e)
    return NextResponse.json({ error: 'Could not update the query' }, { status: 500 })
  }
}
