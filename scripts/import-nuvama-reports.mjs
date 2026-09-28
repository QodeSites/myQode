// Imports Nuvama WealthSpectrum report exports (all clients, one file per report) into PG_DATABASE1 for the
// mobile app's Reports screens (app/api/mobile/reports/*).
//
//   node scripts/import-nuvama-reports.mjs --as-of 2026-09-25 [--dir reports]
//
// Files are matched by name in --dir: *CapitalGain*.csv, *Expensestmt*.csv, *PortFolioFactSheet*.csv (any
// that are missing are skipped). Re-runnable: each report's rows for that --as-of date are replaced inside one
// transaction, so the app never sees a half-loaded report. Transactions are not imported here — they are
// already in pms_clients_tracker.pms_transactions.
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const AS_OF = arg('as-of')
const DIR = arg('dir', 'reports')
if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF || '')) { console.error('usage: node scripts/import-nuvama-reports.mjs --as-of YYYY-MM-DD [--dir reports]'); process.exit(1) }

const S = 'pms_clients_tracker'
const DDL = `
CREATE TABLE IF NOT EXISTS ${S}.pms_capital_gains (
  id bigserial PRIMARY KEY, as_of_date date NOT NULL, ws_client_id text, account_code text NOT NULL,
  category text, term text, security_type text, isin text, security_code text, security_name text,
  sale_date date, sale_qty numeric, sale_rate numeric, sale_amount numeric,
  purchase_date date, purchase_qty numeric, purchase_rate numeric, purchase_amount numeric,
  fmv_31jan2018 numeric, effective_cost numeric, days_held integer, realized_gain numeric, effective_gain_lt numeric,
  created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS pms_capital_gains_acct_idx ON ${S}.pms_capital_gains (account_code, as_of_date, sale_date DESC);

CREATE TABLE IF NOT EXISTS ${S}.pms_expense_statement (
  id bigserial PRIMARY KEY, as_of_date date NOT NULL, ws_client_id text, account_code text NOT NULL, strategy text,
  period_from date, period_to date, status text, txn_date date, settlement_date date, tran_ref text,
  detail text, notes text, amount numeric, created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS pms_expense_statement_acct_idx ON ${S}.pms_expense_statement (account_code, as_of_date, txn_date DESC);

CREATE TABLE IF NOT EXISTS ${S}.pms_factsheet (
  account_code text NOT NULL, as_of_date date NOT NULL, ws_client_id text, strategy text, inception_date date,
  contribution numeric, withdrawal numeric, profit_loss numeric, portfolio_value numeric, value_date date,
  returns jsonb, sectors jsonb, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (account_code, as_of_date));
ALTER TABLE ${S}.pms_factsheet ADD COLUMN IF NOT EXISTS holdings jsonb;`

// ── parsing helpers ────────────────────────────────────────────────────────────────────────────────────────
// Streaming RFC 4180 reader: yields arrays of fields; quoted fields may contain commas and newlines.
async function* csvRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  let row = [], field = '', inQ = false, first = true
  for await (let line of rl) {
    if (first) { line = line.replace(/^﻿/, ''); first = false }
    if (inQ) field += '\n'
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { field += '"'; i++ } else inQ = false }
        else field += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') { row.push(field); field = '' }
      else field += ch
    }
    if (!inQ) { row.push(field); yield row; row = []; field = '' }
  }
  if (row.length || field) { row.push(field); yield row }
}
const num = v => { if (v == null) return null; const s = String(v).replace(/[,\s%]/g, ''); if (s === '' || s === '-' || /^n\.?a\.?$/i.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? n : null }
const dmy = v => { const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
// "KARAN … - QFH0008" / "14410001 KARAN … - QFH0008" → QFH0008 (the app's account code = pms_clients_master.clientcode)
const codeOf = s => { const m = String(s || '').match(/-\s*([A-Z]{3}\d{3,6})\s*$/); return m ? m[1] : null }
const cells = r => r.map(c => String(c).trim()).filter(Boolean)
const clean = s => String(s || '').replace(/&amp;?/g, '&').replace(/\s+/g, ' ').trim()

// ── Capital gains: one flat table ─────────────────────────────────────────────────────────────────────────
async function* capitalGains(file) {
  let head = null
  for await (const r of csvRows(file)) {
    if (!head) { head = r.map(h => h.trim()); continue }
    if (r.length < 20) continue
    const g = k => r[head.indexOf(k)]
    const code = codeOf(g('Client Name'))
    if (!code) continue
    yield [AS_OF, g('Client ID')?.trim(), code, clean(g('Remarks')), g('Gain Loss Flag')?.trim(), g('Security Type')?.trim(),
      g('ISIN')?.trim() || null, g('Security Code')?.trim(), clean(g('Security')),
      dmy(g('Sale Date')), num(g('Sale Quantity')), num(g('Sale Rate (S)')), num(g('Sale Amount')),
      dmy(g('Purchase Date')), num(g('Purchase Quantity')), num(g('Purchase Rate (P)')), num(g('Purchase Amount')),
      num(g('Price on 31-jan-18 (M)')), num(g('Effective Cost/Indexed Cost')), num(g('Days Held')),
      num(g('Realized Gain/Loss')), num(g('Effective Gain-LT'))]
  }
}
const CG_COLS = ['as_of_date', 'ws_client_id', 'account_code', 'category', 'term', 'security_type', 'isin', 'security_code', 'security_name',
  'sale_date', 'sale_qty', 'sale_rate', 'sale_amount', 'purchase_date', 'purchase_qty', 'purchase_rate', 'purchase_amount',
  'fmv_31jan2018', 'effective_cost', 'days_held', 'realized_gain', 'effective_gain_lt']

// ── Expense statement: one block per account ──────────────────────────────────────────────────────────────
async function* expenses(file) {
  let acct = null, status = null
  for await (const r of csvRows(file)) {
    const c0 = (r[0] || '').trim()
    if (c0 === 'STATEMENT OF EXPENSES') { acct = { strategy: null, from: null, to: null }; status = null; continue }
    if (!acct) continue
    if (c0.startsWith('Account :')) { const m = c0.match(/^Account :\s*(\d+)/); acct.clientId = m && m[1]; acct.code = codeOf(c0); continue }
    if (c0.startsWith('From ')) { const m = c0.match(/From (\S+) to (\S+)/); if (m) { acct.from = dmy(m[1]); acct.to = dmy(m[2]) } continue }
    if (!acct.strategy && /^QODE /.test(c0)) { acct.strategy = clean(c0); continue }
    if (c0 === 'Expenses - Paid') { status = 'paid'; continue }
    if (c0 === 'Expenses - Payable') { status = 'payable'; continue }
    if (/^Total/.test(c0)) { continue }
    const d = dmy(c0)
    if (d && status && acct.code) {
      yield [AS_OF, acct.clientId, acct.code, acct.strategy, acct.from, acct.to, status, d, dmy(r[1]), (r[2] || '').trim() || null,
        clean(r[3]), clean(r[4]) || null, num(r[5])]
    }
  }
}
const EX_COLS = ['as_of_date', 'ws_client_id', 'account_code', 'strategy', 'period_from', 'period_to', 'status', 'txn_date', 'settlement_date',
  'tran_ref', 'detail', 'notes', 'amount']

// ── Fact sheet: one block per account (summary, TWRR vs benchmark, sector allocation, holdings) ───────────
// Two-column print layout: columns 0-8 hold the summary / returns / sectors, columns 9+ the "Portfolio Holdings"
// table (Sr., Security, Sector, Mkt Value, %Assets) on the same rows — so each side is read separately.
async function* factsheets(file) {
  let f = null, mode = null
  const done = () => f && f.code ? [f.code, AS_OF, f.clientId, f.strategy, f.inception, f.contribution, f.withdrawal, f.pl, f.value, f.valueDate,
    JSON.stringify(f.returns), JSON.stringify(f.sectors), JSON.stringify(f.holdings)] : null
  for await (const r of csvRows(file)) {
    const c = cells(r.slice(0, 9)), c0 = c[0] || '', h = cells(r.slice(9))
    if (f && /^\d+$/.test(h[0] || '') && h.length >= 5) f.holdings.push({ security: clean(h[1]), sector: clean(h[2]), value: num(h[3]), pct: num(h[4]) })
    if (/^Strategy:/.test(c0)) {
      const prev = done(); if (prev) yield prev
      f = { strategy: clean(c0.replace(/^Strategy:/, '')), sectors: [], holdings: [], returns: null }; mode = null; continue
    }
    if (!f) continue
    if (/^Account:/.test(c0)) { const m = c0.match(/^Account:\s*(\d+)/); f.clientId = m && m[1]; f.code = codeOf(c0); continue }
    if (/^Inception Date:/.test(c0)) { f.inception = dmy(c0.replace(/^Inception Date:/, '')); continue }
    if (/^Sector Allocation/.test(c0)) { mode = 'sector'; continue }
    if (mode === 'sector' && /^\d+$/.test(c0) && c.length >= 3) { f.sectors.push({ sector: clean(c[1]), pct: num(c[2]) }); continue }
    if (c0 === 'Portfolio Summary') { mode = 'summary'; continue }
    if (c0 === 'Contribution') { f.contribution = num(c[1]); continue }
    if (c0 === 'Withdrawal') { f.withdrawal = num(c[1]); continue }
    if (c0 === 'Profit/Loss') { f.pl = num(c[1]); continue }
    if (/^Portfolio Value\(/.test(c0)) { f.valueDate = dmy((c0.match(/\((.*)\)/) || [])[1]); f.value = num(c[1]); continue }
    if (/^Performance\(TWRR\)/.test(c0)) { mode = 'perf'; f.returns = { periods: null, portfolio: null, benchmark: null }; continue }
    if (mode === 'perf') {
      if (!f.returns.periods && c.length && c.every(x => /^(\d+[my]|since\b.*)$/i.test(x))) { f.returns.periods = c; continue }
      if (f.returns.periods && c0 === 'Portfolio') { f.returns.portfolio = c.slice(1).map(num); continue }
      if (f.returns.periods && f.returns.portfolio && !f.returns.benchmark && c.length > 1 && !/^Portfolio returns/.test(c0)) {
        f.returns.benchmark = { name: clean(c0), values: c.slice(1).map(num) }; mode = null; continue
      }
    }
  }
  const last = done(); if (last) yield last
}
const FS_COLS = ['account_code', 'as_of_date', 'ws_client_id', 'strategy', 'inception_date', 'contribution', 'withdrawal', 'profit_loss',
  'portfolio_value', 'value_date', 'returns', 'sectors', 'holdings']

// ── load ───────────────────────────────────────────────────────────────────────────────────────────────────
async function load(client, table, cols, rows, dateCol = 'as_of_date') {
  await client.query('BEGIN')
  try {
    await client.query(`DELETE FROM ${S}.${table} WHERE ${dateCol} = $1`, [AS_OF])
    let batch = [], n = 0
    const flush = async () => {
      if (!batch.length) return
      const params = [], tuples = batch.map((row, i) => '(' + row.map((v, j) => { params.push(v); return '$' + (i * cols.length + j + 1) }).join(',') + ')')
      await client.query(`INSERT INTO ${S}.${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params)
      n += batch.length; batch = []
    }
    for await (const row of rows) { batch.push(row); if (batch.length >= Math.floor(60000 / cols.length)) await flush() }
    await flush()
    await client.query('COMMIT')
    return n
  } catch (e) { await client.query('ROLLBACK'); throw e }
}

const e = process.env
const client = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE1, password: e.PG_PASSWORD, port: +e.PG_PORT, statement_timeout: 0 })
await client.connect()
await client.query(DDL)
const files = fs.readdirSync(DIR)
const find = re => { const f = files.find(x => re.test(x)); return f ? path.join(DIR, f) : null }
const jobs = [
  ['pms_capital_gains', CG_COLS, find(/CapitalGain.*\.csv$/i), capitalGains],
  ['pms_expense_statement', EX_COLS, find(/Expensestmt.*\.csv$/i), expenses],
  ['pms_factsheet', FS_COLS, find(/PortFolioFactSheet.*\.csv$/i), factsheets],
]
for (const [table, cols, file, parse] of jobs) {
  if (!file) { console.log(`- ${table}: no file in ${DIR}, skipped`); continue }
  const t = Date.now()
  const n = await load(client, table, cols, parse(file))
  const a = await client.query(`SELECT count(DISTINCT account_code) a FROM ${S}.${table} WHERE as_of_date = $1`, [AS_OF])
  console.log(`✓ ${table}: ${n} rows, ${a.rows[0].a} accounts (${((Date.now() - t) / 1000).toFixed(1)}s) ← ${path.basename(file)}`)
}
await client.end()
