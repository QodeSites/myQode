// Imports Nuvama WealthSpectrum's "Corporate Benefits" export (all clients, one CSV: dividends, bonus shares, splits,
// cash in lieu of fractions) into PG_DATABASE1 → pms_clients_tracker.pms_corporate_benefits, the table the P&L reads
// dividends from (lib/plbsCompute.ts). The daily scraper also writes that table; this fills what it missed.
//
//   node scripts/import-nuvama-corporate-benefits.mjs --file <CorporateBenefitsReport.csv> [--dry-run]
//
// Adds only the entries that are not there yet — matched on account, type, ex-date, quantity (2 decimals, as the
// table keeps it) and amount — so it is safe to re-run and safe alongside the scraper; nothing is updated or deleted.
// "Interest" entries are left out (interest comes from the transaction feed). Account codes are read from the end of
// the "Account :" line, so names with hyphens (SHREE-PRABHAR-FINSERVE LLP - QGF00132) get the right code. One
// transaction: the app never sees half a file.
import fs from 'fs'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const FILE = arg('file')
const DRY = process.argv.includes('--dry-run')
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: node scripts/import-nuvama-corporate-benefits.mjs --file <CorporateBenefitsReport.csv> [--dry-run]'); process.exit(1) }

const T = 'pms_clients_tracker.pms_corporate_benefits'
const r2 = n => Math.round(n * 100) / 100
const num = s => Number(String(s ?? '').replace(/,/g, '')) || 0
function csvLine(l) {
  const out = []; let cur = '', q = false
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch }
  out.push(cur); return out
}

const rows = []
let acct = null, name = null
const first = fs.readFileSync(FILE, 'utf8').slice(0, 200)
if (!/CORPORATE BENEFITS/i.test(first)) { console.error(`✗ ${FILE} is not a Corporate Benefits export (first line: ${first.split(/\r?\n/)[0]})`); process.exit(1) }
for (const l of fs.readFileSync(FILE, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^Account : \d+\s+(.*) - (Q[A-Z]{2}\d+)\s*,/)
  if (m) { name = m[1].replace(/\s+/g, ' ').trim(); acct = m[2]; continue }
  const c = csvLine(l)
  if (!acct || !c[0] || c[0] === 'Type' || !/^\d\d\/\d\d\/\d{4}$/.test((c[2] || '').trim())) continue
  const type = c[0].trim()
  if (type === 'Interest') continue
  const [d, mo, y] = c[2].trim().split('/')
  rows.push({ clientname: name, scheme: acct.slice(0, 3), type, security: c[1].trim(), accountcode: acct,
    entitlement: c[3].trim(), ex_date: `${y}-${mo}-${d}`, quantity: r2(num(c[4])), amount: r2(num(c[5])) })
}
if (!rows.length) { console.error('✗ no entries found in the file'); process.exit(1) }
const key = r => [r.accountcode, r.type, r.ex_date, r2(r.quantity).toFixed(2), r2(r.amount).toFixed(2)].join('|')
const exDates = rows.map(r => r.ex_date).sort()
console.log(`▸ ${FILE}: ${rows.length} entries, ${new Set(rows.map(r => r.accountcode)).size} accounts, ex-dates ${exDates[0]} → ${exDates[exDates.length - 1]}`)

const db = new pg.Client({ host: process.env.PG_HOST, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE1, port: +(process.env.PG_PORT || 5432) })
await db.connect()
try {
  const have = new Set((await db.query(
    `SELECT accountcode, type, ex_date::date::text AS ex_date, quantity::float AS quantity, amount::float AS amount FROM ${T}`)).rows.map(key))
  const add = rows.filter(r => !have.has(key(r)))
  const byType = add.reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + 1), m), {})
  console.log(`▸ already there: ${rows.length - add.length} · to add: ${add.length} ${JSON.stringify(byType)}`)
  if (DRY) { console.log('✓ dry run: nothing written'); process.exit(0) }
  await db.query('BEGIN')
  for (const r of add) {
    await db.query(`INSERT INTO ${T} (clientname, scheme, type, security, accountcode, entitlement, ex_date, amount, quantity)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [r.clientname, r.scheme, r.type, r.security, r.accountcode, r.entitlement, r.ex_date, r.amount, r.quantity])
  }
  await db.query('COMMIT')
  const last = (await db.query(`SELECT max(ex_date)::text AS d FROM ${T}`)).rows[0].d
  console.log(`✓ pms_corporate_benefits: added ${add.length}; latest ex-date now ${last}`)
} catch (e) {
  await db.query('ROLLBACK').catch(() => {})
  console.error('✗ import failed, nothing written:', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
