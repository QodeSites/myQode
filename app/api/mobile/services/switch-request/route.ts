// Strategy switch requests, mirroring the Zoho Forms / CRM flow (automation.process_switch_form_submission +
// validation_rule.validate_switch_amounts_balance / validate_no_overlap_from_to):
//
//   GET  /api/mobile/services/switch-request
//        → every Investor record on the login email (family logins have one per member): legal name,
//          QAW/QTF/QGF/QLF invested, and that investor's Pending requests (date, type, from → to)
//   POST /api/mobile/services/switch-request
//        investorId (one of the GET list; optional when there is only one), plus
//        Full:    { switchType: 'Full Switch',    from: ['QAW', …], to: ['QTF', …] }
//        Partial: { switchType: 'Partial Switch', fromAmounts: { QAW: n, … }, toAmounts: { QTF: n, … } }
//        → creates a Switch Plan in Zoho (module Liquid_Fund_Holdings, Plan Origin "myQode App", Verification Pending,
//          Owner = the investor's RM; lib/switchPlan.ts). Investor Relations verifies it and Zoho's automation raises the
//          switch request from it. Until 12 Oct 2026 the app created the Strategy_Switch_Requests record directly.
//
// Rules applied exactly as in Zoho: a strategy cannot be on both sides; Partial: total out = total in and each
// From amount ≤ that strategy's invested value; Full: at least one From and one To.
// In progress: Zoho's own rule (validation_rule.lfh_validate_confirmations, mirrored in lib/switchPlan.ts liveConflict,
// 13 Oct 2026): against the investor's LIVE (Active) plans, a request is refused only when a full switch out of the same
// strategy is live on either side, or a live plan already moves that strategy into one of its targets. A second partial
// switch out of a strategy into a different target goes through, as it does in the CRM.
// The investor is identified by the verified JWT email (same lookup the Zoho automation falls back to).
// Notifications (WhatsApp to the RM) stay in Zoho — put them on a CRM workflow for record creation; this route
// sends nothing. In development (NODE_ENV !== 'production') the record is NOT created (dry run) so test logins
// with real clients never leave a Pending request in the CRM.
// SWITCH_REQUEST_LIVE=1 on a dev server creates the plan exactly as production does, workflows included (decided
// 12 Oct 2026); SWITCH_REQUEST_TRIGGERS=0 suppresses the workflows for a quiet test. Delete test plans from the CRM
// afterwards (they block the investor with "request in progress" until then).
import { internalMailHeaders } from '@/lib/webSession'
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { sendClientAck, clientName } from '@/lib/mobileAckMail'
import { hasZohoWriteToken, zohoApiDomain, zohoFetch } from '@/lib/zoho'
import { irRecipient, irSubject, IR_EMAIL } from '@/lib/mobileIrMail'
import { buildPlanRecord, createPlan, openPlans, liveConflict, liveBlocks } from '@/lib/switchPlan'
import { requestChannel, submittedVia, internalBase } from '@/lib/requestChannel'

const STRATS = ['QAW', 'QTF', 'QGF', 'QLF'] as const   // Qode Liquid Fund: switched like every strategy (Zoho has QLF_* fields)
type Strat = typeof STRATS[number]
const n = (v: unknown) => { const x = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(x) ? x : 0 }
const rs = (v: number) => 'Rs.' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
// Money to the paisa: Zoho's currency fields refuse more decimals ("invalid data"), and the app's split arithmetic
// (total − the others) gives values like 1258837.8300000001 (12 Oct 2026: one strategy into two failed with 502).
const r2 = (v: number) => Math.round(v * 100) / 100
const IS_PROD = process.env.NODE_ENV === 'production'
const LIVE = IS_PROD || process.env.SWITCH_REQUEST_LIVE === '1'   // create the CRM record?
const DRY_RUN = !LIVE

// Reads use the app's read-only token; creating the switch record uses the create-only one (lib/zoho.ts).
async function zoho(path: string, init?: RequestInit) {
  const writes = (init?.method || 'GET').toUpperCase() !== 'GET'
  const res = await zohoFetch(`${zohoApiDomain()}/crm/v2/${path}`, {
    ...init, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  }, { write: writes })
  if (res.status === 204) return null
  const body: any = await res.json().catch(() => null)
  if (!res.ok) {
    console.error('[switch-request] Zoho refused', path, JSON.stringify(body?.data?.[0] || body).slice(0, 500))
    const d = body?.data?.[0]
    throw new Error((d?.message || body?.message || `Zoho ${path} failed (${res.status})`) + (d?.details?.api_name ? ` (${d.details.api_name})` : ''))
  }
  // A create that Zoho accepts as a call but refuses for the record comes back 2xx with data[0].status 'error'.
  const d0 = body?.data?.[0]
  if (writes && d0 && d0.status === 'error') {
    console.error('[switch-request] Zoho refused the record', JSON.stringify(d0).slice(0, 500))
    throw new Error((d0.message || 'invalid data') + (d0.details?.api_name ? ` (${d0.details.api_name})` : ''))
  }
  return body
}

// Every Investor record on this email — a family login (one email, several people) gets one per member.
async function findInvestors(email: string): Promise<any[]> {
  const key = email.trim().toLowerCase()
  if (!key) return []
  const body = await zoho(`Investors/search?email=${encodeURIComponent(key)}&fields=Name,Legal_Name,Email,Mobile_No,QAW_Invested,QTF_Invested,QGF_Invested,QLF_Invested,Owner&per_page=50`)
  return body?.data || []
}


// Investor Relations email for a switch request — the web's account-services page sends this same
// "New Switch/Reallocation Request" to IR (inquiry_type 'switch'). Sent in production, or on a dev server when
// MOBILE_IR_EMAIL_OVERRIDE points it at the testers; never from a dev server to the real IR inbox.
// plan: the Switch Plan created — then the row is only recorded (record_only), with the plan's id and number for the
// app's request tracking, and no email goes from here: Zoho's workflow on the plan notifies the team and the client.
async function emailIrSwitch(user: any, view: any, isFull: boolean, fromList: string[], toList: string[], fromAmt: (s: any) => number, toAmt: (s: any) => number, requestId: string | null, dryRun: boolean, splitNote = '', plan: { id: string; no: string | null } | null = null) {
  if (!plan && !IS_PROD && !(process.env.MOBILE_IR_EMAIL_OVERRIDE || '').trim()) return
  const rows = isFull
    ? `<p><strong>Switch From:</strong> ${fromList.join(', ')} (everything)</p><p><strong>Switch To:</strong> ${toList.map((s) => `${s} ${rs(toAmt(s))}`).join(', ')}</p>${splitNote ? `<p><strong>Note:</strong> ${splitNote}</p>` : ''}`
    : `<p><strong>Moving out:</strong> ${fromList.map((s) => `${s} ${rs(fromAmt(s))}`).join(', ')}</p><p><strong>Moving in:</strong> ${toList.map((s) => `${s} ${rs(toAmt(s))}`).join(', ')}</p>`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
      <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
        <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Switch / Reallocation Request</h1>
      </div>
      <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
        <p><strong>Submitted via:</strong> ${submittedVia(user.channel)}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
          <p><strong>Investor:</strong> ${view.legalName}</p>
          <p><strong>User Email:</strong> ${user.email}</p>
          <p><strong>Switch Type:</strong> ${isFull ? 'Full Switch' : 'Partial Switch'}</p>
          ${rows}
          <p><strong>Zoho request:</strong> ${requestId ?? (dryRun ? 'not created (dry run on a test server)' : '—')}</p>
        </div>
      </div>
    </div>`
  try {
    const base = internalBase()
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST', headers: internalMailHeaders(user?.email),
      body: JSON.stringify({
        to: irRecipient(), subject: irSubject(`New Switch/Reallocation Request from ${view.legalName}`), html,
        from: IR_EMAIL, fromName: 'Qode Investor Relations', inquiry_type: 'switch',
        nuvama_code: (user.accountCodes || []).find((c: string) => /^Q/.test(c)) || user.clientCode || 'MOBILE',
        client_id: user.clientId || '', user_email: user.email, priority: 'normal',
        switch_type: isFull ? 'Full Switch' : 'Partial Switch', switch_from: fromList, switch_to: toList, zoho_request_id: requestId,
        zoho_plan_id: plan?.id ?? null, zoho_plan_no: plan?.no ?? null, record_only: !!plan, channel: user.channel ?? null,
      }),
    })
    if (!res.ok) console.warn('[switch-request] IR email answered', res.status)
  } catch (err) { console.warn('[switch-request] IR email failed:', (err as any)?.message) }
}

const investorView = (inv: any) => ({
  id: String(inv.id), legalName: String(inv.Legal_Name || inv.Name || ''),
  invested: { QAW: n(inv.QAW_Invested), QTF: n(inv.QTF_Invested), QGF: n(inv.QGF_Invested), QLF: n(inv.QLF_Invested) },
})

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ investors: [] })
  // Zoho now and then refuses a call for a moment (rate limit, token refresh): try once more before saying so
  const twice = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn() } catch (e: any) {
      console.warn('[mobile/services/switch-request GET] Zoho refused, retrying once -', e?.message)
      await new Promise(r => setTimeout(r, 1500))
      return fn()
    }
  }
  try {
    const list = await twice(() => findInvestors(user!.email))
    if (!list.length) return NextResponse.json({ investors: [], message: 'We could not find your investor record. Please contact Investor Relations.' })
    const ids = list.map((inv) => String(inv.id))
    // the plans already in progress (shown on the form, and what Zoho's duplicate rule checks). Not being able to read
    // them must not stop the form: Zoho checks every new plan again when it is saved.
    const plans = await openPlans(ids).catch((e: any) => { console.error('[mobile/services/switch-request GET] plans not read -', e?.message); return {} as Record<string, any[]> })
    const investors = list.map((inv) => {
      const mine = plans[String(inv.id)] || []
      // pending: the plans in progress (shown on the form); blockedFrom / blockedPairs: what Zoho's rule refuses
      return { ...investorView(inv), pending: mine, ...liveBlocks(mine) }
    })
    return NextResponse.json({ investors, dryRun: DRY_RUN })
  } catch (err: any) {
    console.error('[mobile/services/switch-request GET]', err)
    return NextResponse.json({ error: 'Switch requests are unavailable right now. Please try again later.' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ error: 'Not available for the reviewer account' }, { status: 403 })
  ;(user as any).channel = requestChannel(request)   // Web / App, for the email and the tracking row

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const isFull = String(body?.switchType || '') === 'Full Switch'
  const fromList: Strat[] = STRATS.filter((s) => (isFull ? (body?.from || []).includes(s) : n(body?.fromAmounts?.[s]) > 0))
  const toList: Strat[] = STRATS.filter((s) => (isFull ? (body?.to || []).includes(s) : n(body?.toAmounts?.[s]) > 0))
  const fromAmt = (s: Strat) => (isFull ? 0 : r2(n(body?.fromAmounts?.[s])))
  // Full: the To amounts are set once the invested values are known (below); Partial: as sent, to the paisa.
  let toAmt = (s: Strat) => (isFull ? 0 : r2(n(body?.toAmounts?.[s])))
  let splitNote = ''

  // validate_no_overlap_from_to
  const overlap = STRATS.filter((s) => fromList.includes(s) && toList.includes(s))
  if (overlap.length) return NextResponse.json({ error: `A strategy cannot appear on both the From and To side of the same request. Please check: ${overlap.join(', ')}.` }, { status: 400 })
  if (!fromList.length) return NextResponse.json({ error: isFull ? 'Select at least one strategy to switch from.' : 'Enter at least one From amount.' }, { status: 400 })
  if (!toList.length) return NextResponse.json({ error: isFull ? 'Select at least one strategy to switch to.' : 'Enter at least one To amount.' }, { status: 400 })

  // validate_switch_amounts_balance (Partial only)
  if (!isFull) {
    const totalFrom = r2(fromList.reduce((t, s) => t + fromAmt(s), 0))
    let totalTo = r2(toList.reduce((t, s) => t + toAmt(s), 0))
    // Rounding to the paisa can leave a paisa or two between the sides: the last To amount takes it.
    if (totalFrom !== totalTo && Math.abs(totalFrom - totalTo) <= 0.05 && toList.length) {
      const last = toList[toList.length - 1], fixed = r2(totalFrom - toList.slice(0, -1).reduce((t, s) => t + toAmt(s), 0)), prev = toAmt
      toAmt = (s: Strat) => (s === last ? fixed : prev(s))
      totalTo = r2(toList.reduce((t, s) => t + toAmt(s), 0))
    }
    if (Math.abs(totalFrom - totalTo) > 0.005) {
      return NextResponse.json({ error: `The total amount moving out (${rs(totalFrom)}) must equal the total amount moving in (${rs(totalTo)}).` }, { status: 400 })
    }
  }

  try {
    const list = await findInvestors(user!.email)
    if (!list.length) return NextResponse.json({ error: 'We could not find your investor record. Please contact Investor Relations.' }, { status: 404 })
    // the chosen investor must be one of this login's own records
    const wanted = String(body?.investorId || '')
    const inv = (wanted && list.find((x) => String(x.id) === wanted)) || (list.length === 1 ? list[0] : null)
    if (!inv) return NextResponse.json({ error: 'Please choose the investor this switch is for.' }, { status: 400 })
    const investorId = String(inv.id)
    const view = investorView(inv)

    // One switch at a time (16 Oct 2026): while any plan of this investor is still in progress (not Fully Deployed,
    // Withdrawn or Merged) no new switch request is taken. The plans must be readable to decide that; if Zoho cannot be
    // read right now, the client is asked to try again rather than a second plan slipping through.
    let mine: any[]
    try { mine = (await openPlans([investorId]))[investorId] || [] }
    catch (e: any) {
      console.error('[mobile/services/switch-request] plans not read -', e?.message)
      return NextResponse.json({ error: 'We couldn’t check your switch requests in progress just now. Please try again in a minute.', code: 'PLANS_UNREADABLE' }, { status: 503 })
    }
    if (mine.length) {
      const p = mine[0]
      return NextResponse.json({ error: `A switch request${p.planNo ? ' (' + p.planNo + ')' : ''} is already in progress. Only one switch can be in progress at a time; you can raise a new one once it is completed.`, code: 'PENDING_EXISTS' }, { status: 409 })
    }
    // (Zoho's finer rule, liveConflict, is kept below as a second guard; with one plan at a time it does not fire.)
    const conflict = liveConflict({ from: fromList, fullFrom: isFull ? fromList : [], to: toList }, mine)
    if (conflict) return NextResponse.json({ error: conflict + ' Our team will reach out once it is processed.', code: 'PENDING_EXISTS' }, { status: 409 })

    // holdings check (Partial only), against the Investors record like Zoho does
    if (!isFull) {
      const over = fromList.filter((s) => fromAmt(s) > view.invested[s])
      if (over.length) {
        return NextResponse.json({ error: "One or more From amounts exceed the investor's current investment in that strategy. " + STRATS.map((s) => `${s} From: ${rs(fromAmt(s))} (Current: ${rs(view.invested[s])})`).join(' | ') + '.' }, { status: 400 })
      }
    }

    // Full Switch (12 Oct 2026): Zoho now needs the To amounts on a full switch too — they must add up to everything
    // moving out (the From strategies' invested values) or its workflow rejects the request. The investor's own split
    // is used when the app sends one; one target takes it all; several targets with no split are shared equally,
    // which IR is told to confirm with the investor.
    if (isFull) {
      const total = r2(fromList.reduce((t, s) => t + (view.invested[s] || 0), 0))
      const sent = toList.map((s) => r2(n(body?.toAmounts?.[s])))
      const amounts: Record<string, number> = {}
      if (toList.length === 1) amounts[toList[0]] = total
      else if (sent.every((x) => x > 0) && Math.abs(sent.reduce((a, b) => a + b, 0) - total) <= 1) {
        toList.forEach((s, i) => { amounts[s] = sent[i] })
        amounts[toList[toList.length - 1]] = r2(total - toList.slice(0, -1).reduce((t, s) => t + amounts[s], 0))
      } else {
        const each = r2(total / toList.length)
        toList.forEach((s) => { amounts[s] = each })
        amounts[toList[toList.length - 1]] = r2(total - each * (toList.length - 1))
        splitNote = 'Split equally between the strategies moving in; please confirm the split with the investor.'
      }
      toAmt = (s: Strat) => amounts[s] || 0
    }

    // The Switch Plan (lib/switchPlan.ts). On a full switch each source moves everything it holds.
    const record = buildPlanRecord({
      investor: { id: investorId, legalName: view.legalName, email: inv.Email || null, ownerId: inv.Owner?.id ? String(inv.Owner.id) : null },
      isFull, from: fromList, to: toList,
      fromAmt: (s) => (isFull ? view.invested[s] || 0 : fromAmt(s)), toAmt,
    })

    if (DRY_RUN) {
      console.log('[mobile/services/switch-request] DRY RUN (not production) — would create:', JSON.stringify(record))
      await emailIrSwitch(user, view, isFull, fromList, toList, fromAmt, toAmt, null, true, splitNote)
    await sendClientAck({
      to: user!.email, name: view.legalName, reference: null,
      subject: 'We’ve received your switch request', title: 'Switch request received',
      intro: `We’ve received your request to switch strategies for ${view.legalName}, raised from the myQode app.`,
      details: [['Switch type', isFull ? 'Full Switch' : 'Partial Switch'],
        ['Moving out of', isFull ? fromList.join(', ') : fromList.map((s) => `${s} ${rs(fromAmt(s))}`).join(', ')],
        ['Moving into', isFull ? toList.join(', ') : toList.map((s) => `${s} ${rs(toAmt(s))}`).join(', ')]],
      next: 'Your relationship manager will confirm the details with you before anything moves. You do not need to send this again.',
    })
      return NextResponse.json({ success: true, dryRun: true, requestId: null, investor: view, record })
    }
    // The plan's workflow rules run, as for a plan made in the CRM (SWITCH_REQUEST_TRIGGERS=0 turns them off for a test).
    const runWorkflows = process.env.SWITCH_REQUEST_TRIGGERS !== '0'
    if (!hasZohoWriteToken()) {
      console.error('[mobile/services/switch-request] ZOHO_CRM_WRITE_REFRESH_TOKEN is not set — the switch record cannot be created. Mint it via /api/auth/zoho/authorize?write=switch')
      return NextResponse.json({ error: 'Switch requests can’t be submitted from the app right now. Please contact Investor Relations, or try again later.', code: 'SWITCH_UNAVAILABLE' }, { status: 503 })
    }
    if (!IS_PROD) console.log('[mobile/services/switch-request] LIVE (SWITCH_REQUEST_LIVE=1) — creating the switch plan:', JSON.stringify(record))
    const id = await createPlan(record, runWorkflows)
    // recorded for tracking; Zoho's workflow on the plan sends the notifications (no email from here, 13 Oct 2026)
    await emailIrSwitch(user, view, isFull, fromList, toList, fromAmt, toAmt, String(id), false, splitNote, { id: String(id), no: null })
    // no acknowledgement from here either: Zoho's workflow on the plan writes to the client
    return NextResponse.json({ success: true, dryRun: false, requestId: String(id), investor: view })
  } catch (err: any) {
    console.error('[mobile/services/switch-request POST]', err)
    // never the raw cause on screen (it can name Zoho, tokens, field names): a plain message; the detail is in the log
    return NextResponse.json({ error: 'We couldn’t send your switch request just now. Please try again in a minute.', code: 'SWITCH_FAILED' }, { status: 502 })
  }
}
