# Distributor Module Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Zoho-connected distributor portal at `/distributors`, plus an admin-gated internal overview at `/distributors/internal`.

**Architecture:** Session email resolves to a distributor row in `pms_clients_master` (`clientcode IS NULL`), whose `clientname` joins to a Zoho `Distributor` record via `Email` OR `Secondary_Email`. That record's ID scopes a COQL query against `Investors.Primary_distributo` for journey data. The internal surface reuses the existing `admin-session` cookie with server-side Redis validation.

**Tech Stack:** Next.js 15.5 (App Router), React 18.3, Tailwind v4 (CSS config, no `tailwind.config.ts`), shadcn/ui, `pg`, Zoho CRM COQL v3.

**Spec:** `docs/superpowers/specs/2026-08-20-distributor-module-zoho-design.md`

## Global Constraints

- **Do not touch the fees module.** No edits to `lib/zohoDistributorFees.ts`, `lib/feeEngine.ts`, `lib/zohoInvestorFees.ts`, `app/api/distributor/calculator/`, or anything under `app/(protected)/distributor/fees-distribution/`. Verified by a git check in every commit step.
- **No new colors or fonts.** Semantic Tailwind tokens only (`bg-card`, `text-primary`, `text-muted-foreground`, `border-border/20`). Fonts are Lato + Playfair Display, already global. No new gradients.
- **Build from `components/ui/` primitives** — never hand-roll parallels.
- **Mobile must work at ~375px.** Tables get `overflow-x-auto`; the page body never scrolls horizontally.
- **Currency:** `toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. Dates render as `07 Jul 2026`.
- **Empty/error states say what happened and what to do next** — never a bare "No data".
- **No test framework exists in this repo** (no jest/vitest, no `test` script). Verification is via runnable Node probe scripts against live Zoho/Postgres, plus `npm run build`. Probe scripts are written to the scratchpad, never committed.
- **Never trust middleware for authorization** — it only checks cookie existence (`middleware.ts:63`). Always call `getSession()` server-side.
- **Buttons:** the `default` variant is broken (white on cream). Use `variant="secondary"` with `bg-primary text-primary-foreground` overrides, or `variant="outline"`.

**Scratchpad path** (for probe scripts, referenced throughout): use the
session scratchpad directory given in the environment prompt, referred to
below as `<scratchpad>`.

> Do not paste an absolute Windows path into any file under `docs/`. Tailwind
> v4 scans this directory for class names, and a backslash followed by hex
> characters (as in `...\dec293...`) parses as a CSS unicode escape — which
> threw `RangeError: Invalid code point` and broke every page build until the
> path was removed. Keep paths POSIX-style or symbolic here.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/distributorIdentity.ts` | Session email → distributor row. DB only, no Zoho. |
| `lib/zohoDistributorJourney.ts` | Zoho reads: distributor record lookup + investor journey. Self-contained. |
| `app/api/distributor/journey/route.ts` | Distributor-scoped endpoint. |
| `app/api/distributor/internal-overview/route.ts` | Admin-gated, all distributors. |
| `app/(protected)/distributors/page.tsx` | Distributor surface: links, journey, payout, contact. |
| `app/(protected)/distributors/internal/page.tsx` | Internal overview. |
| `middleware.ts` | One matcher entry (redirect UX only). |

---

### Task 1: Distributor identity resolution

**Files:**
- Create: `lib/distributorIdentity.ts`
- Verify: scratchpad probe (not committed)

**Interfaces:**
- Consumes: `query` from `@/lib/db`
- Produces:
  - `type DistributorIdentity = { email: string; clientname: string }`
  - `resolveDistributorByEmail(email: string | null | undefined): Promise<DistributorIdentity | null>`
  - `getDistributorClientCount(clientname: string): Promise<number>`

- [ ] **Step 1: Write the module**

```typescript
// Distributor identity, resolved from the portal session.
//
// WHY `clientcode IS NULL` IDENTIFIES A DISTRIBUTOR
// pms_clients_master holds both investors and distributors. Verified against
// production on 2026-08-20: of 548 rows, exactly 16 have clientcode IS NULL,
// and all 16 sit under intermediaryname = 'QODE ADVISORS LLP INT'. No
// null-code row exists under any other intermediary, and every client row has
// a code. So a null clientcode is an exact discriminator, not a heuristic.
//
// A distributor's clients are the rows where intermediaryname = their
// clientname — the same mechanism app/api/distributor/clients uses.
import { query } from "@/lib/db";

export type DistributorIdentity = {
  /** Lowercased login email. */
  email: string;
  /**
   * The distributor's name as stored in the portal DB.
   *
   * This — NOT Zoho's `Name` — is the string the onboarding app expects in
   * its ?distributor= parameter. Verified: the DB holds "One Battalion
   * Ventures Private Limited", matching the live referral link, while Zoho's
   * Name is the truncated "One Battalion Ventures".
   */
  clientname: string;
};

/**
 * Resolves a session email to a distributor, or null when the email belongs
 * to an investor (or nobody). Callers MUST treat null as "not a distributor"
 * and refuse access — this function is the authorization check.
 */
export async function resolveDistributorByEmail(
  email: string | null | undefined,
): Promise<DistributorIdentity | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;

  const result = await query(
    `SELECT clientname, email
       FROM pms_clients_master
      WHERE lower(email) = $1
        AND clientcode IS NULL
      LIMIT 1`,
    [key],
  );

  const row = result.rows?.[0];
  if (!row?.clientname) return null;

  return { email: key, clientname: String(row.clientname) };
}

/** How many client accounts sit under this distributor. */
export async function getDistributorClientCount(clientname: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS n
       FROM pms_clients_master
      WHERE intermediaryname = $1`,
    [clientname],
  );
  return Number(result.rows?.[0]?.n ?? 0);
}
```

- [ ] **Step 2: Verify against the live database**

Write `<scratchpad>/verify-identity.mjs`, run it from the **repo root** (so `node_modules` resolves):

```javascript
import fs from 'fs'; import pg from 'pg';
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const c = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE,
  password: e.PG_PASSWORD, port: Number(e.PG_PORT || 5432), ssl: { rejectUnauthorized: false } });
await c.connect();
const distributors = await c.query(
  `SELECT clientname, email FROM pms_clients_master WHERE clientcode IS NULL ORDER BY clientname`);
console.log('distributor rows:', distributors.rowCount);
const leak = await c.query(
  `SELECT COUNT(*)::int n FROM pms_clients_master
    WHERE clientcode IS NULL AND intermediaryname <> 'QODE ADVISORS LLP INT'`);
console.log('null-code rows outside QODE ADVISORS (must be 0):', leak.rows[0].n);
const investor = await c.query(
  `SELECT COUNT(*)::int n FROM pms_clients_master
    WHERE clientcode IS NOT NULL AND clientcode <> ''`);
console.log('rows WITH a clientcode (never distributors):', investor.rows[0].n);
console.log(distributors.rows.map(r => `  ${r.clientname} <${r.email}>`).join('\n'));
await c.end();
```

Run: `node <scratchpad>/verify-identity.mjs`

Expected: `distributor rows: 16`, `null-code rows outside QODE ADVISORS (must be 0): 0`, and 16 named rows each with an email. If the leak count is non-zero, **stop** — the discriminator is no longer exact and the spec's finding 1 must be revisited before proceeding.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors originating in `lib/distributorIdentity.ts`. (Pre-existing errors elsewhere in the repo are out of scope — do not fix them.)

- [ ] **Step 4: Commit**

```bash
git add lib/distributorIdentity.ts
git commit -m "feat(distributor): resolve distributor identity from session email

clientcode IS NULL is an exact discriminator, verified against production:
16 of 548 rows, all under QODE ADVISORS LLP INT, zero elsewhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Zoho journey library

**Files:**
- Create: `lib/zohoDistributorJourney.ts`
- Verify: scratchpad probe (not committed)

**Interfaces:**
- Consumes: `getZohoAccessToken`, `zohoApiDomain` from `@/lib/zoho` (read-only imports; the fees module is not involved)
- Produces:
  - `type InvestorJourneyStage` (union of the six live stage strings)
  - `type JourneyClient = { name: string | null; email: string | null; stage: string | null; stageEntryDate: string | null; activationDate: string | null; accountLiveDate: string | null; firstTopUpDate: string | null }`
  - `type DistributorJourney = { zohoId: string; zohoName: string | null; clients: JourneyClient[]; stageCounts: Record<string, number> }`
  - `findDistributorZohoId(email: string): Promise<{ id: string; name: string | null } | null>`
  - `getJourneyForDistributor(email: string): Promise<DistributorJourney | null>`
  - `getAllDistributorJourneys(): Promise<Map<string, DistributorJourney>>`
  - `STAGE_ORDER: readonly string[]`

- [ ] **Step 1: Write the module**

```typescript
// Distributor client-journey data, sourced from Zoho CRM.
//
// DELIBERATELY SELF-CONTAINED
// This module does its own Distributor lookup rather than importing from
// lib/zohoDistributorFees.ts. The fees module drives real payouts and is
// explicitly out of scope for this work, so nothing here may change its
// behaviour. The duplicated email-indexing is the accepted cost.
//
// WHY THE EMAIL LOOKUP CHECKS TWO FIELDS
// A distributor's portal login is usually NOT their Zoho primary Email.
// Verified 2026-08-20: advisory@onebattalion.in, altassets.ops@fundsindia.com,
// info@ensofinserv.com and rahulshetty42@gmail.com are all Secondary_Email.
// An Email-only lookup would fail for most distributors.
//
// Matching is EXACT and never fuzzy: rahulshetty42@gmail.com and
// rahulshetty432@gmail.com are two different real addresses. A near-miss match
// would show one distributor another's clients.
//
// WHY JOURNEY DATA COMES FROM Investors, NOT Leads
// Lead_Stage is effectively binary in production (105 of 112 distributor leads
// read "Onboarding Investor", 7 read "Lost Lead"). Investor_Stage carries the
// real funnel. Leads convert to Investors already, so nothing is lost.
import { getZohoAccessToken, zohoApiDomain } from "@/lib/zoho";

/** The six values present in production, funnel order first, drops last. */
export const STAGE_ORDER = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
  "Dropped before account opening",
  "Dropped after account opening",
] as const;

export type InvestorJourneyStage = (typeof STAGE_ORDER)[number];

export type JourneyClient = {
  name: string | null;
  email: string | null;
  stage: string | null;
  stageEntryDate: string | null;
  activationDate: string | null;
  /** Zoho's Date_Of_1st_Investment, labelled "Account live date" in the CRM. */
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
};

export type DistributorJourney = {
  zohoId: string;
  zohoName: string | null;
  clients: JourneyClient[];
  stageCounts: Record<string, number>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let journeyCache: { data: Map<string, DistributorJourney>; expiresAt: number } | null = null;

async function coql(selectQuery: string): Promise<any[]> {
  const token = await getZohoAccessToken();
  const res = await fetch(`${zohoApiDomain()}/crm/v3/coql`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ select_query: selectQuery }),
    cache: "no-store",
  });

  if (res.status === 204) return [];
  if (!res.ok) {
    throw new Error(`Zoho COQL failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: any[] };
  return body.data ?? [];
}

/** Escapes a value for safe interpolation into a COQL string literal. */
function coqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function tallyStages(clients: JourneyClient[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stage of STAGE_ORDER) counts[stage] = 0;
  for (const c of clients) {
    const key = c.stage ?? "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function mapClient(r: any): JourneyClient {
  return {
    name: r.Name ?? null,
    email: r.Email ?? null,
    stage: r.Investor_Stage ?? null,
    stageEntryDate: r.Stage_Entry_Date ?? null,
    activationDate: r.Activation_Date ?? null,
    accountLiveDate: r.Date_Of_1st_Investment ?? null,
    firstTopUpDate: r.First_Top_Up_Date ?? null,
  };
}

/**
 * Finds a distributor's Zoho record by exact match on Email or Secondary_Email.
 * Returns null when Zoho has no record for that address.
 */
export async function findDistributorZohoId(
  email: string,
): Promise<{ id: string; name: string | null } | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;
  const lit = coqlLiteral(key);

  const rows = await coql(
    `select id, Name, Email, Secondary_Email
       from Distributor
      where Email = '${lit}' or Secondary_Email = '${lit}'
      limit 0, 2`,
  );

  const row = rows[0];
  if (!row?.id) return null;
  return { id: String(row.id), name: row.Name ?? null };
}

/**
 * The journey for ONE distributor, scoped by their Zoho record ID.
 *
 * The Zoho ID is resolved from the caller's own session email and the WHERE
 * clause is applied server-side, so the query can only ever return that
 * distributor's investors. Never widen this filter for a distributor-facing
 * caller.
 *
 * Note: `Primary_distributo` is spelled exactly as Zoho defines it — the typo
 * is in the CRM's API name, not here.
 */
export async function getJourneyForDistributor(
  email: string,
): Promise<DistributorJourney | null> {
  const record = await findDistributorZohoId(email);
  if (!record) return null;

  const clients: JourneyClient[] = [];
  let offset = 0;

  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select Name, Email, Investor_Stage, Stage_Entry_Date,
              Activation_Date, Date_Of_1st_Investment, First_Top_Up_Date
         from Investors
        where Primary_distributo = ${record.id}
        limit ${offset}, 200`,
    );
    if (!rows.length) break;
    clients.push(...rows.map(mapClient));
    if (rows.length < 200) break;
    offset += 200;
  }

  return {
    zohoId: record.id,
    zohoName: record.name,
    clients,
    stageCounts: tallyStages(clients),
  };
}

/**
 * Every distributor's journey, keyed by Zoho record ID. INTERNAL USE ONLY —
 * callers MUST have verified an admin session first. Never reachable from a
 * distributor-facing route.
 */
export async function getAllDistributorJourneys(): Promise<Map<string, DistributorJourney>> {
  if (journeyCache && journeyCache.expiresAt > Date.now()) return journeyCache.data;

  const names = new Map<string, string | null>();
  let nameOffset = 0;
  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select id, Name from Distributor where id is not null limit ${nameOffset}, 200`,
    );
    if (!rows.length) break;
    for (const r of rows) names.set(String(r.id), r.Name ?? null);
    if (rows.length < 200) break;
    nameOffset += 200;
  }

  const byDistributor = new Map<string, JourneyClient[]>();
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select Name, Email, Investor_Stage, Stage_Entry_Date, Activation_Date,
              Date_Of_1st_Investment, First_Top_Up_Date, Primary_distributo
         from Investors
        where Primary_distributo is not null
        limit ${offset}, 200`,
    );
    if (!rows.length) break;
    for (const r of rows) {
      const id = r.Primary_distributo?.id ? String(r.Primary_distributo.id) : null;
      if (!id) continue;
      if (!byDistributor.has(id)) byDistributor.set(id, []);
      byDistributor.get(id)!.push(mapClient(r));
    }
    if (rows.length < 200) break;
    offset += 200;
  }

  const out = new Map<string, DistributorJourney>();
  for (const [id, clients] of byDistributor) {
    out.set(id, {
      zohoId: id,
      zohoName: names.get(id) ?? null,
      clients,
      stageCounts: tallyStages(clients),
    });
  }

  journeyCache = { data: out, expiresAt: Date.now() + CACHE_TTL_MS };
  return out;
}

/** Clears the cache — for a manual refresh after editing Zoho. */
export function clearJourneyCache(): void {
  journeyCache = null;
}
```

- [ ] **Step 2: Verify against live Zoho**

Write `<scratchpad>/verify-journey.mjs`, run from the **repo root**. It reimplements the two lookups against the live API to confirm the queries and field names are correct:

```javascript
import fs from 'fs';
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const dc = e.ZOHO_CRM_DATA_CENTER || 'in';
const tr = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ refresh_token: e.ZOHO_CRM_REFRESH_TOKEN,
    client_id: e.ZOHO_CRM_CLIENT_ID, client_secret: e.ZOHO_CRM_CLIENT_SECRET,
    grant_type: 'refresh_token' }) });
const tok = (await tr.json()).access_token;
if (!tok) { console.log('TOKEN FAILED'); process.exit(1); }
const coql = async q => {
  const r = await fetch(`https://www.zohoapis.${dc}/crm/v3/coql`, { method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ select_query: q }) });
  if (r.status === 204) return [];
  const j = await r.json();
  if (j.code) { console.log('COQL ERROR:', j.code, j.message); return []; }
  return j.data || [];
};
const email = 'advisory@onebattalion.in';
const d = await coql(`select id, Name from Distributor where Email = '${email}' or Secondary_Email = '${email}' limit 0, 2`);
console.log('lookup by secondary email ->', JSON.stringify(d));
if (!d.length) { console.log('FAIL: secondary-email lookup returned nothing'); process.exit(1); }
const rows = await coql(`select Name, Email, Investor_Stage, Stage_Entry_Date, Activation_Date, Date_Of_1st_Investment, First_Top_Up_Date from Investors where Primary_distributo = ${d[0].id} limit 0, 200`);
console.log('scoped clients:', rows.length);
const tally = {};
for (const r of rows) tally[r.Investor_Stage ?? 'Unknown'] = (tally[r.Investor_Stage ?? 'Unknown'] || 0) + 1;
console.log('stages:', JSON.stringify(tally));
const stray = rows.filter(r => !r.Name);
console.log('rows missing Name (expect 0):', stray.length);
```

Run: `node <scratchpad>/verify-journey.mjs`

Expected: the lookup returns the "One Battalion Ventures" record via `Secondary_Email`; `scoped clients` is a non-zero count; `stages` shows values drawn from `STAGE_ORDER`; `rows missing Name` is 0. A `COQL ERROR` for `Primary_distributo` means the field name changed — stop and re-check the CRM before continuing.

- [ ] **Step 3: Confirm the fees module is untouched**

Run: `git status --short lib/zohoDistributorFees.ts lib/feeEngine.ts lib/zohoInvestorFees.ts`
Expected: **no output.** Any output means the hard constraint was violated — revert those files before committing.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors originating in `lib/zohoDistributorJourney.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/zohoDistributorJourney.ts
git commit -m "feat(distributor): add Zoho client-journey library

Self-contained so the fees module stays untouched. Looks up the Zoho
Distributor record by Email OR Secondary_Email (exact match only), then
scopes Investors by Primary_distributo for journey stages and dates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Distributor-scoped journey API

**Files:**
- Create: `app/api/distributor/journey/route.ts`

**Interfaces:**
- Consumes: `resolveDistributorByEmail`, `getDistributorClientCount` (Task 1); `getJourneyForDistributor` (Task 2)
- Produces: `GET /api/distributor/journey` returning
  `{ distributor: { name: string; email: string }, referralLinks: { individual: string; nonIndividual: string }, journey: { clients: JourneyClient[]; stageCounts: Record<string, number> } | null, zohoAvailable: boolean, portalClientCount: number }`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  resolveDistributorByEmail,
  getDistributorClientCount,
} from "@/lib/distributorIdentity";
import { getJourneyForDistributor } from "@/lib/zohoDistributorJourney";

const ONBOARDING_BASE = "https://onboarding.qodeinvest.com";

/**
 * Builds the partner referral links.
 *
 * The distributor is carried as a display name in the URL, prefixed "Mr " —
 * the convention the live links use, including for companies and LLPs. The
 * name comes from pms_clients_master.clientname because that is what matches
 * the live links; Zoho's Name field is truncated and would mis-attribute.
 */
function buildReferralLinks(clientname: string) {
  const param = encodeURIComponent(`Mr ${clientname}`);
  return {
    individual: `${ONBOARDING_BASE}/apply?distributor=${param}`,
    nonIndividual: `${ONBOARDING_BASE}/entity?distributor=${param}`,
  };
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("qode-user-context")?.value;
    if (!raw) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let email: string | undefined;
    try {
      email = JSON.parse(raw)?.email;
    } catch {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    // Authorization: only a distributor row may read this. An investor email
    // resolves to null and is refused — the portal has no role field, so this
    // lookup IS the role check.
    const distributor = await resolveDistributorByEmail(email);
    if (!distributor) {
      return NextResponse.json({ error: "Not a distributor" }, { status: 403 });
    }

    const portalClientCount = await getDistributorClientCount(distributor.clientname);

    // Zoho is enrichment: if it is unreachable the referral links and portal
    // counts still render. Never let a CRM outage blank the whole page.
    let journey = null;
    let zohoAvailable = true;
    try {
      journey = await getJourneyForDistributor(distributor.email);
    } catch (err) {
      console.error("[distributor/journey] Zoho lookup failed:", err);
      zohoAvailable = false;
    }

    return NextResponse.json({
      distributor: { name: distributor.clientname, email: distributor.email },
      referralLinks: buildReferralLinks(distributor.clientname),
      journey: journey
        ? { clients: journey.clients, stageCounts: journey.stageCounts }
        : null,
      zohoAvailable,
      portalClientCount,
    });
  } catch (error) {
    console.error("[distributor/journey] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the link format matches the real distributor list**

Write `<scratchpad>/verify-links.mjs`, run from the repo root:

```javascript
import fs from 'fs'; import pg from 'pg';
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const c = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE,
  password: e.PG_PASSWORD, port: Number(e.PG_PORT || 5432), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`SELECT clientname FROM pms_clients_master WHERE clientcode IS NULL ORDER BY clientname`);
for (const row of r.rows) {
  console.log(`https://onboarding.qodeinvest.com/apply?distributor=${encodeURIComponent('Mr ' + row.clientname)}`);
}
await c.end();
```

Run: `node <scratchpad>/verify-links.mjs`

Expected: the One Battalion line reads exactly
`.../apply?distributor=Mr%20One%20Battalion%20Ventures%20Private%20Limited`
matching the link supplied by the user. Compare two or three other rows against the user's list.

**If any differ, do not "fix" them by guessing** — record the mismatches and report them. Per the spec, the `Mr ` prefix is inferred and needs one live test; a mismatch is exactly the signal that the canonical link belongs on the Distributor record instead.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds; `/api/distributor/journey` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/api/distributor/journey/route.ts
git commit -m "feat(distributor): add session-scoped journey API

Resolves the distributor from the httpOnly session cookie and refuses
non-distributors — the DB lookup is the role check, since the portal has
no role field. Zoho failures degrade to zohoAvailable:false rather than
failing the request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Distributor portal page

**Files:**
- Create: `app/(protected)/distributors/page.tsx`

**Interfaces:**
- Consumes: `GET /api/distributor/journey` (Task 3), `STAGE_ORDER` (Task 2)
- Produces: the route `/distributors`

- [ ] **Step 1: Write the page**

A client component (`"use client"`) fetching the API in `useEffect`. Structure, in order:

1. **Header** — `<h1>` "Distributor Portal" (Playfair via globals) and the distributor name in `text-muted-foreground`.
2. **Referral links** — `<Card>` titled "Please use these links to refer to your investors", with a short line of context. Two rows (Individual / Non-Individual), each a `<code className="text-xs break-all">` plus a copy `<Button variant="outline" size="sm">` that calls `navigator.clipboard.writeText` and flips its label to "Copied" for 2s.
3. **Client journey** — `<Card>`. A stage row rendering `STAGE_ORDER` with counts from `stageCounts` (stat tiles: uppercase Lato label `text-xs tracking-wide text-muted-foreground`, Playfair number `text-2xl`). Drop stages render in the same row, with their count in `text-destructive` when non-zero. Below, a `<Table>` in an `overflow-x-auto` wrapper: Name, Stage, Stage Entry, Activation, Account Live, First Top-Up. Dates via the `formatDate` helper below.
4. **Payout status** — `<Card>` in its awaiting state: "Payout status will appear here once it is published from our operations system." No fabricated figures.
5. **Contact** — `<Card>`: "Questions about your clients or payouts?" with a `mailto:partnerships@qodeinvest.com` link.

Required helpers, inside the file:

```typescript
/** Renders an ISO date as "07 Jul 2026". Null-safe: returns an em dash. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
```

Required states — all three must be implemented, not stubbed:
- **Loading:** `<Skeleton>` blocks shaped like the cards above. Never a spinner.
- **403 (not a distributor):** a `<Card>` reading "This page is for Qode distribution partners. If you think you should have access, email partnerships@qodeinvest.com." Do not redirect.
- **`zohoAvailable === false`:** render the referral links and payout card normally, and in place of the journey table show "We couldn't load client journey data from our CRM just now. Your referral links above are unaffected — please try again shortly." Never show an empty table as if the distributor had no clients.
- **Zoho reachable but `clients` empty:** "No investors have been referred through your links yet. Share a link above to get started."

Styling constraints: cards `rounded-xl` via `<Card>`; numeric cells right-aligned with `tabular-nums`; the page must not scroll horizontally at 375px.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds; `/distributors` appears in the route list.

- [ ] **Step 3: Check it in the browser**

Run: `npm run dev` (port 2069). Log in as a distributor, open `http://localhost:2069/distributors`.

Verify: referral links render and copy; the stage tiles sum to the table row count; dates read "07 Jul 2026"; at 375px (devtools) nothing scrolls sideways. Then log in as a non-distributor investor and confirm the 403 card renders rather than a crash or an empty page.

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/distributors/page.tsx"
git commit -m "feat(distributor): add distributor portal page

Referral links, client journey funnel and table, payout placeholder, and
partnerships contact. Degrades to a stated message when Zoho is
unreachable rather than showing an empty table.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Internal overview API

**Files:**
- Create: `app/api/distributor/internal-overview/route.ts`

**Interfaces:**
- Consumes: `getSession` from `@/lib/session-store`; `getAllDistributorJourneys` (Task 2)
- Produces: `GET /api/distributor/internal-overview` returning
  `{ distributors: Array<{ zohoId: string; zohoName: string | null; portalName: string | null; email: string | null; clientCount: number; stageCounts: Record<string, number>; hasPortalLogin: boolean }>, totals: Record<string, number>, zohoOnlyCount: number }`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";
import { query } from "@/lib/db";
import { getAllDistributorJourneys, STAGE_ORDER } from "@/lib/zohoDistributorJourney";

/**
 * Internal overview — every distributor's book in one view.
 *
 * AUTHORIZATION IS ENFORCED HERE, NOT IN MIDDLEWARE.
 * middleware.ts only checks that an admin-session cookie EXISTS; it
 * explicitly defers validation. A forged cookie passes it. So this route
 * validates the session against Redis itself before returning anything.
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.cookies.get("admin-session")?.value;
    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const journeys = await getAllDistributorJourneys();

    // Portal rows, so the view can show which Zoho distributors cannot log in.
    const portalResult = await query(
      `SELECT clientname, lower(email) AS email
         FROM pms_clients_master
        WHERE clientcode IS NULL`,
    );
    const portalByEmail = new Map<string, string>();
    for (const row of portalResult.rows ?? []) {
      if (row.email) portalByEmail.set(String(row.email), String(row.clientname));
    }

    // Zoho addresses, so a journey can be matched back to a portal login.
    const distributors = [];
    const totals: Record<string, number> = {};
    for (const stage of STAGE_ORDER) totals[stage] = 0;
    let zohoOnlyCount = 0;

    for (const journey of journeys.values()) {
      // Coverage check only: does this CRM distributor have a portal login?
      // Matched on name because the journey carries no distributor email.
      // Loose by design and NEVER used for access control — see the note below.
      const match = [...portalByEmail.entries()].find(
        ([, name]) => name.toLowerCase() === String(journey.zohoName ?? "").toLowerCase(),
      );
      const portalName = match?.[1] ?? null;
      const portalEmail = match?.[0] ?? null;

      const hasPortalLogin = portalName !== null;
      if (!hasPortalLogin) zohoOnlyCount += 1;

      for (const [stage, n] of Object.entries(journey.stageCounts)) {
        totals[stage] = (totals[stage] ?? 0) + n;
      }

      distributors.push({
        zohoId: journey.zohoId,
        zohoName: journey.zohoName,
        portalName,
        email: portalEmail,
        clientCount: journey.clients.length,
        stageCounts: journey.stageCounts,
        hasPortalLogin,
      });
    }

    distributors.sort((a, b) => b.clientCount - a.clientCount);

    return NextResponse.json({ distributors, totals, zohoOnlyCount });
  } catch (error) {
    console.error("[distributor/internal-overview] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

Note for the implementer: the `portalName` match above is by name and is deliberately loose — it exists only to flag the Zoho-vs-portal coverage gap the spec records (16 portal rows vs ~19 in Zoho), never to grant access. **Do not** reuse this matching for any authorization decision.

- [ ] **Step 2: Verify the auth gate rejects an unauthenticated caller**

Run `npm run dev`, then:

```bash
curl -i http://localhost:2069/api/distributor/internal-overview
```

Expected: `HTTP/1.1 401`. Then repeat with a junk cookie:

```bash
curl -i -H "Cookie: admin-session=forged-nonsense" http://localhost:2069/api/distributor/internal-overview
```

Expected: **also 401** — proving Redis validation runs and a forged cookie does not pass. If this returns 200, the gate is broken; stop and fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add app/api/distributor/internal-overview/route.ts
git commit -m "feat(distributor): add admin-gated internal overview API

Validates admin-session against Redis rather than trusting middleware,
which only checks cookie existence. Surfaces the Zoho-vs-portal coverage
gap instead of hiding it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Internal overview page and middleware entry

**Files:**
- Create: `app/(protected)/distributors/internal/page.tsx`
- Modify: `middleware.ts` (matcher only)

**Interfaces:**
- Consumes: `GET /api/distributor/internal-overview` (Task 5)
- Produces: the route `/distributors/internal`

- [ ] **Step 1: Add the middleware matcher entry**

In `middleware.ts`, extend the exported config:

```typescript
export const config = {
  matcher: ['/admin/:path*', '/api/:path*', '/distributors/internal/:path*'],
};
```

Then extend the existing admin gate so it also covers the internal distributor route. Locate the line `if (request.nextUrl.pathname.startsWith('/admin')) {` and change the condition to:

```typescript
  if (
    request.nextUrl.pathname.startsWith('/admin') ||
    request.nextUrl.pathname.startsWith('/distributors/internal')
  ) {
```

This provides the login redirect only. It is **not** the security boundary — Task 5's Redis check is.

- [ ] **Step 2: Write the page**

A client component fetching the internal API. Structure:

1. **Header** — `<h1>` "Distributor Overview — Internal", with a muted line: "All distribution partners and the current stage of every referred investor."
2. **Totals row** — stat tiles per `STAGE_ORDER`, summed across partners.
3. **Coverage notice** — when `zohoOnlyCount > 0`, an `<Alert>`: "{n} distributors in the CRM have no portal login and cannot sign in to myQode." Stated plainly, never hidden.
4. **Per-distributor table** — `overflow-x-auto` wrapper; columns: Distributor, Clients, then one column per stage in `STAGE_ORDER`, with `tabular-nums` right alignment. Sorted by client count descending. A row with no portal login shows a muted "No portal login" badge next to the name.

States: `<Skeleton>` while loading; on 401 a card reading "This page is for the Qode team. Sign in to the admin panel to continue." with a link to `/admin/login`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds; `/distributors/internal` appears in the route list.

- [ ] **Step 4: Verify the boundary in a browser**

With `npm run dev`, log in as a **distributor** (not admin) and navigate to `http://localhost:2069/distributors/internal`.

Expected: redirected to `/admin/login`, and no distributor data is rendered at any point. This is the single most important check in the plan — a distributor must never see another partner's book. Then sign in to the admin panel and confirm the page renders fully.

- [ ] **Step 5: Confirm the fees module is still untouched**

Run: `git status --short lib/zohoDistributorFees.ts lib/feeEngine.ts lib/zohoInvestorFees.ts app/api/distributor/calculator/`
Expected: **no output.**

- [ ] **Step 6: Commit**

```bash
git add "app/(protected)/distributors/internal/page.tsx" middleware.ts
git commit -m "feat(distributor): add internal distributor overview

Admin-gated view of every partner's funnel, with the Zoho-vs-portal
coverage gap surfaced. Middleware entry provides the login redirect;
authorization itself is the Redis check in the API route.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `clientcode IS NULL` identity | 1 |
| Zoho join via Email OR Secondary_Email | 2 |
| Journey from `Investors.Investor_Stage` | 2 |
| Referral links from `clientname` | 3 (built), 4 (rendered) |
| Filter-before-fetch scoping | 2, 3 |
| Distributor surface: links, journey, payout, contact | 4 |
| Payout blank / awaiting | 4 |
| Referred-leads count (not a funnel) | 3 (`portalClientCount`), 4 |
| `admin-session` + server-side Redis validation | 5, 6 |
| Middleware matcher entry | 6 |
| Zoho-vs-portal coverage gap surfaced | 5, 6 |
| Fees module untouched | Global constraint; checked in Tasks 2 and 6 |
| myQode tokens only | Global constraint; Tasks 4 and 6 |

No spec requirement is unassigned. Tickets (#5) and the cobranded deck (#8) are deferred in the spec and correctly absent here.

**Placeholder scan:** No TBDs. Every code step carries real code; the two page tasks specify each card, state, and helper explicitly rather than saying "build the UI".

**Type consistency:** `JourneyClient`, `DistributorJourney`, `STAGE_ORDER`, `resolveDistributorByEmail`, `getJourneyForDistributor`, `getAllDistributorJourneys` are used with identical names and shapes in Tasks 3, 5, and 6 as defined in Tasks 1 and 2. `accountLiveDate` maps `Date_Of_1st_Investment` consistently in both mapping paths.

**Known carry-forward:** the `Mr ` referral prefix is inferred, not verified against the onboarding app. Task 3 Step 2 is the checkpoint; a mismatch there is a reportable finding, not something to paper over.
