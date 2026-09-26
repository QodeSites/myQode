// Strategy switch requests, mirroring the Zoho Forms / CRM flow (automation.process_switch_form_submission +
// validation_rule.validate_switch_amounts_balance / validate_no_overlap_from_to):
//
//   GET  /api/mobile/services/switch-request
//        → every Investor record on the login email (family logins have one per member): legal name,
//          QAW/QTF/QGF invested, and that investor's Pending requests (date, type, from → to)
//   POST /api/mobile/services/switch-request
//        investorId (one of the GET list; optional when there is only one), plus
//        Full:    { switchType: 'Full Switch',    from: ['QAW', …], to: ['QTF', …] }
//        Partial: { switchType: 'Partial Switch', fromAmounts: { QAW: n, … }, toAmounts: { QTF: n, … } }
//        → creates a Strategy_Switch_Requests record (Status Pending, Filled_By_Investor true, Owner = investor's owner)
//
// Rules applied exactly as in Zoho: a strategy cannot be on both sides; Partial: total out = total in and each
// From amount ≤ that strategy's invested value; Full: at least one From and one To.
// Pending requests: a new request is refused only when a Pending one already switches OUT of the same strategy
// (the same money can't be moved twice); a request out of a different strategy goes through.
// The investor is identified by the verified JWT email (same lookup the Zoho automation falls back to).
// Notifications (WhatsApp to the RM) stay in Zoho — put them on a CRM workflow for record creation; this route
// sends nothing. In development (NODE_ENV !== 'production') the record is NOT created (dry run) so test logins
// with real clients never leave a Pending request in the CRM.
// SWITCH_REQUEST_LIVE=1 on a dev server creates the record for an end-to-end test, but with Zoho's
// workflows/blueprints/approvals suppressed (trigger: []) so nothing is sent to anyone — delete the
// record from the CRM afterwards (it blocks the investor with "request in progress" until then).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { hasZohoWriteToken, zohoApiDomain, zohoFetch } from '@/lib/zoho'
import { irRecipient, irSubject, IR_EMAIL } from '@/lib/mobileIrMail'

const STRATS = ['QAW', 'QTF', 'QGF'] as const
type Strat = typeof STRATS[number]
const n = (v: unknown) => { const x = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(x) ? x : 0 }
const rs = (v: number) => 'Rs.' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
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
  if (!res.ok) throw new Error(body?.message || body?.data?.[0]?.message || `Zoho ${path} failed (${res.status})`)
  return body
}

// Every Investor record on this email — a family login (one email, several people) gets one per member.
async function findInvestors(email: string): Promise<any[]> {
  const key = email.trim().toLowerCase()
  if (!key) return []
  const body = await zoho(`Investors/search?email=${encodeURIComponent(key)}&fields=Name,Legal_Name,Email,Mobile_No,QAW_Invested,QTF_Invested,QGF_Invested,Owner&per_page=50`)
  return body?.data || []
}

// Pending requests per investor id — one Zoho call for the whole family (criteria OR), not one per member — each
// with the strategies it moves out of and into (Full: the Full_Switch_From/To ticks; Partial: non-zero amounts).
const PENDING_FIELDS = ['Investor_Name', 'Status', 'Request_Date', 'Switch_Type',
  ...STRATS.flatMap((s) => [`Full_Switch_From_${s}`, `Full_Switch_To_${s}`, `${s}_From_Amount`, `${s}_To_Amount`])].join(',')
type Pending = { requestDate: string | null; switchType: string | null; from: Strat[]; to: Strat[] }
const pendingView = (r: any): Pending => {
  const full = String(r.Switch_Type || '') === 'Full Switch'
  return {
    requestDate: r.Request_Date || null, switchType: r.Switch_Type || null,
    from: STRATS.filter((s) => (full ? r[`Full_Switch_From_${s}`] === true : n(r[`${s}_From_Amount`]) > 0)),
    to: STRATS.filter((s) => (full ? r[`Full_Switch_To_${s}`] === true : n(r[`${s}_To_Amount`]) > 0)),
  }
}
async function pendingRequests(investorIds: string[]): Promise<Record<string, Pending[]>> {
  if (!investorIds.length) return {}
  const crit = investorIds.map((id) => `(Investor_Name:equals:${id})`).join('or')
  const body = await zoho(`Strategy_Switch_Requests/search?criteria=${encodeURIComponent(investorIds.length > 1 ? `(${crit})` : crit)}&fields=${PENDING_FIELDS}&per_page=200`)
  const out: Record<string, Pending[]> = {}
  for (const r of (body?.data || []) as any[]) {
    const id = String(r.Investor_Name?.id || '')
    if (id && String(r.Status || '').trim() === 'Pending') (out[id] = out[id] || []).push(pendingView(r))
  }
  return out
}

// Investor Relations email for a switch request — the web's account-services page sends this same
// "New Switch/Reallocation Request" to IR (inquiry_type 'switch'). Sent in production, or on a dev server when
// MOBILE_IR_EMAIL_OVERRIDE points it at the testers; never from a dev server to the real IR inbox.
async function emailIrSwitch(user: any, view: any, isFull: boolean, fromList: string[], toList: string[], fromAmt: (s: any) => number, toAmt: (s: any) => number, requestId: string | null, dryRun: boolean) {
  if (!IS_PROD && !(process.env.MOBILE_IR_EMAIL_OVERRIDE || '').trim()) return
  const rows = isFull
    ? `<p><strong>Switch From:</strong> ${fromList.join(', ')}</p><p><strong>Switch To:</strong> ${toList.join(', ')}</p>`
    : `<p><strong>Moving out:</strong> ${fromList.map((s) => `${s} ${rs(fromAmt(s))}`).join(', ')}</p><p><strong>Moving in:</strong> ${toList.map((s) => `${s} ${rs(toAmt(s))}`).join(', ')}</p>`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
      <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
        <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Switch / Reallocation Request</h1>
      </div>
      <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
        <p><strong>Submitted via:</strong> myQode Mobile App</p>
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
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: irRecipient(), subject: irSubject(`New Switch/Reallocation Request from ${view.legalName}`), html,
        from: IR_EMAIL, fromName: 'Qode Investor Relations', inquiry_type: 'switch',
        nuvama_code: (user.accountCodes || []).find((c: string) => /^Q/.test(c)) || user.clientCode || 'MOBILE',
        client_id: user.clientId || '', user_email: user.email, priority: 'normal',
        switch_type: isFull ? 'Full Switch' : 'Partial Switch', switch_from: fromList, switch_to: toList, zoho_request_id: requestId,
      }),
    })
    if (!res.ok) console.warn('[switch-request] IR email answered', res.status)
  } catch (err) { console.warn('[switch-request] IR email failed:', (err as any)?.message) }
}

const investorView = (inv: any) => ({
  id: String(inv.id), legalName: String(inv.Legal_Name || inv.Name || ''),
  invested: { QAW: n(inv.QAW_Invested), QTF: n(inv.QTF_Invested), QGF: n(inv.QGF_Invested) },
})

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ investors: [] })
  try {
    const list = await findInvestors(user!.email)
    if (!list.length) return NextResponse.json({ investors: [], message: 'We could not find your investor record. Please contact Investor Relations.' })
    const pend = await pendingRequests(list.map((inv) => String(inv.id)))
    const investors = list.map((inv) => {
      return { ...investorView(inv), pending: pend[String(inv.id)] || [] }
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

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const isFull = String(body?.switchType || '') === 'Full Switch'
  const fromList: Strat[] = STRATS.filter((s) => (isFull ? (body?.from || []).includes(s) : n(body?.fromAmounts?.[s]) > 0))
  const toList: Strat[] = STRATS.filter((s) => (isFull ? (body?.to || []).includes(s) : n(body?.toAmounts?.[s]) > 0))
  const fromAmt = (s: Strat) => (isFull ? 0 : n(body?.fromAmounts?.[s]))
  const toAmt = (s: Strat) => (isFull ? 0 : n(body?.toAmounts?.[s]))

  // validate_no_overlap_from_to
  const overlap = STRATS.filter((s) => fromList.includes(s) && toList.includes(s))
  if (overlap.length) return NextResponse.json({ error: `A strategy cannot appear on both the From and To side of the same request. Please check: ${overlap.join(', ')}.` }, { status: 400 })
  if (!fromList.length) return NextResponse.json({ error: isFull ? 'Select at least one strategy to switch from.' : 'Enter at least one From amount.' }, { status: 400 })
  if (!toList.length) return NextResponse.json({ error: isFull ? 'Select at least one strategy to switch to.' : 'Enter at least one To amount.' }, { status: 400 })

  // validate_switch_amounts_balance (Partial only)
  if (!isFull) {
    const totalFrom = fromList.reduce((t, s) => t + fromAmt(s), 0)
    const totalTo = toList.reduce((t, s) => t + toAmt(s), 0)
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

    // A Pending request already moving out of the same strategy blocks this one (the Zoho automation ignores
    // duplicates; we tell the user instead). A request out of a different strategy is allowed.
    const pend = (await pendingRequests([investorId]))[investorId] || []
    const clash = pend.find((p) => p.from.some((s) => fromList.includes(s)))
    if (clash) {
      const same = clash.from.filter((s) => fromList.includes(s)).join(', ')
      return NextResponse.json({
        error: `A switch request out of ${same} is already in progress` + (clash.requestDate ? ` (submitted ${String(clash.requestDate).slice(0, 10)})` : '') + '. Our team will reach out once it is processed; a new request for this strategy can be made after that.',
        code: 'PENDING_EXISTS', pending: clash,
      }, { status: 409 })
    }

    // holdings check (Partial only), against the Investors record like Zoho does
    if (!isFull) {
      const over = fromList.filter((s) => fromAmt(s) > view.invested[s])
      if (over.length) {
        return NextResponse.json({ error: "One or more From amounts exceed the investor's current investment in that strategy. " + STRATS.map((s) => `${s} From: ${rs(fromAmt(s))} (Current: ${rs(view.invested[s])})`).join(' | ') + '.' }, { status: 400 })
      }
    }

    const record: Record<string, unknown> = {
      Investor_Name: { id: investorId },
      Request_Date: new Date().toISOString().slice(0, 10),
      Status: 'Pending',
      Switch_Type: isFull ? 'Full Switch' : 'Partial Switch',
      Filled_By_Investor: true,
      ...(inv.Owner?.id ? { Owner: { id: String(inv.Owner.id) } } : {}),
    }
    if (isFull) {
      STRATS.forEach((s) => { record[`Full_Switch_From_${s}`] = fromList.includes(s); record[`Full_Switch_To_${s}`] = toList.includes(s) })
    } else {
      STRATS.forEach((s) => { record[`${s}_From_Amount`] = fromAmt(s); record[`${s}_To_Amount`] = toAmt(s) })
    }

    if (DRY_RUN) {
      console.log('[mobile/services/switch-request] DRY RUN (not production) — would create:', JSON.stringify(record))
      await emailIrSwitch(user, view, isFull, fromList, toList, fromAmt, toAmt, null, true)
      return NextResponse.json({ success: true, dryRun: true, requestId: null, investor: view, record })
    }
    // Production fires the CRM workflow rules (RM notification lives there). A live TEST on a dev server
    // passes trigger: [] — Zoho then runs no workflow, approval or blueprint for this record.
    const trigger = IS_PROD ? ['workflow'] : []
    if (!hasZohoWriteToken()) {
      console.error('[mobile/services/switch-request] ZOHO_CRM_WRITE_REFRESH_TOKEN is not set — the switch record cannot be created. Mint it via /api/auth/zoho/authorize?write=switch')
      return NextResponse.json({ error: 'Switch requests can’t be submitted from the app right now. Please contact Investor Relations, or try again later.', code: 'SWITCH_UNAVAILABLE' }, { status: 503 })
    }
    if (!IS_PROD) console.log('[mobile/services/switch-request] LIVE TEST (SWITCH_REQUEST_LIVE=1, triggers off) — creating:', JSON.stringify(record))
    const created = await zoho('Strategy_Switch_Requests', { method: 'POST', body: JSON.stringify({ data: [record], trigger }) })
    const id = created?.data?.[0]?.details?.id ?? null
    if (!id) throw new Error(created?.data?.[0]?.message || 'Zoho did not return a record id')
    await emailIrSwitch(user, view, isFull, fromList, toList, fromAmt, toAmt, String(id), false)
    return NextResponse.json({ success: true, dryRun: false, requestId: String(id), investor: view })
  } catch (err: any) {
    console.error('[mobile/services/switch-request POST]', err)
    return NextResponse.json({ error: err?.message || 'Could not submit the switch request' }, { status: 502 })
  }
}
