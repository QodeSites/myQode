/**
 * Mobile Login Audit Script
 * Queries the DB for all unique clients, then fires a real POST /api/mobile/auth/login
 * for each one (using the dev bypass — no password needed in development).
 *
 * Run from the myQode project root:
 *   node scripts/audit-mobile-login.js
 *
 * Optionally override the API base URL:
 *   API_URL=https://njvbrnd9-2069.inc1.devtunnels.ms/api/mobile node scripts/audit-mobile-login.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const API_BASE = (process.env.API_URL || 'https://njvbrnd9-2069.inc1.devtunnels.ms/api/mobile').replace(/\/$/, '');
const LOGIN_URL = `${API_BASE}/auth/login`;

const pool = new Pool({
  host:     process.env.PG_HOST,
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

// ── Colour helpers ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', grey: '\x1b[90m', magenta: '\x1b[35m',
};
const c  = (col, str) => `${C[col]}${str}${C.reset}`;
const ln = (ch = '─', n = 82) => ch.repeat(n);

// ── Hit the real login endpoint ────────────────────────────────────────────────
async function callLoginAPI(identifier) {
  const t0 = Date.now();
  try {
    const res = await fetch(LOGIN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: identifier, password: '' }),
      signal:  AbortSignal.timeout(10000),
    });
    const ms   = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ms, body, ok: res.ok };
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, body: { error: err.message }, ok: false };
  }
}

async function run() {
  console.log(c('cyan', '\n' + ln('═')));
  console.log(c('bold', '  MOBILE LOGIN AUDIT  —  ' + LOGIN_URL));
  console.log(c('cyan', ln('═')));

  // ── 1. Pull all unique login identities from DB ───────────────────────────
  const dbClient = await pool.connect();
  let allRows;
  try {
    const { rows } = await dbClient.query(`
      SELECT DISTINCT ON (email)
        clientid, clientcode, email, groupid, password,
        head_of_family, onboarding_status, login_count, last_login_at,
        salutation, firstname, middlename, lastname
      FROM pms_clients_master
      ORDER BY email, clientcode
    `);
    allRows = rows;
  } finally {
    dbClient.release();
    await pool.end();
  }

  console.log(`\n  DB: ${allRows.length} unique emails to test against the API\n`);

  // ── 2. Fire API requests (5 at a time to avoid hammering) ─────────────────
  const CONCURRENCY = 5;
  const results = [];

  for (let i = 0; i < allRows.length; i += CONCURRENCY) {
    const batch = allRows.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map(async (row) => {
      const name = [row.salutation, row.firstname, row.middlename, row.lastname]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || row.clientcode;

      const pw  = row.password || '';
      const pwStatus =
        (!pw || pw === 'Qode@123')          ? 'PENDING' :
        (pw.startsWith('$2b$') || pw.startsWith('$2a$')) ? 'HASHED'  : 'PLAIN';

      const api = await callLoginAPI(row.email);

      // Detect issues
      const issues = [];
      if (!api.ok) {
        issues.push(`API returned ${api.status}: ${api.body?.error || api.body?.code || 'unknown'}`);
      }
      if (api.ok && (!api.body.token)) {
        issues.push('Response 200 but no token in body');
      }
      if (api.ok && api.body.user) {
        const codes = api.body.user.accountCodes || [];
        if (codes.length === 0)
          issues.push('Token issued but accountCodes is empty — blank portfolio');
        if (pwStatus === 'PENDING' && api.status === 403)
          issues.push('PASSWORD_SETUP_REQUIRED (expected in prod)');
      }

      return {
        name,
        email:        row.email,
        clientcode:   row.clientcode,
        groupid:      row.groupid,
        isHead:       Boolean(row.head_of_family),
        pwStatus,
        onboarding:   row.onboarding_status,
        loginCount:   row.login_count || 0,
        lastLogin:    row.last_login_at
                        ? new Date(row.last_login_at).toISOString().slice(0, 16)
                        : 'Never',
        apiStatus:    api.status,
        apiMs:        api.ms,
        apiOk:        api.ok,
        token:        api.body?.token ? api.body.token.slice(0, 20) + '…' : null,
        user:         api.body?.user  || null,
        issues,
      };
    }));
    results.push(...settled);

    // Progress indicator
    const done = Math.min(i + CONCURRENCY, allRows.length);
    process.stdout.write(`\r  Testing... ${done}/${allRows.length}`);
  }
  console.log('\n');

  // ── 3. Partition results ───────────────────────────────────────────────────
  const passed    = results.filter(r => r.apiOk && r.token);
  const failed    = results.filter(r => !r.apiOk || !r.token);
  const heads     = results.filter(r => r.isHead);
  const hasIssues = results.filter(r => r.issues.length > 0);

  // ── 4. Summary table ───────────────────────────────────────────────────────
  console.log(c('bold', ln()));
  console.log(c('bold', '  SUMMARY'));
  console.log(ln());
  console.log(`  ${c('green',  '✅ Login succeeded')}  : ${passed.length}`);
  console.log(`  ${c('red',    '❌ Login failed')}     : ${failed.length}`);
  console.log(`  ${c('yellow', '👑 Head of family')}   : ${heads.length}`);
  console.log(`  ${c('red',    '🚨 Issues')}           : ${hasIssues.length}`);

  // ── 5. Passed clients ──────────────────────────────────────────────────────
  console.log('\n' + ln());
  console.log(c('green', c('bold', `  ✅  LOGIN PASSED (${passed.length})`)));
  console.log(ln());
  console.log(
    c('grey',
      `  ${'Name'.padEnd(32)} ${'Email'.padEnd(34)} ${'Codes'.padEnd(20)} ${'HOF'.padEnd(5)} ${'ms'.padEnd(6)} Logins`
    )
  );
  console.log(c('grey', '  ' + '─'.repeat(110)));

  for (const r of passed) {
    const codes = (r.user?.accountCodes || []).join(', ');
    const hof   = r.isHead ? c('yellow', '👑') : '  ';
    const ms    = r.apiMs < 500 ? c('green', r.apiMs+'ms') : c('yellow', r.apiMs+'ms');
    console.log(
      `  ${hof} ${r.name.slice(0, 30).padEnd(30)}  ${r.email.slice(0, 32).padEnd(32)}  ${codes.slice(0, 28).padEnd(28)}  ${ms.padEnd(14)}  ${r.loginCount}`
    );
  }

  // ── 6. Failed clients ──────────────────────────────────────────────────────
  if (failed.length > 0) {
    console.log('\n' + ln());
    console.log(c('red', c('bold', `  ❌  LOGIN FAILED (${failed.length})`)));
    console.log(ln());
    for (const r of failed) {
      const hof = r.isHead ? c('yellow', ' 👑 HEAD') : '      ';
      console.log(`\n${hof}  ${c('bold', r.name)}`);
      console.log(c('grey', `         email      : `) + r.email);
      console.log(c('grey', `         clientcode : `) + r.clientcode);
      console.log(c('grey', `         pw status  : `) + (r.pwStatus === 'HASHED' ? c('green', r.pwStatus) : c('red', r.pwStatus)));
      console.log(c('grey', `         onboarding : `) + r.onboarding);
      console.log(c('grey', `         api status : `) + c('red', String(r.apiStatus)) + `  (${r.apiMs}ms)`);
      for (const iss of r.issues)
        console.log(`         ${c('yellow', '⚠️  ')}${iss}`);
    }
  }

  // ── 7. Head-of-family deep check ──────────────────────────────────────────
  if (heads.length > 0) {
    console.log('\n' + ln());
    console.log(c('yellow', c('bold', '  👑  HEAD-OF-FAMILY ACCESS AUDIT')));
    console.log(ln());
    for (const r of heads) {
      const codes = r.user?.accountCodes || [];
      console.log(`\n  ${c('yellow', '👑')}  ${c('bold', r.name)}`);
      console.log(c('grey', `      email         : `) + r.email);
      console.log(c('grey', `      groupid        : `) + (r.groupid || c('red', 'NULL ⚠️')));
      console.log(c('grey', `      api status     : `) + (r.apiOk ? c('green', '200 OK') : c('red', String(r.apiStatus))));
      console.log(c('grey', `      accountCodes   : `) + (codes.length ? codes.join(', ') : c('red', 'EMPTY')));
      console.log(c('grey', `      codes count    : `) + codes.length);
    }
  }

  // ── 8. Issues summary ─────────────────────────────────────────────────────
  if (hasIssues.length > 0) {
    console.log('\n' + ln());
    console.log(c('red', c('bold', '  🚨  ISSUES FOUND')));
    console.log(ln());
    for (const r of hasIssues) {
      console.log(`\n  ${c('bold', r.name)}  ${c('grey', r.email)}`);
      for (const iss of r.issues)
        console.log(`    ${c('yellow', '⚠️')}  ${iss}`);
    }
  }

  // ── 9. Performance summary ────────────────────────────────────────────────
  if (passed.length > 0) {
    const times  = passed.map(r => r.apiMs).sort((a, b) => a - b);
    const avg    = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
    const median = times[Math.floor(times.length / 2)];
    const p95    = times[Math.floor(times.length * 0.95)];
    const slow   = passed.filter(r => r.apiMs > 1000);

    console.log('\n' + ln());
    console.log(c('cyan', c('bold', '  ⚡  LOGIN API PERFORMANCE')));
    console.log(ln());
    console.log(`  avg: ${avg}ms  |  median: ${median}ms  |  p95: ${p95}ms  |  slowest: ${times[times.length-1]}ms`);
    if (slow.length > 0) {
      console.log(c('yellow', `\n  Slow logins (>1000ms):`));
      for (const r of slow)
        console.log(`    ${r.name.padEnd(32)} ${r.apiMs}ms`);
    }
  }

  console.log('\n' + c('cyan', ln('═')));
  console.log(c('bold', '  AUDIT COMPLETE'));
  console.log(c('cyan', ln('═') + '\n'));
}

run().catch(err => {
  console.error(c('red', '\nFATAL: ' + err.message));
  process.exit(1);
});
