// Strategy switch requests, mirroring the Zoho Forms / CRM flow (automation.process_switch_form_submission +
// validation_rule.validate_switch_amounts_balance / validate_no_overlap_from_to):
//
//   GET  /api/mobile/services/switch-request
//        → every Investor record on the login email (family logins have one per member): legal name,
//          QAW/QTF/QGF invested, and whether that investor already has a Pending request
//   POST /api/mobile/services/switch-request
//        investorId (one of the GET list; optional when there is only one), plus
//        Full:    { switchType: 'Full Switch',    from: ['QAW', …], to: ['QTF', …] }
//        Partial: { switchType: 'Partial Switch', fromAmounts: { QAW: n, … }, toAmounts: { QTF: n, … } }
//        → creates a Strategy_Switch_Requests record (Status Pending, Filled_By_Investor true, Owner = investor's owner)
//
// Rules applied exactly as in Zoho: a strategy cannot be on both sides; Partial: total out = total in and each
// From amount ≤ that strategy's invested value; Full: at least one From and one To; one Pending request at a time.
// The investor is identified by the verified JWT email (same lookup the Zoho automation falls back to).
// Notifications (WhatsApp to the RM) stay in Zoho — put them on a CRM workflow for record creation; this route
// sends nothing. In development (NODE_ENV !== 'production') the record is NOT created (dry run) so test logins
// with real clients never leave a Pending request in the CRM.
// SWITCH_REQUEST_LIVE=1 on a dev server creates the record for an end-to-end test, but with Zoho's
// workflows/blueprints/approvals suppressed (trigger: []) so nothing is sent to anyone — delete the
// record from the CRM afterwards (it blocks the investor with "request in progress" until then).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { getZohoAccessToken, zohoApiDomain } from '@/lib/zoho'

const STRATS = ['QAW', 'QTF', 'QGF'] as const
type Strat = typeof STRATS[number]
const n = (v: unknown) => { const x = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(x) ? x : 0 }
const rs = (v: number) => 'Rs.' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const IS_PROD = process.env.NODE_ENV === 'production'
const LIVE = IS_PROD || process.env.SWITCH_REQUEST_LIVE === '1'   // create the CRM record?
const DRY_RUN = !LIVE

async function zoho(path: string, init?: RequestInit) {
  const token = await getZohoAccessToken()
  const res = await fetch(`${zohoApiDomain()}/crm/v2/${path}`, {
    ...init, cache: 'no-store',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
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

// Pending request per investor id — one Zoho call for the whole family (criteria OR), not one per member.
async function pendingRequests(investorIds: string[]): Promise<Record<string, any>> {
  if (!investorIds.length) return {}
  const crit = investorIds.map((id) => `(Investor_Name:equals:${id})`).join('or')
  const body = await zoho(`Strategy_Switch_Requests/search?criteria=${encodeURIComponent(investorIds.length > 1 ? `(${crit})` : crit)}&fields=Investor_Name,Status,Request_Date,Switch_Type&per_page=200`)
  const out: Record<string, any> = {}
  for (const r of (body?.data || []) as any[]) {
    const id = String(r.Investor_Name?.id || '')
    if (id && String(r.Status || '').trim() === 'Pending' && !out[id]) out[id] = r
  }
  return out
}
const pendingRequest = async (investorId: string) => (await pendingRequests([investorId]))[investorId] || null

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
      const p = pend[String(inv.id)]
      return { ...investorView(inv), pending: p ? { requestDate: p.Request_Date || null, switchType: p.Switch_Type || null } : null }
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

    // one Pending request at a time (the Zoho automation ignores duplicates; we tell the user instead)
    const pend = await pendingRequest(investorId)
    if (pend) return NextResponse.json({ error: 'You already have a switch request in progress' + (pend.Request_Date ? ` (submitted ${String(pend.Request_Date).slice(0, 10)})` : '') + '. Our team will reach out once it is processed.', code: 'PENDING_EXISTS' }, { status: 409 })

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
      return NextResponse.json({ success: true, dryRun: true, requestId: null, investor: view, record })
    }
    // Production fires the CRM workflow rules (RM notification lives there). A live TEST on a dev server
    // passes trigger: [] — Zoho then runs no workflow, approval or blueprint for this record.
    const trigger = IS_PROD ? ['workflow'] : []
    if (!IS_PROD) console.log('[mobile/services/switch-request] LIVE TEST (SWITCH_REQUEST_LIVE=1, triggers off) — creating:', JSON.stringify(record))
    const created = await zoho('Strategy_Switch_Requests', { method: 'POST', body: JSON.stringify({ data: [record], trigger }) })
    const id = created?.data?.[0]?.details?.id ?? null
    if (!id) throw new Error(created?.data?.[0]?.message || 'Zoho did not return a record id')
    return NextResponse.json({ success: true, dryRun: false, requestId: String(id), investor: view })
  } catch (err: any) {
    console.error('[mobile/services/switch-request POST]', err)
    return NextResponse.json({ error: err?.message || 'Could not submit the switch request' }, { status: 502 })
  }
}
