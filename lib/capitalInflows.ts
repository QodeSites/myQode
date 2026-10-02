// Zoho Capital Inflows (the form operations fill in for every payment received, Razorpay included) → the app's
// "Payment received" notification and "On its way" card, via a received_payments row (source 'zoho').
// Rules (agreed with the business):
//   - only a Verified inflow counts; one that stops being Verified, or is deleted, is cancelled
//   - received time: the record's Created_Time when it was logged on its Date_of_Receipt, else that date after 4 pm
//     (never promises the client a date too early); then lib/investTimeline.ts works out invested / visible dates
//   - a Razorpay payment (or a cheque recorded in /admin → Payments) for the same account and amount around that
//     date already covers it, so nothing is added and the client never sees it twice
//   - only money still on its way becomes a row (a backfill never announces money that's already in the portfolio)
//   - the strategy split comes from the inflow's Scheme Clarification (verified), else its Execution Order
// The "Payment received" notification itself is sent by the normal money scan (lib/appNotifyTriggers.ts).
import { query } from '@/lib/db'
import { investTimeline } from '@/lib/investTimeline'
import { inPortfolio } from '@/lib/paymentProgress'
import { notifyAccounts, notifyEmails } from '@/lib/appNotify'
import { dayMonth, shortDate, timelineText, timelineDoneText, receivedNote } from '@/lib/investTimeline'

const NAMES: Record<string, string> = { QAW: 'Qode All Weather', QGF: 'Qode Growth Fund', QTF: 'Qode Tactical Fund', QLF: 'Qode Liquid Fund' }
const n = (v: unknown) => Number(v) || 0
const lakh = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, '')} crore` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, '')} lakh` : '₹' + Math.round(v).toLocaleString('en-IN'))

function receivedAt(r: any): Date | null {
  const day = String(r.Date_of_Receipt || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const created = r.Created_Time ? new Date(r.Created_Time) : null
  const createdDay = created ? new Date(created.getTime() + 330 * 60000).toISOString().slice(0, 10) : ''
  return created && createdDay === day ? created : new Date(`${day}T16:30:00+05:30`)   // logged later: treat as after 4 pm
}

// The strategies the money goes into. The account on the form isn't always the destination (a QTF entry can be
// invested in QAW), so the Execution Order decides. One order can cover several inflows, so its amounts are shown
// only when they add up to this inflow; otherwise just the strategy names.
// "A, B and C"
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '')
// "Your ₹5 lakh is going into Qode Growth Fund" / "It will be invested by Tue 6 Oct. Nothing more to do."
// A split across strategies lists the parts in the body.
function allocationNote(amount: number, s: { label: string; parts: { code: string; amount: number }[] }, timeline: string) {
  const multi = s.parts.length > 1 && s.parts.every(p => p.amount > 0)
  return multi
    ? { title: `Your ${lakh(amount)} is going into ${s.parts.length} strategies`, body: `${andList(s.parts.map(p => `${lakh(p.amount)} into ${NAMES[p.code]}`))}. ${timeline} Nothing more to do.` }
    : { title: `Your ${lakh(amount)} is going into ${s.label}`, body: `${timeline} Nothing more to do.` }
}

function split(eo: any, amount: number): { label: string; parts: { code: string; amount: number }[] } | null {
  if (!eo) return null
  const parts = ['QAW', 'QGF', 'QTF', 'QLF'].map(code => ({ code, amount: n(eo[`${code}_Amount`]) })).filter(p => p.amount > 0)
  if (!parts.length) return null
  const total = parts.reduce((t, p) => t + p.amount, 0)
  const matches = Math.abs(total - amount) <= Math.max(1, amount * 0.01)
  // read as a sentence: "Qode All Weather (₹3 lakh) and Qode Growth Fund (₹2 lakh)"; amounts only when they add up
  const label = parts.length === 1 ? NAMES[parts[0].code]
    : andList(parts.map(p => (matches ? `${NAMES[p.code]} (${lakh(p.amount)})` : NAMES[p.code])))
  return { parts: matches ? parts : parts.map(p => ({ code: p.code, amount: 0 })), label }
}

export async function applyCapitalInflows(ids: string[], opts: { dryRun?: boolean } = {}): Promise<{ added: number; updated: number; cancelled: number; skipped: number; reasons?: Record<string, number> }> {
  const out: any = { added: 0, updated: 0, cancelled: 0, skipped: 0, reasons: {} }
  const why = (k: string) => { out.skipped++; out.reasons[k] = (out.reasons[k] || 0) + 1 }
  const dry = !!opts.dryRun
  for (const id of ids) {
    try {
      const m = (await query(`SELECT data, deleted FROM zoho_mirror WHERE module = 'Capital_Inflows' AND id = $1`, [id])).rows[0]
      const orderId = `zoho_${id}`
      const existing = (await query(`SELECT order_id, status FROM received_payments WHERE order_id = $1`, [orderId])).rows[0]
      const r = m?.data
      const account = String(r?.Nuvama_ID_Entry || '').trim().toUpperCase()
      const amount = n(r?.Amount_Received)
      const valid = !!r && !m.deleted && r.Verification_Status === 'Verified' && /^Q[A-Z]{2}/.test(account) && amount > 0
        && (r.Confirm_Amount_Received == null || n(r.Confirm_Amount_Received) === amount)
      if (!valid) {
        if (existing && existing.status !== 'cancelled') {
          if (!dry) await query(`UPDATE received_payments SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1`, [orderId]); out.cancelled++
        } else why(!r ? 'not in mirror' : m.deleted ? 'deleted' : r.Verification_Status !== 'Verified' ? 'not verified' : 'no account or amount')
        continue
      }
      const at = receivedAt(r)
      if (!at) { why('no receipt date'); continue }
      const t = await investTimeline(at, at)
      const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

      // Already covered by a Razorpay payment or an admin-recorded cheque/transfer (same account, amount, ±3 days)?
      const covered = (await query(
        `SELECT order_id FROM payment_transactions
          WHERE nuvama_code = $1 AND abs(amount - $2) <= greatest(1, $2 * 0.01) AND investment_status IN ('PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED')
            AND coalesce(payment_time, created_at) BETWEEN ($3::date - 3) AND ($3::date + 2)
         UNION ALL
         SELECT order_id FROM received_payments
          WHERE source = 'manual' AND status <> 'cancelled' AND account_id = $1 AND abs(amount - $2) <= greatest(1, $2 * 0.01)
            AND received_at BETWEEN ($3::date - 3) AND ($3::date + 2) LIMIT 1`,
        [account, amount, t.countsFrom])).rows[0]
      if (covered) { why('covered by Razorpay / admin entry'); continue }

      // The split: the inflow's own Scheme Clarification (verified) first, else its Execution Order
      const sc = (await query(`SELECT data FROM zoho_mirror WHERE module = 'Scheme_Clarifications' AND NOT deleted AND data->'Capital_Inflow'->>'id' = $1 AND data->>'Verification_Status' = 'Verified' ORDER BY modified_time DESC LIMIT 1`, [id])).rows[0]?.data
      const eo = sc ? null : (await query(`SELECT data FROM zoho_mirror WHERE module = 'Execution_Orders' AND NOT deleted AND data->'Capital_Inflow'->>'id' = $1 ORDER BY modified_time DESC LIMIT 1`, [id])).rows[0]?.data
      const s = split(sc || eo, amount)
      const acct = (await query(`SELECT trim(clientname) AS name FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`, [account])).rows[0]
      const label = s?.label || 'Allocation being confirmed'   // no execution order yet: don't guess from the account code

      if (existing) {
        if (!dry) await query(
          `UPDATE received_payments SET account_id = $2, amount = $3, received_at = $4, label = $5, split = $6::jsonb,
                  status = 'on_its_way', updated_at = CASE WHEN status = 'cancelled' OR amount <> $3 OR received_at <> $4 THEN NOW() ELSE updated_at END
            WHERE order_id = $1`, [orderId, account, amount, at.toISOString(), label, JSON.stringify(s?.parts || null)])
        out.updated++
        continue
      }
      // New: only if it's still on its way (never announce money that is already in the portfolio)
      if (t.visibleOn < today) { why('already due in the portfolio'); continue }
      if (await inPortfolio(account, amount, t.countsFrom)) { why('already in the portfolio'); continue }
      if (!dry) await query(
        `INSERT INTO received_payments (order_id, source, zoho_id, account_id, client_name, amount, received_at, label, split, channel, reference)
         VALUES ($1, 'zoho', $2, $3, $4, $5, $6, $7, $8::jsonb, 'zoho', $9) ON CONFLICT (order_id) DO NOTHING`,
        [orderId, id, account, acct?.name || null, amount, at.toISOString(), label, JSON.stringify(s?.parts || null), r.Inflow_Sequence_Number ? `Inflow #${r.Inflow_Sequence_Number}` : null])
      out.added++
    } catch (e) {
      console.error('[capitalInflows]', id, (e as Error).message)
      why('error: ' + (e as Error).message.slice(0, 60))
    }
  }
  return out
}

/**
 * Scheme Clarification verified → "Allocation confirmed" for the client, once per record, only while the money is
 * still on its way. (The Capital Inflow's own "Payment received" is sent by the money scan from its payment row.)
 */
export async function notifyAllocations(ids: string[]): Promise<number> {
  let sent = 0
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
  for (const id of ids) {
    try {
      const sc = (await query(`SELECT data FROM zoho_mirror WHERE module = 'Scheme_Clarifications' AND id = $1 AND NOT deleted`, [id])).rows[0]?.data
      if (!sc || sc.Verification_Status !== 'Verified' || !sc.Capital_Inflow?.id) continue
      const ci = (await query(`SELECT data FROM zoho_mirror WHERE module = 'Capital_Inflows' AND id = $1 AND NOT deleted`, [String(sc.Capital_Inflow.id)])).rows[0]?.data
      if (!ci || ci.Verification_Status !== 'Verified') continue
      const account = String(ci.Nuvama_ID_Entry || '').trim().toUpperCase()
      const amount = n(ci.Amount_Received)
      const at = receivedAt(ci)
      if (!/^Q[A-Z]{2}/.test(account) || !(amount > 0) || !at) continue
      const t = await investTimeline(at, at)
      if (t.visibleOn < today) continue                    // old entry: already in (or due in) the portfolio
      const s = split(sc, amount)
      if (!s) continue
      // One message, not two: when the client's "We've received your …" for this inflow already names the strategy
      // (sent, or about to be sent from a payment row that carries it), this note would only repeat it.
      const ciId = String(sc.Capital_Inflow.id)
      const got = (await query(`SELECT body FROM app_notifications WHERE dedupe_key = $1 LIMIT 1`, [`pay:zoho_${ciId}:received`])).rows[0]
      const row = got ? null : (await query(`SELECT label FROM received_payments WHERE order_id = $1`, [`zoho_${ciId}`])).rows[0]
      if (got ? String(got.body || '').includes(`For ${s.label}.`) : row?.label === s.label) continue
      const note = { category: 'money' as const, dedupeKey: `zoho-sc:${id}`, link: 'tab:home',
        ...allocationNote(amount, s, `It will be invested by ${shortDate(t.deployOn)}.`) }
      const w = await notifyAccounts([account], note)
      sent += w
      await copyToAdmins(account, note, w)
    } catch (e) { console.error('[capitalInflows] notifyAllocations', id, (e as Error).message) }
  }
  return sent
}

/**
 * One-off: put the last `days` of money into clients' in-app panels, dated when it happened. Uses the same dedupe
 * keys as the live notifications, so running it again (or the live sync afterwards) never repeats an entry.
 * Popups follow the usual rule (held until PUSH_LIVE), so a backfill never buzzes a phone.
 */
export async function backfillInbox(days = 7): Promise<{ received: number; allocations: number; razorpay: number }> {
  const out = { received: 0, allocations: 0, razorpay: 0 }
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
  const tense = (t: { deployOn: string; visibleOn: string }) => (today >= t.visibleOn ? timelineDoneText(t) : timelineText(t))

  const inflows = (await query(`SELECT id, data FROM zoho_mirror WHERE module = 'Capital_Inflows' AND NOT deleted AND data->>'Verification_Status' = 'Verified'
                                  AND (data->>'Date_of_Receipt')::date >= CURRENT_DATE - $1::int`, [days])).rows
  for (const { id, data: r } of inflows) {
    const account = String(r.Nuvama_ID_Entry || '').trim().toUpperCase(), amount = n(r.Amount_Received), at = receivedAt(r)
    if (!/^Q[A-Z]{2}/.test(account) || !(amount > 0) || !at) continue
    const t = await investTimeline(at, at)
    // a Razorpay payment is announced from Razorpay (below), under its own key
    const rz = (await query(`SELECT 1 FROM payment_transactions WHERE nuvama_code = $1 AND abs(amount - $2) <= greatest(1, $2 * 0.01)
                               AND investment_status IN ('PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED') AND coalesce(payment_time, created_at) BETWEEN ($3::date - 3) AND ($3::date + 2) LIMIT 1`,
      [account, amount, t.countsFrom])).rows.length
    if (rz) continue
    const sc = (await query(`SELECT data FROM zoho_mirror WHERE module = 'Scheme_Clarifications' AND NOT deleted AND data->'Capital_Inflow'->>'id' = $1 AND data->>'Verification_Status' = 'Verified' LIMIT 1`, [id])).rows[0]?.data
    const eo = sc ? null : (await query(`SELECT data FROM zoho_mirror WHERE module = 'Execution_Orders' AND NOT deleted AND data->'Capital_Inflow'->>'id' = $1 LIMIT 1`, [id])).rows[0]?.data
    const s = split(sc || eo, amount)
    const where = s?.label || 'your Qode portfolio'
    out.received += await notifyAccounts([account], { category: 'money', dedupeKey: `pay:zoho_${id}:received`, link: 'tab:home', at,
      ...receivedNote(lakh(amount), where, tense(t)) })
    if (sc && s) {
      const scAt = sc.Created_Time ? new Date(sc.Created_Time) : at
      const scId = (await query(`SELECT id FROM zoho_mirror WHERE module = 'Scheme_Clarifications' AND data->'Capital_Inflow'->>'id' = $1 LIMIT 1`, [id])).rows[0]?.id
      if (scId && where !== s.label) out.allocations += await notifyAccounts([account], { category: 'money', dedupeKey: `zoho-sc:${scId}`, link: 'tab:home', at: scAt,
        ...allocationNote(amount, s, tense(t)) })
    }
  }
  // Razorpay payments of the same week
  const rows = (await query(`SELECT p.order_id, p.nuvama_code, p.amount, coalesce(p.payment_time, p.created_at) AS paid, p.settled_at, m.schemename
                               FROM payment_transactions p LEFT JOIN pms_clients_master m ON m.clientcode = p.nuvama_code
                              WHERE p.investment_status IN ('PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED') AND p.payment_type IN ('ONE_TIME', 'NEW_STRATEGY')
                                AND coalesce(p.payment_time, p.created_at) >= NOW() - ($1::int * interval '1 day')`, [days])).rows
  for (const p of rows) {
    const t = await investTimeline(p.paid, p.settled_at)
    const strat = String(p.schemename || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()) || 'your Qode portfolio'
    out.razorpay += await notifyAccounts([p.nuvama_code], { category: 'money', dedupeKey: `pay:${p.order_id}:received`, link: 'tab:home', at: p.paid,
      ...receivedNote(lakh(n(p.amount)), strat, tense(t)) })
  }
  return out
}

// ── Admin alerts: a popup to the team for every new Capital Inflow / Scheme Clarification, whatever its status ────
// Recipients: the app admins, APP_ADMIN_EMAILS (the logins that sign in to the app's admin mode). Sent regardless of
// PUSH_LIVE (force). Only records created in the last day count, so edits to old records stay quiet; the dedupe key
// makes it one alert per record.
const adminAlertEmails = () => String(process.env.APP_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const nameOf = (v: any) => String((v && typeof v === 'object' ? v.name : v) || '').replace(/\s+/g, ' ').trim()
const shortDay = (d: string) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? shortDate(`${m[1]}-${m[2]}-${m[3]}`) : '' }
// "Kusum Rajendra Dalal" → "Kusum Dalal" (first and last name, no title), so the client fits on the first line
const shortName = (v: string) => {
  const w = String(v || '').replace(/\s+/g, ' ').trim().replace(/^(mr|mrs|ms|miss|dr|shri|smt)\.?\s+/i, '').split(' ').filter(Boolean)
  return w.length > 2 ? `${w[0]} ${w[w.length - 1]}` : w.join(' ')
}
const whoText = (name: string, account: string) => [shortName(name), account ? `(${account})` : ''].filter(Boolean).join(' ') || 'Unknown client'
const zohoStatus = (v: any) => { const st = String(v || '').trim(); return !st ? '' : /^verified$/i.test(st) ? 'verified in Zoho' : `${st.toLowerCase()} in Zoho` }

export async function notifyAdminsOfNewRecords(changed: { Capital_Inflows?: any[]; Scheme_Clarifications?: any[] }): Promise<number> {
  const to = adminAlertEmails()
  if (!to.length) return 0
  const fresh = (r: any) => r?.Created_Time && Date.now() - new Date(r.Created_Time).getTime() < 86400000
  let sent = 0
  for (const r of (changed.Capital_Inflows || []).filter(fresh)) {
    try {
      const account = String(r.Nuvama_ID_Entry || '').trim().toUpperCase()
      const who = whoText(nameOf(r.Investor_Name), account)
      const bits = [`${lakh(n(r.Amount_Received))}${r.Date_of_Receipt ? ` on ${shortDay(r.Date_of_Receipt)}` : ''}`, zohoStatus(r.Verification_Status)]
      sent += await notifyEmails(to, { category: 'money', dedupeKey: `admin-zoho-ci:${r.id}`, link: 'tab:home', title: `Money received: ${who}`,
        body: bits.filter(Boolean).join(' · ') }, { force: true })
    } catch (e) { console.error('[capitalInflows] admin alert CI', r?.id, (e as Error).message) }
  }
  for (const r of (changed.Scheme_Clarifications || []).filter(fresh)) {
    try {
      const ci = r.Capital_Inflow?.id
        ? (await query(`SELECT data FROM zoho_mirror WHERE module = 'Capital_Inflows' AND id = $1`, [String(r.Capital_Inflow.id)])).rows[0]?.data : null
      const account = String(ci?.Nuvama_ID_Entry || '').trim().toUpperCase()
      const who = whoText(nameOf(r.Investor_Name) || nameOf(ci?.Investor_Name), account)
      const parts = ['QAW', 'QGF', 'QTF', 'QLF'].map(c => ({ c, a: n(r[`${c}_Amount`]) })).filter(p => p.a > 0)
      const alloc = parts.length ? parts.map(p => `${lakh(p.a)} → ${NAMES[p.c]}`).join(' + ') : lakh(n(r.Amount_Received))
      const verified = /^verified$/i.test(String(r.Verification_Status || '').trim())
      sent += await notifyEmails(to, { category: 'money', dedupeKey: `admin-zoho-sc:${r.id}`, link: 'tab:home',
        title: `${verified ? 'Strategy confirmed' : 'Strategy split received'}: ${who}`,
        body: [alloc, zohoStatus(r.Verification_Status)].filter(Boolean).join(' · ') }, { force: true })
    } catch (e) { console.error('[capitalInflows] admin alert SC', r?.id, (e as Error).message) }
  }
  return sent
}

/**
 * The client's own notification, copied to the admin list so the team sees exactly what the client saw: the client's
 * name and account first ("Kusum Dalal (QAW00162) · We've received your ₹5 lakh"), then the same text. Only when the client's copy was just written
 * (written > 0), so a repeat scan never sends it again.
 */
export async function copyToAdmins(account: string, note: Parameters<typeof notifyEmails>[1], written: number): Promise<number> {
  const to = adminAlertEmails()
  if (!written || !to.length) return 0
  try {
    const who = (await query(`SELECT trim(clientname) AS name FROM pms_clients_master WHERE clientcode = $1 LIMIT 1`, [account])).rows[0]?.name
    return await notifyEmails(to, { ...note, dedupeKey: `admin-copy:${note.dedupeKey}`, title: `${whoText(who || '', account)} · ${note.title}` }, { force: true })
  } catch (e) { console.error('[capitalInflows] copyToAdmins', account, (e as Error).message); return 0 }
}
