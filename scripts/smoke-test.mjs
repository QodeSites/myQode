#!/usr/bin/env node
// Post-deploy smoke test: does a deployed myQode answer the way the app and the website need it to?
//   node scripts/smoke-test.mjs [baseUrl]        (default https://myqode-testing.qodeinvest.com)
// Exit 0 = all checks passed, 1 = something failed (scripts/deploy-testing.sh rolls back on that).
//
// Read-only and safe against a live server: it signs in only as the App Store / Play Store reviewer account,
// whose routes answer from lib/reviewerMock.ts without touching client data, and the one failed sign-in uses an
// address that cannot exist. Credentials are read from the login route (the reviewer account is public to the
// stores by design); SMOKE_EMAIL / SMOKE_PASSWORD override them.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || 'https://myqode-testing.qodeinvest.com').replace(/\/$/, '')
const SLOW_MS = 5000
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function reviewer() {
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) return { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }
  const src = readFileSync(path.join(root, 'app/api/mobile/auth/login/route.ts'), 'utf8')
  const pick = name => (src.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`)) || [])[1]
  return { email: pick('REVIEWER_EMAIL'), password: pick('REVIEWER_PASSWORD') }
}

const results = []
async function check(name, fn) {
  const t = Date.now()
  try {
    const note = await fn()
    const ms = Date.now() - t
    results.push({ ok: ms < SLOW_MS, name, ms, note: ms < SLOW_MS ? note || '' : `slow (> ${SLOW_MS / 1000}s)` })
  } catch (e) {
    results.push({ ok: false, name, ms: Date.now() - t, note: String(e.message || e).slice(0, 160) })
  }
}
async function req(p, { token, method = 'GET', body, expect = 200 } = {}) {
  const r = await fetch(BASE + p, {
    method, redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  const want = [].concat(expect)
  if (!want.includes(r.status)) throw new Error(`HTTP ${r.status} (expected ${want.join('/')}): ${text.slice(0, 100)}`)
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, text, json }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

// ── Public ──────────────────────────────────────────────────────────────────
await check('Website home page', async () => { const r = await req('/', { expect: [200, 307, 308] }); return `HTTP ${r.status}` })
await check('App version endpoint', async () => {
  const { json } = await req('/api/mobile/app-version')
  need(json && typeof json === 'object', 'not JSON')
  return Object.entries(json).filter(([, v]) => typeof v !== 'object').slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ')
})
await check('Web app (/app) and its script bundle', async () => {
  const { text } = await req('/app')
  const js = (text.match(/src="([^"]*_expo\/static\/js\/web\/[^"]+\.js)"/) || [])[1]
  need(js, 'no app bundle referenced in /app')
  const r = await fetch(new URL(js, BASE + '/app/').href, { signal: AbortSignal.timeout(20000) })
  need(r.ok, `bundle HTTP ${r.status}`)
  const kb = Math.round((await r.arrayBuffer()).byteLength / 1024)
  need(kb > 200, `bundle only ${kb} KB`)
  return `${kb} KB bundle`
})

// ── Security behaviour ──────────────────────────────────────────────────────
await check('Portfolio refuses requests without sign-in', async () => { await req('/api/mobile/portfolio/snapshot', { expect: 401 }) })
await check('Portfolio refuses a forged token', async () => { await req('/api/mobile/portfolio/snapshot', { token: 'eyJhbGciOiJIUzI1NiJ9.e30.invalid', expect: 401 }) })
await check('Wrong password is refused cleanly', async () => {
  const r = await req('/api/mobile/auth/login', { method: 'POST', body: { username: 'smoke-test@nonexistent.invalid', password: 'not-a-password' }, expect: [400, 401, 404, 429] })
  return `HTTP ${r.status}`
})

// ── Signed in (reviewer account: mock data, no client data) ─────────────────
const { email, password } = reviewer()
let token = null
await check('Sign-in (reviewer account)', async () => {
  need(email && password, 'reviewer credentials not found')
  const { json } = await req('/api/mobile/auth/login', { method: 'POST', body: { username: email, password } })
  need(json?.token, 'no token in response')
  token = json.token
  return `${json.user?.accountCodes?.length ?? 0} accounts`
})
if (token) {
  await check('Who am I', async () => { const { json } = await req('/api/mobile/auth/me', { token }); need(json, 'not JSON') })
  await check('Portfolio snapshot', async () => { const { json } = await req('/api/mobile/portfolio/snapshot', { token }); need(json?.owners?.length, 'no owners') })
  for (const [label, p] of [
    ['Performance', '/api/mobile/portfolio/performance?accountId=DEMO001'],
    ['NAV chart', '/api/mobile/portfolio/nav?accountId=DEMO001&period=1Y'],
    ['Drawdown', '/api/mobile/portfolio/drawdown?accountId=DEMO001'],
    ['Cash flows', '/api/mobile/portfolio/cashflow?accountId=DEMO001'],
    ['Monthly P&L', '/api/mobile/portfolio/monthly-pl?accountId=DEMO001'],
  ]) await check(label, async () => { const { json } = await req(p, { token }); need(json && Object.keys(json).length, 'empty response') })
}

// ── Report ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok)
console.log(`\nSmoke test: ${BASE}\n`)
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(44)} ${String(r.ms).padStart(5)} ms  ${r.note}`)
console.log(`\n${failed.length ? `✗ ${failed.length} of ${results.length} checks failed` : `✓ all ${results.length} checks passed`}`)
process.exit(failed.length ? 1 : 0)
