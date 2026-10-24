// MCP server for One Battalion Ventures (docs/distributor-mcp-one-battalion.md): their AI assistant reads their own
// book through the same partner API they already use.
//   POST /api/distributor-api/v1/mcp     MCP "Streamable HTTP", stateless, JSON responses (no SSE stream)
//   Authorization: Bearer <ONE_BATTALION_API_KEY>   (or x-api-key), on every request
// Every tool calls the matching /api/distributor-api/v1/* handler in-process with the caller's key, so the scope is
// exactly that API's: only accounts whose intermediary is One Battalion, read-only. Document download links
// (/documents/files) are deliberately not offered here. Each call is written to the admin audit log (partner.mcp).
import { NextRequest, NextResponse } from 'next/server'
import { authenticateDistributor, DISTRIBUTOR_EMAIL, DISTRIBUTOR_NAME } from '@/lib/distributorApi'
import { audit } from '@/lib/adminAuth'
import { GET as investors } from '../investors/route'
import { GET as portfolio } from '../portfolio/route'
import { GET as transactions } from '../transactions/route'
import { GET as history } from '../portfolio/history/route'
import { GET as documents } from '../documents/route'

export const dynamic = 'force-dynamic'

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER = { name: 'qode-one-battalion', title: 'Qode: One Battalion investors', version: '1.1.0' }
const INSTRUCTIONS = `Read-only data for ${DISTRIBUTOR_NAME}'s investors with Qode Advisors (a SEBI-registered portfolio manager). ` +
  'Amounts are in Indian rupees. Dates are IST calendar dates (YYYY-MM-DD). Start with list_investors to get account codes ' +
  '(for example QAW00098: the first three letters are the strategy), then use the other tools with those codes. ' +
  'The data is as of the last portfolio update (see as_of / report_date), not live. Nothing here can change an account.'

const CODES = { type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9]{3,14}$' }, maxItems: 50, description: 'Account codes from list_investors, e.g. ["QAW00098"]. Leave out for every account.' }
const DATE = (what: string) => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: `${what} (YYYY-MM-DD, inclusive)` })
const TOOLS = [
  { name: 'list_investors', title: 'List investors',
    description: 'Every investor of One Battalion with Qode, as families → owners → accounts: account code, name, email, strategy, start date, latest value (AUM) and amount invested, and the account\'s relationship manager as recorded with Qode (name, phone, email; phone is often empty), with totals.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_portfolio', title: 'Portfolio value and returns',
    description: 'Latest portfolio value, amount invested, profit and loss, NAV, drawdown and returns for each account. Give account codes to narrow it.',
    inputSchema: { type: 'object', properties: { account_codes: CODES }, additionalProperties: false } },
  { name: 'get_transactions', title: 'Money added and withdrawn',
    description: 'Contributions (money added) and withdrawals for the accounts, optionally between two dates.',
    inputSchema: { type: 'object', properties: { account_codes: CODES, from: DATE('First day'), to: DATE('Last day') }, additionalProperties: false } },
  { name: 'get_portfolio_history', title: 'Portfolio history',
    description: 'How an account\'s value, NAV, drawdown and returns moved over time. Needs 1 to 5 account codes. Defaults to the last 90 days, one row a week; ask for "daily" or "monthly" and a date range when needed.',
    inputSchema: { type: 'object', required: ['account_codes'], additionalProperties: false,
      properties: { account_codes: { ...CODES, minItems: 1, maxItems: 5, description: '1 to 5 account codes from list_investors' }, from: DATE('First day'), to: DATE('Last day'),
        interval: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'How often a row is returned (default weekly)' } } } },
  { name: 'list_documents', title: 'Documents on file',
    description: 'Which document types (PMS agreement, account opening, CML, disclosures) are on file for each account, and how many files. It does not return the files themselves.',
    inputSchema: { type: 'object', properties: { account_codes: CODES }, additionalProperties: false } },
].map(t => ({ ...t, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }))

class BadInput extends Error {}
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))
function codesOf(a: any, { required = false, max = 50 } = {}): string[] {
  const v = a?.account_codes
  if (v == null) { if (required) throw new BadInput('account_codes is required: 1 to 5 codes from list_investors'); return [] }
  if (!Array.isArray(v) || v.some(c => typeof c !== 'string' || !/^[A-Za-z0-9]{3,14}$/.test(c))) throw new BadInput('account_codes must be a list of account codes such as ["QAW00098"]')
  if (required && !v.length) throw new BadInput('account_codes is required: 1 to 5 codes from list_investors')
  if (v.length > max) throw new BadInput(`At most ${max} account codes at a time`)
  return [...new Set(v.map((c: string) => c.toUpperCase()))]
}
function datesOf(a: any) {
  for (const k of ['from', 'to']) if (a?.[k] != null && !isDate(a[k])) throw new BadInput(`${k} must be a date like 2026-03-31`)
  if (a?.from && a?.to && a.from > a.to) throw new BadInput('from must not be after to')
  return { from: (a?.from as string) || null, to: (a?.to as string) || null }
}

/** Calls one of the partner API handlers with the caller's own key, so its scoping and answers are used unchanged. */
async function api(req: NextRequest, handler: (r: NextRequest) => Promise<Response>, path: string, params: Record<string, string | null>) {
  const u = new URL(`/api/distributor-api/v1/${path}`, req.url)
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v)
  const res = await handler(new NextRequest(u, { headers: { authorization: req.headers.get('authorization') ?? '', 'x-api-key': req.headers.get('x-api-key') ?? '' } }))
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `The data could not be read (${res.status})`)
  return data
}

async function callTool(req: NextRequest, name: string, a: any) {
  if (name === 'list_investors') return api(req, investors, 'investors', {})
  if (name === 'get_portfolio') return api(req, portfolio, 'portfolio', { account_code: codesOf(a).join(',') })
  if (name === 'list_documents') return api(req, documents, 'documents', { account_code: codesOf(a).join(',') })
  if (name === 'get_transactions') { const d = datesOf(a); return api(req, transactions, 'transactions', { account_code: codesOf(a).join(','), ...d }) }
  if (name === 'get_portfolio_history') {
    const codes = codesOf(a, { required: true, max: 5 }), d = datesOf(a)
    const interval = a?.interval ?? 'weekly'
    if (!['daily', 'weekly', 'monthly'].includes(interval)) throw new BadInput('interval must be daily, weekly or monthly')
    const to = d.to ?? new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
    const from = d.from ?? new Date(Date.parse(to) - 90 * 86400000).toISOString().slice(0, 10)
    const all = await api(req, history, 'portfolio/history', { account_code: codes.join(',') })
    const day = (r: any) => String(r.report_date).slice(0, 10)
    const rows = (all.data || []).filter((r: any) => day(r) >= from && day(r) <= to)
    // weekly / monthly: the last row of each week (Mon–Sun) or month, per account
    const bucket = (r: any) => { const x = new Date(day(r) + 'T00:00:00Z'); return interval === 'monthly' ? day(r).slice(0, 7) : interval === 'weekly' ? String(Math.floor((x.getTime() / 86400000 + 3) / 7)) : day(r) }
    const last = new Map<string, any>()
    for (const r of rows) last.set(`${r.account_code}|${bucket(r)}`, r)
    const data = [...last.values()].sort((x, y) => day(x).localeCompare(day(y)) || String(x.account_code).localeCompare(String(y.account_code)))
    if (data.length > 2000) throw new BadInput('That is more than 2,000 rows. Use a shorter date range, fewer accounts, or a weekly or monthly interval.')
    return { distributor: all.distributor, from, to, interval, rows: data.length, data }
  }
  throw new BadInput(`Unknown tool: ${name}`)
}

// At most 120 calls a minute for the key, so a runaway assistant cannot hammer the database
const hits: number[] = []
const limited = () => { const now = Date.now(); while (hits.length && hits[0] < now - 60000) hits.shift(); if (hits.length >= 120) return true; hits.push(now); return false }

const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(req: NextRequest, m: any): Promise<object | null> {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(m?.id, -32600, 'Invalid request')
  const note = m.id === undefined   // a notification: no answer
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion
      return ok(m.id, { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS })
    }
    case 'ping': return ok(m.id, {})
    case 'tools/list': return ok(m.id, { tools: TOOLS })
    case 'tools/call': {
      const name = String(m.params?.name || ''), args = m.params?.arguments ?? {}
      if (!TOOLS.some(t => t.name === name)) return fail(m.id, -32602, `Unknown tool: ${name}`)
      if (limited()) return ok(m.id, { isError: true, content: [{ type: 'text', text: 'Too many requests in the last minute. Wait a moment and try again.' }] })
      try {
        const data = await callTool(req, name, args)
        audit(req, { email: DISTRIBUTOR_EMAIL }, 'partner.mcp', name, { args }).catch(() => {})
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
      } catch (e) {
        if (!(e instanceof BadInput)) console.error('[distributor-mcp]', name, (e as Error).message)
        return ok(m.id, { isError: true, content: [{ type: 'text', text: e instanceof BadInput ? e.message : 'The data could not be read just now. Please try again.' }] })
      }
    }
    default: return note ? null : fail(m.id, -32601, `Method not found: ${m.method}`)
  }
}

export async function POST(req: NextRequest) {
  const denied = authenticateDistributor(req)
  if (denied) { denied.headers.set('WWW-Authenticate', 'Bearer realm="Qode partner API"'); return denied }
  let body: any
  try { body = await req.json() } catch { return NextResponse.json(fail(null, -32700, 'Parse error'), { status: 400 }) }
  const many = Array.isArray(body)
  if (many && (!body.length || body.length > 20)) return NextResponse.json(fail(null, -32600, 'Invalid request'), { status: 400 })
  const answers = (await Promise.all((many ? body : [body]).map((m: any) => handle(req, m)))).filter(Boolean)
  if (!answers.length) return new NextResponse(null, { status: 202 })   // only notifications
  return NextResponse.json(many ? answers : answers[0])
}

// No server-to-client stream and no sessions: the spec's answer for both is 405
const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
export const GET = notAllowed
export const DELETE = notAllowed
