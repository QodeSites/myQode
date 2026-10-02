// Admin → Payments: cheques and direct bank transfers, recorded by operations when the money arrives, so those
// clients get the same "Payment received" notification and "On its way" card (with the dates) as Razorpay payers.
// A recorded payment is a received_payments row (source 'manual'); Zoho Capital Inflows land in the same table
// (source 'zoho', lib/capitalInflows.ts) and are listed here too. Neither ever emails the client.
//
// GET    (staff)  ?q=…            → { accounts: [...] } matching the search (for the form), when q is given
// GET    (staff)                  → { recent: [...] } recorded in the last 60 days, with where each one is now
// POST   (super)  { accountId, amount, receivedAt, channel, reference?, notify?, dryRun? }
//                                  → dryRun: { timeline }; else { orderId, timeline, notified }
// DELETE (super)  ?orderId=…      → marks a mistaken entry CANCELLED (the row is kept for the record)
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { query } from '@/lib/db'
import { investTimeline, shortDate, timelineText, receivedNote } from '@/lib/investTimeline'
import { inPortfolio } from '@/lib/paymentProgress'
import { notifyEmails, recipientsForAccounts } from '@/lib/appNotify'

export const dynamic = 'force-dynamic'
const CHANNELS = ['cheque', 'neft', 'rtgs', 'imps', 'upi']
const strategy = (s: unknown) => String(s || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()
const inr = (n: number) => { const a = Math.abs(n); return a >= 1e7 ? `₹${(a / 1e7).toFixed(2).replace(/\.?0+$/, '')} crore` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2).replace(/\.?0+$/, '')} lakh` : '₹' + Math.round(a).toLocaleString('en-IN') }

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  try {
    if (q) {
      const r = await query(
        `SELECT clientcode, clientid, trim(clientname) AS name, lower(trim(email)) AS email, schemename
           FROM pms_clients_master
          WHERE clientcode IS NOT NULL AND clientcode !~* '^QLF' AND (maturity_date IS NULL OR maturity_date > NOW())
            AND (clientcode ILIKE $1 OR clientname ILIKE $1 OR email ILIKE $1 OR pannumber ILIKE $2)
          ORDER BY clientname, clientcode LIMIT 25`, [`%${q}%`, q])
      return NextResponse.json({ accounts: r.rows.map((x: any) => ({ accountId: x.clientcode, name: x.name, email: x.email, strategy: strategy(x.schemename) })) })
    }
    const r = await query(
      `SELECT order_id, source, account_id, client_name, amount, received_at, label, channel, reference, recorded_by, status, created_at
         FROM received_payments WHERE created_at > NOW() - interval '60 days' ORDER BY received_at DESC LIMIT 150`)
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
    const recent = await Promise.all(r.rows.map(async (x: any) => {
      const t = await investTimeline(x.received_at, x.received_at)
      const done = x.status !== 'cancelled' && await inPortfolio(x.account_id, Number(x.amount), t.countsFrom)
      const state = x.status === 'cancelled' ? 'cancelled' : done ? 'in_portfolio' : today > t.visibleOn ? 'late' : 'on_its_way'
      return { orderId: x.order_id, source: x.source === 'zoho' ? 'Zoho' : 'Admin', accountId: x.account_id, name: x.client_name, strategy: x.label || '',
        amount: Number(x.amount), receivedAt: x.received_at, channel: x.channel, reference: x.reference,
        recordedBy: x.recorded_by || (x.source === 'zoho' ? 'Zoho Capital Inflows' : null), recordedAt: x.created_at, deployOn: t.deployOn, visibleOn: t.visibleOn, state }
    }))
    const { syncStatus } = await import('@/lib/zohoService')
    return NextResponse.json({ recent, zoho: await syncStatus().catch(() => null) })
  } catch (err) {
    console.error('[admin/bo/payments GET]', err)
    return NextResponse.json({ error: 'Could not load' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  let b: any = {}
  try { b = await req.json() } catch {}
  const accountId = String(b?.accountId || '').trim().toUpperCase()
  const amount = Math.round(Number(b?.amount) * 100) / 100
  const channel = String(b?.channel || '').toLowerCase()
  const reference = String(b?.reference || '').trim().slice(0, 60) || null
  const receivedAt = new Date(String(b?.receivedAt || ''))
  if (!accountId) return NextResponse.json({ error: 'Choose the client account' }, { status: 400 })
  if (!(amount >= 1000) || amount > 1e10) return NextResponse.json({ error: 'Enter the amount received (at least ₹1,000)' }, { status: 400 })
  if (!CHANNELS.includes(channel)) return NextResponse.json({ error: 'Choose how the money came in' }, { status: 400 })
  if (isNaN(receivedAt.getTime())) return NextResponse.json({ error: 'Enter when the money was received' }, { status: 400 })
  if (receivedAt.getTime() > Date.now() + 5 * 60000) return NextResponse.json({ error: 'The received time is in the future' }, { status: 400 })
  if (receivedAt.getTime() < Date.now() - 20 * 86400000) return NextResponse.json({ error: 'That is more than 20 days ago; it should already be in the portfolio' }, { status: 400 })

  try {
    const acct = (await query(
      `SELECT clientcode, trim(clientname) AS name, schemename FROM pms_clients_master
        WHERE clientcode = $1 AND (maturity_date IS NULL OR maturity_date > NOW()) LIMIT 1`, [accountId])).rows[0]
    if (!acct) return NextResponse.json({ error: 'That account was not found or is closed' }, { status: 404 })
    const timeline = await investTimeline(receivedAt, receivedAt)
    if (b?.dryRun) return NextResponse.json({ timeline, deployLabel: shortDate(timeline.deployOn), visibleLabel: shortDate(timeline.visibleOn), text: timelineText(timeline) })

    // Same payment already recorded here, or already in Zoho's Capital Inflows (same account and amount, ±3 days)?
    const dup = (await query(
      `SELECT order_id, source FROM received_payments WHERE account_id = $1 AND abs(amount - $2) <= greatest(1, $2 * 0.01) AND status <> 'cancelled'
          AND (($3::text IS NOT NULL AND reference = $3) OR abs(extract(epoch FROM received_at - $4::timestamptz)) < 3 * 86400) LIMIT 1`,
      [accountId, amount, reference, receivedAt.toISOString()])).rows[0]
    if (dup && !b?.confirmDuplicate) return NextResponse.json({ error: dup.source === 'zoho' ? 'This is already in Zoho (Capital Inflows) and synced.' : 'This looks already recorded (same account and amount).', code: 'DUPLICATE', orderId: dup.order_id }, { status: 409 })

    const orderId = `manual_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
    await query(
      `INSERT INTO received_payments (order_id, source, account_id, client_name, amount, received_at, label, channel, reference, recorded_by)
       VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orderId, accountId, acct.name, amount, receivedAt.toISOString(), strategy(acct.schemename), channel, reference, admin!.email])

    // Tell the client now (an explicit admin action, so it doesn't wait for PUSH_LIVE). The same dedupe key as the
    // automatic scan, so they never get it twice.
    let notified = 0
    if (b?.notify !== false) {
      const strat = strategy(acct.schemename) || 'your'
      notified = await notifyEmails(await recipientsForAccounts([accountId]), {
        category: 'money', dedupeKey: `pay:${orderId}:received`, link: 'tab:home',
        ...receivedNote(inr(amount), strat, timelineText(timeline)),
      }, { force: true })
    }
    await audit(req, admin!, 'payments.record', accountId, { orderId, amount, channel, reference, receivedAt: receivedAt.toISOString(), notified })
    return NextResponse.json({ orderId, timeline, notified })
  } catch (err) {
    console.error('[admin/bo/payments POST]', err)
    return NextResponse.json({ error: 'Could not record the payment' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const orderId = req.nextUrl.searchParams.get('orderId') || ''
  if (!orderId.startsWith('manual_')) return NextResponse.json({ error: 'Only recorded cheques and transfers can be cancelled here' }, { status: 400 })
  try {
    const r = await query(`UPDATE received_payments SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1 AND source = 'manual' RETURNING account_id AS nuvama_code, amount`, [orderId])
    if (!r.rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await audit(req, admin!, 'payments.cancel', r.rows[0].nuvama_code, { orderId, amount: Number(r.rows[0].amount) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/bo/payments DELETE]', err)
    return NextResponse.json({ error: 'Could not cancel' }, { status: 500 })
  }
}

