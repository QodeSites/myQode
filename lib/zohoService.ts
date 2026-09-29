// The central Zoho CRM service. Everything in myQode that reads Zoho should go through here:
//   zohoRequest()  one place for auth (lib/zoho.ts token), retries with backoff on 429 / 5xx / network errors
//   coqlAll()      paged COQL reads (COQL returns system fields such as Created_Time that list reads hide here)
//   syncModule()   incremental sync into zoho_mirror: records modified since the last run (2-minute overlap),
//                  plus deletions; the watermark lives in app_notification_state ('zoho.sync.<module>')
//   syncAll()      the registered modules, then the handlers that turn Zoho records into app data
// The app reads zoho_mirror, never Zoho directly, so it stays fast and works while Zoho is slow or down.
// Runs every 5 minutes in the notification worker (lib/appNotifyWorker.ts).
import { query } from '@/lib/db'
import { zohoFetch, zohoApiDomain } from '@/lib/zoho'
import { getState, setState } from '@/lib/appNotify'

type ModuleSpec = { module: string; fields: string[] }

// Modules the app mirrors. Add a module here (and a handler below if it should drive app behaviour).
export const MODULES: ModuleSpec[] = [
  { module: 'Execution_Orders', fields: ['Capital_Inflow', 'Investor_Name', 'Date_of_Receipt', 'Allocation_Confirmed_at', 'Total_Amount',
    'QAW_Amount', 'QGF_Amount', 'QTF_Amount', 'QLF_Amount', 'QAW_Allocation', 'QGF_Allocation', 'QTF_Allocation', 'QLF_Allocation', 'Created_Time', 'Modified_Time'] },
  // One per Capital Inflow: how the money is split across schemes (the client's confirmed allocation)
  { module: 'Scheme_Clarifications', fields: ['Capital_Inflow', 'Investor_Name', 'Amount_Received', 'Total_Amount_Entered', 'Amount_Variance',
    'QAW_Amount', 'QGF_Amount', 'QTF_Amount', 'QLF_Amount', 'Allocation_Method', 'Total_Allocation', 'Verification_Status', 'Confirmation_Sent', 'Created_Time', 'Modified_Time'] },
  { module: 'Capital_Inflows', fields: ['Nuvama_ID_Entry', 'Investor_Name', 'Date_of_Receipt', 'Amount_Received', 'Confirm_Amount_Received',
    'Verification_Status', 'Inflow_Sequence_Number', 'Created_Time', 'Modified_Time'] },
]

const base = async (): Promise<string> => (typeof zohoApiDomain === 'function' ? await (zohoApiDomain as any)() : (zohoApiDomain as any))
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function zohoRequest(path: string, init: RequestInit = {}): Promise<any> {
  let last: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await zohoFetch(`${await base()}${path}`, init)
      if (r.status === 204) return { data: [] }
      if (r.status === 429 || r.status >= 500) { last = new Error(`Zoho ${r.status}`); await wait(1000 * 2 ** attempt); continue }
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error(`Zoho ${r.status}: ${j?.code || ''} ${j?.message || ''}`.trim()), { status: r.status, code: j?.code })
      return j
    } catch (e: any) {
      last = e
      if (e?.status && e.status < 500 && e.status !== 429) throw e   // a real refusal: retrying won't help
      await wait(1000 * 2 ** attempt)
    }
  }
  throw last
}

/** Every row of a COQL query (select … from … where … order by …), 200 at a time. */
export async function coqlAll(select: string, maxRows = 5000): Promise<any[]> {
  const out: any[] = []
  for (let offset = 0; offset < maxRows; offset += 200) {
    const j = await zohoRequest('/crm/v6/coql', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ select_query: `${select} limit ${offset}, 200` }) })
    const rows = j?.data || []
    out.push(...rows)
    if (!j?.info?.more_records || rows.length < 200) break
  }
  return out
}

const zdt = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 19) + '+05:30'   // Zoho datetime in IST

/** Pulls records changed since the last run (and deletions) into zoho_mirror. Returns what changed. */
export async function syncModule(spec: ModuleSpec): Promise<{ changed: any[]; deleted: string[] }> {
  const key = `zoho.sync.${spec.module}`
  const since = await getState(key)
  // First run: the last 45 days is plenty (older money is already in the portfolio).
  const from = since ? new Date(new Date(since).getTime() - 2 * 60000) : new Date(Date.now() - 45 * 86400000)
  const startedAt = new Date()
  const rows = await coqlAll(`select ${spec.fields.join(', ')} from ${spec.module} where Modified_Time >= '${zdt(from)}' order by Modified_Time asc`)
  for (const r of rows) {
    await query(
      `INSERT INTO zoho_mirror (module, id, modified_time, data, deleted, synced_at) VALUES ($1, $2, $3, $4::jsonb, FALSE, NOW())
       ON CONFLICT (module, id) DO UPDATE SET modified_time = EXCLUDED.modified_time, data = EXCLUDED.data, deleted = FALSE, synced_at = NOW()`,
      [spec.module, String(r.id), r.Modified_Time || null, JSON.stringify(r)])
  }
  // Deletions since the last run (best effort: not every Zoho plan exposes this)
  const deleted: string[] = []
  try {
    const j = await zohoRequest(`/crm/v2/${spec.module}/deleted?type=all&per_page=200`, { headers: { 'If-Modified-Since': zdt(from) } })
    for (const d of j?.data || []) {
      const r = await query(`UPDATE zoho_mirror SET deleted = TRUE, synced_at = NOW() WHERE module = $1 AND id = $2 AND NOT deleted RETURNING id`, [spec.module, String(d.id)])
      if (r.rowCount) deleted.push(String(d.id))
    }
  } catch { /* ignore */ }
  await setState(key, startedAt.toISOString())
  await setState(`${key}.last`, JSON.stringify({ at: startedAt.toISOString(), changed: rows.length, deleted: deleted.length }))
  return { changed: rows, deleted }
}

let running = false
/** Syncs every registered module, then applies the handlers. Never throws. */
export async function syncAll(): Promise<Record<string, unknown>> {
  if (running) return { skipped: 'already running' }
  running = true
  const out: Record<string, unknown> = {}
  try {
    const results: Record<string, { changed: any[]; deleted: string[] }> = {}
    for (const m of MODULES) {
      try { results[m.module] = await syncModule(m); out[m.module] = { changed: results[m.module].changed.length, deleted: results[m.module].deleted.length } }
      catch (e: any) { out[m.module] = { error: String(e?.message || e) }; await setState(`zoho.sync.${m.module}.error`, JSON.stringify({ at: new Date().toISOString(), error: String(e?.message || e) })) }
    }
    // Handlers: Zoho records → app data
    const { applyCapitalInflows } = await import('@/lib/capitalInflows')
    const ci = results.Capital_Inflows, eo = results.Execution_Orders
    if (ci || eo || results.Scheme_Clarifications) {
      // an execution order changing (the strategy split) re-applies its inflow too
      const ids = new Set<string>([...(ci?.changed || []).map((r: any) => String(r.id)), ...(ci?.deleted || [])])
      for (const r of eo?.changed || []) if (r.Capital_Inflow?.id) ids.add(String(r.Capital_Inflow.id))
      for (const r of results.Scheme_Clarifications?.changed || []) if (r.Capital_Inflow?.id) ids.add(String(r.Capital_Inflow.id))
      out.capitalInflows = await applyCapitalInflows([...ids])
      const { notifyAllocations } = await import('@/lib/capitalInflows')
      out.allocations = await notifyAllocations((results.Scheme_Clarifications?.changed || []).map((r: any) => String(r.id)))
    }
  } finally { running = false }
  return out
}

/** For the admin page: when each module last synced, and the last error if any. */
export async function syncStatus() {
  const out: Record<string, unknown> = {}
  for (const m of MODULES) {
    const last = await getState(`zoho.sync.${m.module}.last`)
    const err = await getState(`zoho.sync.${m.module}.error`)
    const count = (await query(`SELECT count(*)::int AS n FROM zoho_mirror WHERE module = $1 AND NOT deleted`, [m.module])).rows[0]?.n || 0
    out[m.module] = { last: last ? JSON.parse(last) : null, lastError: err ? JSON.parse(err) : null, records: count }
  }
  return out
}
