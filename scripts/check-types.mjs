#!/usr/bin/env node
// TypeScript ratchet. The build ignores type errors (next.config.mjs) and the codebase has some, so instead of
// "zero errors" this enforces "no file gets worse": each file's error count must be at or below
// scripts/type-baseline.json. Fixing errors and re-running with --update lowers the baseline for good.
//   node scripts/check-types.mjs            check (CI)
//   node scripts/check-types.mjs --update   rewrite the baseline after fixing errors
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(root, 'scripts/type-baseline.json')

const r = spawnSync('npx', ['tsc', '--noEmit', '-p', '.'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
const lines = (r.stdout + r.stderr).split('\n').filter(l => / error TS\d+/.test(l))
const counts = {}
for (const l of lines) {
  const file = (l.match(/^(.+?)\(\d+,\d+\): error TS/) || [])[1]?.trim()
  if (!file) continue
  if (file.startsWith('.next/')) continue           // generated route types; follow their pages
  counts[file] = (counts[file] || 0) + 1
}
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`Baseline written: ${total} errors in ${Object.keys(sorted).length} files`)
  process.exit(0)
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {}
const worse = Object.entries(counts).filter(([f, n]) => n > (baseline[f] || 0))
const before = Object.values(baseline).reduce((a, b) => a + b, 0)
if (worse.length) {
  console.log('✗ New TypeScript errors:')
  for (const [f, n] of worse) {
    console.log(`  ${f}: ${baseline[f] || 0} → ${n}`)
    for (const l of lines.filter(x => x.startsWith(f + '('))) console.log('    ' + l.slice(f.length))
  }
  process.exit(1)
}
console.log(`✓ No new TypeScript errors (${total} existing, baseline ${before}${total < before ? '; run with --update to lower it' : ''})`)
