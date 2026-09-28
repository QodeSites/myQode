// Imports Nuvama WealthSpectrum's "Profit and loss account - Balance sheet" export (all clients, one CSV) into
// PG_DATABASE1 → pms_clients_tracker.pms_pnl_balance_sheet, one row per account and period. The reports endpoints
// (lib/reportsData.ts pnlReport / balanceSheetReport) serve a stored report when one exists for exactly the requested
// account(s) and period; any other period is computed by lib/plbsCompute.ts.
//
//   node scripts/import-nuvama-pnl.mjs [--file reports/Z1713_144_ProfitLossAccount1213UT.csv] [--dir reports] [--dry-run]
//
// --dry-run parses the file and prints what would be loaded, without connecting to the database. Re-runnable: the
// rows for each (period_from, period_to) in the file are replaced inside one transaction.
//
// File layout (per account, repeated): a "PROFIT AND LOSS ACCOUNT - BALANCE SHEET" title row; "Account : <ws id>
// <NAME> - <CODE>"; the strategy; "From dd/mm/yyyy to dd/mm/yyyy"; INCOME and EXPENSES lines (amount in column 5)
// with TOTAL rows; SURPLUS FOR THE PERIOD; the unrealised block (levels in column 4, nets in column 5, then an
// unlabelled combined net); a print-date row; LIABILITIES and ASSETS (sub-lines in column 5, group amounts in column
// 6, unlabelled rows = the current liabilities / current assets subtotal). Lines are stored under the keys of
// lib/plbsCompute.ts (LINE_LABELS); a label not listed below is kept as "x:<section>:<label>" so nothing is lost.
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const DRY = process.argv.includes('--dry-run')
const DIR = arg('dir', 'reports')
const FILE = arg('file') || (() => { const f = fs.readdirSync(DIR).find(x => /ProfitLossAccount.*\.csv$/i.test(x)); return f ? path.join(DIR, f) : null })()
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: node scripts/import-nuvama-pnl.mjs [--file <csv>] [--dir reports] [--dry-run]'); process.exit(1) }

const S = 'pms_clients_tracker'
const DDL = `
CREATE TABLE IF NOT EXISTS ${S}.pms_pnl_balance_sheet (
  account_code text NOT NULL, period_from date NOT NULL, period_to date NOT NULL,
  ws_client_id text, client_name text, strategy text, printed_on date, lines jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (account_code, period_from, period_to));`

// ── parsing ────────────────────────────────────────────────────────────────────────────────────────────────
// RFC 4180 rows (quoted fields may hold commas); the file is ~1 MB, so it is read whole.
function csvRows(text) {
  const out = []; let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); out.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); out.push(row) }
  return out
}
const num = v => { const s = String(v ?? '').replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(s) ? +s : null }
const dmy = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const clean = s => String(s || '').replace(/\s+/g, ' ').trim()

// Nuvama label → key (lib/plbsCompute.ts), per section.
const KEYS = {
  INCOME: { Dividend: 'dividend', Interest: 'interest', 'Realized Gain/Loss': 'realised', TOTAL: 'incomeTotal' },
  EXPENSES: { 'Custodian Fees': 'custodian', 'Management Fees': 'management', 'Securities Transaction Tax (STT)': 'stt', 'Other Expenses': 'other', TOTAL: 'expenseTotal' },
  UNREAL: {
    'At the end of the period': 'eqEnd', 'At the beginning of the period': 'eqBegin', 'Net Unrealized Gain / Loss during the period': 'eqNet',
    'At the end of the period (Options)': 'optEnd', 'At the beginning of the period (Options)': 'optBegin',
    'Net Unrealized Gain / Loss during the period (Options)': 'optNet', '': 'unrealisedNet',
  },
  LIABILITIES: {
    'Capital Contribution': 'capital', 'Less : Withdrawals': 'withdrawals', '- Beginning': 'reservesBegin', '- For the period': 'reservesPeriod',
    '- Ending': 'reservesEnd', 'Payable against Purchases': 'payablePurchases', 'Custodian Fees - billed / payable': 'custodianPayable',
    'Management Fees - billed / payable': 'managementPayable', 'Other Expenses - billed / payable': 'otherPayable', '': 'currentLiabilities', TOTAL: 'liabilitiesTotal',
  },
  ASSETS: {
    'Investments - At Cost': 'investmentsAtCost', 'Net Options Purchase Position': 'optionsPosition', 'Futures Margin Account': 'futuresMargin',
    'Options Margin Account': 'optionsMargin', 'Balance with Banks': 'bank', 'Receivable against Sale': 'receivableSale',
    'Outstanding Dividend': 'outstandingDividend', '': 'currentAssets', TOTAL: 'assetsTotal',
  },
}
const XSECTION = { INCOME: 'income', EXPENSES: 'expenses', LIABILITIES: 'liab', ASSETS: 'assets', UNREAL: 'unreal' }

function parse(text) {
  const reports = []
  let cur = null, sec = null
  for (const r of csvRows(text.replace(/^﻿/, ''))) {
    const c = r.map(clean)
    if (c[0] === 'PROFIT AND LOSS ACCOUNT - BALANCE SHEET') { cur = { lines: {}, unknown: [] }; reports.push(cur); sec = 'HEAD'; continue }
    if (!cur) continue
    if (c[0].startsWith('Account :')) {
      const m = c[0].match(/^Account :\s*(\d+)\s+(.*?)\s*-\s*([A-Z]{3}\d+)\s*$/)
      if (m) { cur.wsId = m[1]; cur.name = m[2]; cur.code = m[3] }
      continue
    }
    if (c[0].startsWith('From ')) { const m = c[0].match(/From (\S+) to (\S+)/); cur.from = dmy(m && m[1]); cur.to = dmy(m && m[2]); continue }
    if (sec === 'HEAD' && c[0] && c[0] !== 'INCOME') { cur.strategy = c[0]; continue }
    if (['INCOME', 'EXPENSES', 'LIABILITIES', 'ASSETS'].includes(c[0])) { sec = c[0]; continue }
    // Print-date rows ("28/09/2026" alone in the last column).
    const dateOnly = c.filter(Boolean)
    if (dateOnly.length === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(dateOnly[0])) { cur.printedOn = dmy(dateOnly[0]); continue }
    const labels = c.slice(0, 4).filter(x => x && num(x) == null)
    const vals = c.map((x, i) => [i, num(x)]).filter(([i, v]) => v != null && i >= 3)
    if (labels[0] === 'SURPLUS FOR THE PERIOD') { cur.lines.surplus = vals[0] ? vals[0][1] : 0; sec = 'UNREAL'; continue }
    if (labels[0] === 'UNREALIZED GAIN/LOSS IN THE VALUE OF INVESTMENTS') continue
    if (!vals.length) continue
    // "Add : Reserves and Surplus" shares its row with " - Beginning".
    const label = labels.length > 1 && labels[0].startsWith('Add : Reserves') ? labels[1] : (labels[labels.length - 1] || '')
    const key = (KEYS[sec] || {})[label] ?? `x:${XSECTION[sec] || 'other'}:${label || 'subtotal'}`
    if (key.startsWith('x:')) cur.unknown.push(label || '(unlabelled)')
    cur.lines[key] = vals[0][1]
  }
  return reports.filter(x => x.code && x.from && x.to)
}

const reports = parse(fs.readFileSync(FILE, 'utf8'))
const periods = [...new Set(reports.map(x => `${x.from}|${x.to}`))]
const unknown = [...new Set(reports.flatMap(x => x.unknown))]
console.log(`${path.basename(FILE)}: ${reports.length} accounts, periods ${periods.map(p => p.replace('|', ' to ')).join(', ')}`)
if (unknown.length) console.log(`  labels kept as extra lines: ${unknown.join('; ')}`)
const unbalanced = reports.filter(x => Math.abs((x.lines.liabilitiesTotal || 0) - (x.lines.assetsTotal || 0)) > 1)
if (unbalanced.length) console.log(`  ${unbalanced.length} report(s) where Nuvama's liabilities and assets differ by more than ₹1: ${unbalanced.map(x => x.code).join(', ')}`)
if (DRY) { console.log('dry run: nothing written'); process.exit(0) }

const e = process.env
const client = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE1, password: e.PG_PASSWORD, port: +e.PG_PORT, statement_timeout: 0 })
await client.connect()
await client.query(DDL)
await client.query('BEGIN')
try {
  for (const p of periods) {
    const [from, to] = p.split('|')
    await client.query(`DELETE FROM ${S}.pms_pnl_balance_sheet WHERE period_from = $1 AND period_to = $2`, [from, to])
  }
  const cols = ['account_code', 'period_from', 'period_to', 'ws_client_id', 'client_name', 'strategy', 'printed_on', 'lines']
  for (let i = 0; i < reports.length; i += 500) {
    const batch = reports.slice(i, i + 500), params = []
    const tuples = batch.map((x, k) => {
      params.push(x.code, x.from, x.to, x.wsId || null, x.name || null, x.strategy || null, x.printedOn || null, JSON.stringify(x.lines))
      return '(' + cols.map((_, j) => '$' + (k * cols.length + j + 1)).join(',') + ')'
    })
    await client.query(`INSERT INTO ${S}.pms_pnl_balance_sheet (${cols.join(',')}) VALUES ${tuples.join(',')}
      ON CONFLICT (account_code, period_from, period_to) DO UPDATE SET ws_client_id = EXCLUDED.ws_client_id, client_name = EXCLUDED.client_name,
        strategy = EXCLUDED.strategy, printed_on = EXCLUDED.printed_on, lines = EXCLUDED.lines, created_at = now()`, params)
  }
  await client.query('COMMIT')
  console.log(`✓ pms_pnl_balance_sheet: ${reports.length} reports loaded`)
} catch (err) { await client.query('ROLLBACK'); throw err }
await client.end()
