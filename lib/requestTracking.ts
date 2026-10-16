// Query tracking (decided 13 Oct 2026): the requests a client raised from the app or web, with their live status in
// Zoho. Each request is a row in pms_clients_tracker.qode_microsite_inquiries (written by /api/send-email, with the
// Zoho ids the request routes add to its data: desk_ticket_id for a Desk ticket, zoho_plan_id for a Switch Plan).
// The status comes from Zoho on each read — Desk for tickets, CRM for switch plans — cached for two minutes per
// record so a client refreshing the page does not hit Zoho again. Served by GET /api/mobile/requests.
//
// Only requests Zoho holds are listed (asked 13 Oct 2026: the status is Zoho's, nothing of our own), and the status
// is null — no pill — when Zoho cannot be read at that moment, never a made-up word:
//   state  'open' | 'on_hold' | 'closed'   (which colour the pill gets)
//   label  exactly Zoho's status ("Open", "On Hold", "Closed", "Pending", "Active", "Fully Deployed", …)
import { query as q1 } from '@/lib/db1'
import { getDeskTicketStatus } from '@/lib/zohoDesk'
import { planStatus } from '@/lib/switchPlan'
import { leadStatus } from '@/lib/zohoLeads'

export type RequestStatus = { state: 'open' | 'on_hold' | 'closed'; label: string; updatedAt: string | null }
export type TrackedRequest = {
  id: string
  kind: string            // the inquiry type
  title: string
  detail: string          // what was asked / moved, one line
  accountId: string | null
  createdAt: string
  reference: string       // what the acknowledgement quoted: the Desk ticket number, the plan number, or the inquiry id
  channel: string | null  // Web / App
  status: RequestStatus | null   // null: Zoho could not be read just now
}

const KINDS = ['strategy', 'discussion', 'raised_request', 'investor_referral', 'switch', 'help_request']
const HELP_TITLE: Record<string, string> = { switch: 'Switch Strategy', referral: 'Refer Someone', family: 'Link Family Accounts', topup: 'Investment Related Query', details: 'Update Details', other: 'Raise Any Query' }
const TITLE: Record<string, string> = {
  strategy: 'Ask About a Strategy', discussion: 'Raise Any Query', raised_request: 'Account Request', investor_referral: 'Referral',
  switch: 'Switch Strategy',
}
const oneLine = (s: unknown, max = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t }

function describe(type: string, subject: string, d: any): { title: string; detail: string } {
  switch (type) {
    case 'strategy': return { title: TITLE.strategy, detail: oneLine(d.question) }
    case 'discussion': return { title: TITLE.discussion, detail: oneLine(d.topic) }
    case 'raised_request': return { title: /family/i.test(subject) ? 'Family Request' : 'Account Request', detail: oneLine(d.message) }
    case 'help_request': return { title: d.type_name || HELP_TITLE[d.help_kind] || 'Request', detail: oneLine(d.message) }   // Account Services › What do you need help with?
    case 'investor_referral': return { title: 'Referral', detail: oneLine([d.referred_investor_name, d.referred_investor_email].filter(Boolean).join(' · ')) }
    case 'switch': {
      const from = [].concat(d.switch_from || []).join(', '), to = [].concat(d.switch_to || []).join(', ')
      return { title: 'Switch Strategy', detail: oneLine(`${d.switch_type || 'Switch'}: ${from} → ${to}`) }
    }
    default: return { title: TITLE[type] || subject || 'Request', detail: '' }
  }
}

/** The client's requests, newest first, each with its live Zoho status. */
export async function listRequests(email: string, accountCodes: string[], limit = 100): Promise<TrackedRequest[]> {
  const r = await q1(
    `SELECT id, type, nuvama_code, subject, status, data, created_at, updated_at
       FROM pms_clients_tracker.qode_microsite_inquiries
      WHERE type = ANY($3::text[]) AND (lower(user_email) = $1 OR nuvama_code = ANY($2::text[]))
        AND (data ? 'desk_ticket_id' OR data ? 'zoho_plan_id' OR (data ->> 'zoho_lead_id') IS NOT NULL)
      ORDER BY created_at DESC LIMIT $4`,
    [String(email || '').toLowerCase(), accountCodes.filter(Boolean), KINDS, limit])
  const rows = await Promise.all(r.rows.map(async (row: any) => {
    const d = row.data || {}
    const { title, detail } = describe(row.type, row.subject || '', d)
    let status: RequestStatus | null = null
    let reference = String(row.id).slice(0, 8)
    if (d.desk_ticket_id) {
      const t = await getDeskTicketStatus(String(d.desk_ticket_id))
      if (t?.deleted) return null   // deleted in Zoho Desk: not listed (16 Oct 2026)
      if (t) status = { state: t.statusType === 'Closed' ? 'closed' : t.statusType === 'On Hold' ? 'on_hold' : 'open', label: t.status, updatedAt: t.modifiedTime }
      reference = d.desk_ticket ? `#${d.desk_ticket}` : reference
    } else if (d.zoho_lead_id) {
      status = await leadStatus(String(d.zoho_lead_id))   // a referral: the referred person's Lead (14 Oct 2026)
    } else if (d.zoho_plan_id) {
      const p = await planStatus(String(d.zoho_plan_id))
      if (p) status = p
      reference = d.zoho_plan_no || reference
    }
    return { id: String(row.id), kind: row.type, title, detail, accountId: row.nuvama_code || null, createdAt: row.created_at, reference, channel: d.channel || null, status }
  }))
  return rows.filter((x): x is TrackedRequest => !!x)
}
