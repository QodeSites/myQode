# Back Office — Client & Family Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a structured admin back office at `/admin/clients` and `/admin/families` with audited editing of client master data.

**Architecture:** A shared `app/admin/layout.tsx` provides the shell. All writes funnel through one module, `lib/adminClientMutations.ts`, which enforces a server-side field allowlist and writes `pms_clients_audit_log` in the SAME transaction as the update. Every API handler validates the admin session against Redis itself.

**Tech Stack:** Next.js 15.5 App Router, React 18.3, Tailwind v4 (CSS config, no `tailwind.config.ts`), shadcn/ui, `pg`.

**Spec:** `docs/superpowers/specs/2026-08-27-admin-backoffice-design.md`

## Global Constraints

- **Transactions must use `pool.connect()`, never `query()`.** `lib/db.ts:42` implements `query()` with `pool.query()`, which takes a different pooled connection per call — `BEGIN`/`COMMIT` issued through it would NOT be one transaction. Import the default export (`import pool from "@/lib/db"`), call `pool.connect()`, and always `client.release()` in a `finally`.
- **Never trust middleware for authorization.** It only checks that the `admin-session` cookie exists and explicitly defers validation (`middleware.ts`). Every handler calls `getSession()` from `@/lib/session-store` itself.
- **Editable fields, exhaustive:** `head_of_family`, `email`, `mobile`, `address1`, `address2`, `city`, `state`, `pincode`, `onboarding_status`. Everything else is read-only, enforced server-side.
- **Never writable:** `clientcode`, `clientid`, `pannumber`, `groupid` — these are text join keys; moving one orphans dependent rows.
- **Every mutation writes `pms_clients_audit_log`** in the same transaction, with `old_data`, `new_data`, `changed_fields`, and `notes` naming the admin from their SSO session. There are no DB triggers — nothing is logged automatically.
- **Design system:** existing semantic tokens only (`bg-card`, `text-primary`, `text-muted-foreground`, `border-border/20`), Lato + Playfair. No new colors, fonts, or gradients. Build from `components/ui/`.
- **Mobile:** works at 375px; wide tables scroll in their own `overflow-x-auto` container.
- **No test framework exists** (no jest/vitest, no `test` script). Verification is by Node probe scripts against the live DB plus `npx tsc --noEmit`. Probe scripts go in the session scratchpad and are never committed.
- **Do not modify `/admin/onboarding`** in this phase.
- **Do not touch the fees module** (`lib/zohoDistributorFees.ts`, `lib/feeEngine.ts`, `app/(protected)/distributor/fees-distribution/`).

> Never paste an absolute Windows path into a file under `docs/`. Tailwind v4 scans this directory, and a backslash followed by hex characters parses as a CSS unicode escape — this previously threw `RangeError: Invalid code point` and broke every page build.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/adminAuth.ts` | One session check reused by every admin handler |
| `lib/adminClientMutations.ts` | The only write path: allowlist + transaction + audit |
| `lib/adminClientQueries.ts` | Reads: search, detail, family, audit history |
| `app/api/admin/clients/route.ts` | GET paged search |
| `app/api/admin/clients/[id]/route.ts` | GET detail, PATCH audited edit |
| `app/api/admin/families/route.ts` | GET family groups |
| `app/api/admin/families/[groupid]/head/route.ts` | POST set head of family |
| `app/admin/layout.tsx` | Shell: sidebar, header, conventions |
| `app/admin/_components/admin-nav.tsx` | Client-side nav with active highlighting |
| `app/admin/clients/page.tsx` | Search and list |
| `app/admin/clients/[id]/page.tsx` | Detail, family, edit, history |
| `app/admin/families/page.tsx` | Family explorer, missing heads first |

---

### Task 1: Admin auth helper

**Files:**
- Create: `lib/adminAuth.ts`

**Interfaces:**
- Consumes: `getSession` from `@/lib/session-store`
- Produces:
  - `type AdminUser = { email: string; name: string }`
  - `requireAdmin(request: NextRequest): Promise<AdminUser | NextResponse>`
  - `isAdminUser(v: AdminUser | NextResponse): v is AdminUser`

- [ ] **Step 1: Write the module**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";

/**
 * The acting admin, from their Microsoft SSO session. Every audited write
 * records this, so a change is always attributable to a person.
 */
export type AdminUser = { email: string; name: string };

/**
 * Validates the admin session against Redis and returns the acting admin,
 * or a ready-to-return error response.
 *
 * AUTHORIZATION LIVES HERE, NOT IN MIDDLEWARE. middleware.ts only checks
 * that the admin-session cookie EXISTS — it explicitly defers validation, so
 * a forged cookie passes it. Every handler must call this.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<AdminUser | NextResponse> {
  const sessionId = request.cookies.get("admin-session")?.value;
  if (!sessionId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const session = await getSession(sessionId);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  return {
    email: String(session.user.email),
    name: String(session.user.name ?? session.user.email),
  };
}

/** Narrows the requireAdmin result. Use: `if (!isAdminUser(a)) return a;` */
export function isAdminUser(v: AdminUser | NextResponse): v is AdminUser {
  return !(v instanceof NextResponse);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep adminAuth`
Expected: no output. (Pre-existing errors elsewhere are out of scope — the portfolio performance page has a known `FullscreenLoader` export error. Do not fix unrelated errors.)

- [ ] **Step 3: Commit**

```bash
git add lib/adminAuth.ts
git commit -m "feat(admin): add admin session helper

Validates admin-session against Redis in-handler; middleware only checks
cookie existence and defers validation, so a forged cookie passes it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Read queries

**Files:**
- Create: `lib/adminClientQueries.ts`

**Interfaces:**
- Consumes: `query` from `@/lib/db`
- Produces:
  - `type ClientListRow = { id: number; clientid: string | null; clientname: string | null; clientcode: string | null; email: string | null; mobile: string | null; groupid: string | null; groupname: string | null; headOfFamily: boolean | null; onboardingStatus: string | null; lastLoginAt: string | null }`
  - `type ClientDetail = ClientListRow & { pannumber: string | null; address1: string | null; address2: string | null; city: string | null; state: string | null; pincode: string | null; schemename: string | null; intermediaryname: string | null; accountOpenDate: string | null }`
  - `type AuditEntry = { id: number; operationType: string; changedFields: string[] | null; operationTimestamp: string; notes: string | null; oldData: Record<string, unknown> | null; newData: Record<string, unknown> | null }`
  - `type FamilyGroup = { groupid: string; groupname: string | null; memberCount: number; headCount: number; members: ClientListRow[] }`
  - `searchClients(opts: { q?: string; status?: string; page?: number; pageSize?: number }): Promise<{ rows: ClientListRow[]; total: number }>`
  - `getClientDetail(id: number): Promise<ClientDetail | null>`
  - `getFamilyMembers(groupid: string): Promise<ClientListRow[]>`
  - `getClientAudit(clientid: string, limit?: number): Promise<AuditEntry[]>`
  - `getFamilyGroups(opts: { missingHeadOnly?: boolean }): Promise<FamilyGroup[]>`

- [ ] **Step 1: Write the module**

```typescript
// Read-side queries for the admin back office.
//
// Distributors are excluded from every client query: pms_clients_master holds
// both, and a distributor row is identified by clientcode IS NULL (verified:
// 17 of 555 rows). They are managed at /distributors/internal, not here.
import { query } from "@/lib/db";

export type ClientListRow = {
  id: number;
  clientid: string | null;
  clientname: string | null;
  clientcode: string | null;
  email: string | null;
  mobile: string | null;
  groupid: string | null;
  groupname: string | null;
  headOfFamily: boolean | null;
  onboardingStatus: string | null;
  lastLoginAt: string | null;
};

export type ClientDetail = ClientListRow & {
  pannumber: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  schemename: string | null;
  intermediaryname: string | null;
  accountOpenDate: string | null;
};

export type AuditEntry = {
  id: number;
  operationType: string;
  changedFields: string[] | null;
  operationTimestamp: string;
  notes: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
};

export type FamilyGroup = {
  groupid: string;
  groupname: string | null;
  memberCount: number;
  headCount: number;
  members: ClientListRow[];
};

const LIST_COLUMNS = `
  id, clientid, clientname, clientcode, email, mobile,
  groupid, groupname, head_of_family, onboarding_status, last_login_at`;

function mapListRow(r: any): ClientListRow {
  return {
    id: Number(r.id),
    clientid: r.clientid ?? null,
    clientname: r.clientname ?? null,
    clientcode: r.clientcode ?? null,
    email: r.email ?? null,
    mobile: r.mobile ?? null,
    groupid: r.groupid ?? null,
    groupname: r.groupname ?? null,
    headOfFamily: r.head_of_family ?? null,
    onboardingStatus: r.onboarding_status ?? null,
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  };
}

/** Paged client search. Distributor rows (clientcode IS NULL) are excluded. */
export async function searchClients(opts: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: ClientListRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const params: any[] = [];
  const where: string[] = ["clientcode IS NOT NULL"];

  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    const i = params.length;
    where.push(
      `(clientname ILIKE $${i} OR email ILIKE $${i} OR clientcode ILIKE $${i}
        OR mobile ILIKE $${i} OR groupname ILIKE $${i})`,
    );
  }

  if (opts.status?.trim()) {
    params.push(opts.status.trim());
    where.push(`onboarding_status = $${params.length}`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const countRes = await query(
    `SELECT count(*)::int AS n FROM pms_clients_master ${whereSql}`,
    params,
  );

  params.push(pageSize, (page - 1) * pageSize);
  const rowsRes = await query(
    `SELECT ${LIST_COLUMNS} FROM pms_clients_master ${whereSql}
      ORDER BY clientname NULLS LAST, clientcode
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    rows: (rowsRes.rows ?? []).map(mapListRow),
    total: Number(countRes.rows?.[0]?.n ?? 0),
  };
}

/** One client by primary key, or null. */
export async function getClientDetail(id: number): Promise<ClientDetail | null> {
  const res = await query(
    `SELECT ${LIST_COLUMNS}, pannumber, address1, address2, city, state,
            pincode, schemename, intermediaryname, account_open_date
       FROM pms_clients_master WHERE id = $1 LIMIT 1`,
    [id],
  );
  const r = res.rows?.[0];
  if (!r) return null;
  return {
    ...mapListRow(r),
    pannumber: r.pannumber ?? null,
    address1: r.address1 ?? null,
    address2: r.address2 ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    pincode: r.pincode ?? null,
    schemename: r.schemename ?? null,
    intermediaryname: r.intermediaryname ?? null,
    accountOpenDate: r.account_open_date ? String(r.account_open_date) : null,
  };
}

/** Every account in a family group, including the caller's own row. */
export async function getFamilyMembers(groupid: string): Promise<ClientListRow[]> {
  if (!groupid) return [];
  const res = await query(
    `SELECT ${LIST_COLUMNS} FROM pms_clients_master
      WHERE groupid = $1 ORDER BY clientcode`,
    [groupid],
  );
  return (res.rows ?? []).map(mapListRow);
}

/** Recent audit entries for one client, newest first. */
export async function getClientAudit(
  clientid: string,
  limit = 20,
): Promise<AuditEntry[]> {
  if (!clientid) return [];
  const res = await query(
    `SELECT id, operation_type, changed_fields, operation_timestamp,
            notes, old_data, new_data
       FROM pms_clients_audit_log
      WHERE clientid = $1
      ORDER BY operation_timestamp DESC
      LIMIT $2`,
    [clientid, Math.min(100, Math.max(1, limit))],
  );
  return (res.rows ?? []).map((r: any) => ({
    id: Number(r.id),
    operationType: String(r.operation_type),
    changedFields: r.changed_fields ?? null,
    operationTimestamp: String(r.operation_timestamp),
    notes: r.notes ?? null,
    oldData: r.old_data ?? null,
    newData: r.new_data ?? null,
  }));
}

/**
 * Family groups with their members.
 *
 * `missingHeadOnly` returns multi-account families where no member is head —
 * 181 of 196 such families as of 2026-08-27. That is the back office's
 * day-one job, so it gets a first-class query rather than client-side
 * filtering.
 */
export async function getFamilyGroups(opts: {
  missingHeadOnly?: boolean;
}): Promise<FamilyGroup[]> {
  const having = opts.missingHeadOnly
    ? `HAVING count(*) > 1 AND count(*) FILTER (WHERE head_of_family) = 0`
    : `HAVING count(*) > 1`;

  const groupsRes = await query(
    `SELECT groupid, max(groupname) AS groupname,
            count(*)::int AS member_count,
            count(*) FILTER (WHERE head_of_family)::int AS head_count
       FROM pms_clients_master
      WHERE groupid IS NOT NULL AND clientcode IS NOT NULL
      GROUP BY groupid ${having}
      ORDER BY count(*) DESC, max(groupname)`,
  );

  const groups = groupsRes.rows ?? [];
  if (!groups.length) return [];

  const ids = groups.map((g: any) => g.groupid);
  const membersRes = await query(
    `SELECT ${LIST_COLUMNS} FROM pms_clients_master
      WHERE groupid = ANY($1) ORDER BY clientcode`,
    [ids],
  );

  const byGroup = new Map<string, ClientListRow[]>();
  for (const r of membersRes.rows ?? []) {
    const key = String(r.groupid);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(mapListRow(r));
  }

  return groups.map((g: any) => ({
    groupid: String(g.groupid),
    groupname: g.groupname ?? null,
    memberCount: Number(g.member_count),
    headCount: Number(g.head_count),
    members: byGroup.get(String(g.groupid)) ?? [],
  }));
}
```

- [ ] **Step 2: Verify against the live database**

Write `<scratchpad>/verify-queries.mjs` and run it from the repo root. Note the explicit `pg` path — Node resolves bare imports relative to the SCRIPT, not the cwd, so a scratchpad script cannot see the project's `node_modules` otherwise.

```javascript
import fs from 'fs';
const { default: pg } = await import(
  'file:///' + process.cwd().replace(/\\/g, '/') + '/node_modules/pg/lib/index.js');
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const c = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE,
  password: e.PG_PASSWORD, port: Number(e.PG_PORT || 5432), ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  const r = await c.query(sql);
  console.log(label, JSON.stringify(r.rows[0]));
};
await q('clients (exclude distributors):',
  `SELECT count(*)::int n FROM pms_clients_master WHERE clientcode IS NOT NULL`);
await q('distributors excluded:',
  `SELECT count(*)::int n FROM pms_clients_master WHERE clientcode IS NULL`);
await q('multi-account families:',
  `SELECT count(*)::int n FROM (SELECT groupid FROM pms_clients_master
     WHERE groupid IS NOT NULL AND clientcode IS NOT NULL
     GROUP BY groupid HAVING count(*) > 1) t`);
await q('families missing a head:',
  `SELECT count(*)::int n FROM (SELECT groupid FROM pms_clients_master
     WHERE groupid IS NOT NULL AND clientcode IS NOT NULL
     GROUP BY groupid HAVING count(*) > 1
       AND count(*) FILTER (WHERE head_of_family) = 0) t`);
await q('families with >1 head (must be 0):',
  `SELECT count(*)::int n FROM (SELECT groupid FROM pms_clients_master
     WHERE groupid IS NOT NULL GROUP BY groupid
     HAVING count(*) FILTER (WHERE head_of_family) > 1) t`);
await c.end();
```

Run: `node <scratchpad>/verify-queries.mjs`

Expected: ~538 clients, 17 distributors excluded, ~196 multi-account families, ~181 missing a head, and **0** families with more than one head. If the last number is not 0, stop — the single-head invariant Task 3 relies on is already violated and must be reconciled before any write code ships.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep adminClientQueries`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/adminClientQueries.ts
git commit -m "feat(admin): add back-office read queries

Client search, detail, family members, audit history, and family groups.
Distributor rows (clientcode IS NULL) are excluded from client queries —
they are managed at /distributors/internal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The audited write path

**Files:**
- Create: `lib/adminClientMutations.ts`

**Interfaces:**
- Consumes: default export `pool` from `@/lib/db`; `AdminUser` from `@/lib/adminAuth`
- Produces:
  - `EDITABLE_FIELDS: readonly string[]`
  - `type EditableField = (typeof EDITABLE_FIELDS)[number]`
  - `updateClient(id: number, patch: Record<string, unknown>, admin: AdminUser): Promise<{ ok: true; changedFields: string[] } | { ok: false; error: string }>`
  - `setHeadOfFamily(groupid: string, clientId: number, admin: AdminUser): Promise<{ ok: true; cleared: number } | { ok: false; error: string }>`

- [ ] **Step 1: Write the module**

```typescript
// The ONLY write path for client master data.
//
// WHY EVERYTHING FUNNELS THROUGH HERE
// pms_clients_audit_log has the right shape and 6,386 rows, but there are NO
// TRIGGERS on pms_clients_master and no other application code writes to it —
// every existing row came from a January 2026 migration. Nothing is logged
// automatically. If a future caller updates the table directly, that change is
// invisible forever. So the audit insert lives in the same transaction as the
// update, and all mutations go through this module.
//
// WHY pool.connect() AND NOT query()
// lib/db.ts implements query() with pool.query(), which takes a DIFFERENT
// pooled connection per call. BEGIN/COMMIT issued through it would not be one
// transaction — the update could commit while the audit insert failed. A
// dedicated client is required.
import pool from "@/lib/db";
import type { AdminUser } from "@/lib/adminAuth";

/**
 * Fields an admin may change. Exhaustive and enforced server-side.
 *
 * Deliberately EXCLUDED: clientcode, clientid, pannumber, groupid. Those are
 * text join keys — pms_clients_master.intermediaryname matches a distributor's
 * clientname, and family membership is groupid equality. Renaming one silently
 * orphans dependent rows, as a previous distributor rename demonstrated.
 */
export const EDITABLE_FIELDS = [
  "head_of_family",
  "email",
  "mobile",
  "address1",
  "address2",
  "city",
  "state",
  "pincode",
  "onboarding_status",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

const EDITABLE_SET = new Set<string>(EDITABLE_FIELDS);

/** Columns captured in the audit snapshot, so a change is reconstructable. */
const SNAPSHOT_COLUMNS = `
  id, clientid, clientname, clientcode, email, mobile, address1, address2,
  city, state, pincode, groupid, groupname, head_of_family, onboarding_status`;

/** Normalises an incoming value: empty string becomes NULL, booleans coerced. */
function normalise(field: string, value: unknown): unknown {
  if (field === "head_of_family") {
    if (value === null || value === undefined) return null;
    return Boolean(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? null : t;
  }
  return value ?? null;
}

/**
 * Applies an allowlisted patch to one client and records it in the audit log,
 * atomically. Returns the fields that actually changed — a no-op patch is a
 * success with an empty list, not an error.
 */
export async function updateClient(
  id: number,
  patch: Record<string, unknown>,
  admin: AdminUser,
): Promise<{ ok: true; changedFields: string[] } | { ok: false; error: string }> {
  const rejected = Object.keys(patch).filter((k) => !EDITABLE_SET.has(k));
  if (rejected.length) {
    return { ok: false, error: `Not editable: ${rejected.join(", ")}` };
  }
  if (!Object.keys(patch).length) {
    return { ok: false, error: "No fields supplied" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const oldRow = before.rows?.[0];
    if (!oldRow) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Client not found" };
    }

    // Only fields whose value actually differs are written, so the audit log
    // records real changes rather than every save click.
    const changed: string[] = [];
    const sets: string[] = [];
    const params: any[] = [];
    for (const [field, raw] of Object.entries(patch)) {
      const value = normalise(field, raw);
      const current = oldRow[field] ?? null;
      if (String(current) === String(value ?? null)) continue;
      params.push(value);
      sets.push(`${field} = $${params.length}`);
      changed.push(field);
    }

    if (!changed.length) {
      await client.query("ROLLBACK");
      return { ok: true, changedFields: [] };
    }

    params.push(id);
    await client.query(
      `UPDATE pms_clients_master SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $${params.length}`,
      params,
    );

    const after = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master WHERE id = $1`,
      [id],
    );

    await client.query(
      `INSERT INTO pms_clients_audit_log
         (operation_type, clientid, clientname, old_data, new_data,
          changed_fields, operation_timestamp, notes)
       VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
      [
        oldRow.clientid,
        oldRow.clientname,
        JSON.stringify(oldRow),
        JSON.stringify(after.rows[0]),
        changed,
        `Edited in back office by ${admin.name} <${admin.email}>`,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, changedFields: changed };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[adminClientMutations] updateClient failed:", err);
    return { ok: false, error: "Update failed" };
  } finally {
    client.release();
  }
}

/**
 * Makes one client the head of their family, clearing any existing head in the
 * same group.
 *
 * This is a FAMILY-level invariant — exactly one head per groupid — so it is
 * its own operation rather than a generic field edit. Clearing and setting
 * happen in one transaction, and each affected client gets its own audit row.
 * Production currently has zero families with more than one head; this keeps
 * that true.
 */
export async function setHeadOfFamily(
  groupid: string,
  clientId: number,
  admin: AdminUser,
): Promise<{ ok: true; cleared: number } | { ok: false; error: string }> {
  if (!groupid) return { ok: false, error: "Missing group" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const target = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master
        WHERE id = $1 AND groupid = $2 FOR UPDATE`,
      [clientId, groupid],
    );
    if (!target.rows?.length) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Client is not in this family" };
    }

    // Existing heads, so each can be audited individually.
    const previous = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master
        WHERE groupid = $1 AND head_of_family IS TRUE AND id <> $2 FOR UPDATE`,
      [groupid, clientId],
    );

    if (previous.rows.length) {
      await client.query(
        `UPDATE pms_clients_master SET head_of_family = false, updated_at = now()
          WHERE groupid = $1 AND head_of_family IS TRUE AND id <> $2`,
        [groupid, clientId],
      );
      for (const row of previous.rows) {
        await client.query(
          `INSERT INTO pms_clients_audit_log
             (operation_type, clientid, clientname, old_data, new_data,
              changed_fields, operation_timestamp, notes)
           VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
          [
            row.clientid,
            row.clientname,
            JSON.stringify(row),
            JSON.stringify({ ...row, head_of_family: false }),
            ["head_of_family"],
            `Head of family reassigned by ${admin.name} <${admin.email}>`,
          ],
        );
      }
    }

    await client.query(
      `UPDATE pms_clients_master SET head_of_family = true, updated_at = now()
        WHERE id = $1`,
      [clientId],
    );

    const oldTarget = target.rows[0];
    await client.query(
      `INSERT INTO pms_clients_audit_log
         (operation_type, clientid, clientname, old_data, new_data,
          changed_fields, operation_timestamp, notes)
       VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
      [
        oldTarget.clientid,
        oldTarget.clientname,
        JSON.stringify(oldTarget),
        JSON.stringify({ ...oldTarget, head_of_family: true }),
        ["head_of_family"],
        `Set as head of family by ${admin.name} <${admin.email}>`,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, cleared: previous.rows.length };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[adminClientMutations] setHeadOfFamily failed:", err);
    return { ok: false, error: "Update failed" };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Verify the transaction and audit behaviour against the live DB**

This is the most important verification in the plan. Write `<scratchpad>/verify-mutations.mjs`, which performs a real update, checks the audit row, then restores the original value:

```javascript
import fs from 'fs';
const { default: pg } = await import(
  'file:///' + process.cwd().replace(/\\/g, '/') + '/node_modules/pg/lib/index.js');
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const c = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE,
  password: e.PG_PASSWORD, port: Number(e.PG_PORT || 5432), ssl: { rejectUnauthorized: false } });
await c.connect();

// Pick a real client and remember its current city so it can be restored.
const pick = await c.query(
  `SELECT id, clientid, clientname, city FROM pms_clients_master
    WHERE clientcode IS NOT NULL LIMIT 1`);
const row = pick.rows[0];
console.log('target:', row.clientname, '| city before:', JSON.stringify(row.city));

const auditBefore = await c.query(
  `SELECT count(*)::int n FROM pms_clients_audit_log WHERE clientid = $1`, [row.clientid]);

// Mimic updateClient: update + audit in ONE transaction.
await c.query('BEGIN');
await c.query(`UPDATE pms_clients_master SET city = $1, updated_at = now() WHERE id = $2`,
  ['__PROBE__', row.id]);
await c.query(
  `INSERT INTO pms_clients_audit_log
     (operation_type, clientid, clientname, old_data, new_data, changed_fields,
      operation_timestamp, notes)
   VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
  [row.clientid, row.clientname, JSON.stringify({ city: row.city }),
   JSON.stringify({ city: '__PROBE__' }), ['city'], 'probe: verify audit path']);
await c.query('COMMIT');

const auditAfter = await c.query(
  `SELECT count(*)::int n FROM pms_clients_audit_log WHERE clientid = $1`, [row.clientid]);
console.log('audit rows before/after:', auditBefore.rows[0].n, '->', auditAfter.rows[0].n);

const check = await c.query(`SELECT city FROM pms_clients_master WHERE id = $1`, [row.id]);
console.log('city now:', JSON.stringify(check.rows[0].city), '(expect "__PROBE__")');

// Restore and remove the probe audit row, leaving production untouched.
await c.query('BEGIN');
await c.query(`UPDATE pms_clients_master SET city = $1 WHERE id = $2`, [row.city, row.id]);
await c.query(`DELETE FROM pms_clients_audit_log WHERE notes = 'probe: verify audit path'`);
await c.query('COMMIT');

const restored = await c.query(`SELECT city FROM pms_clients_master WHERE id = $1`, [row.id]);
const finalAudit = await c.query(
  `SELECT count(*)::int n FROM pms_clients_audit_log WHERE clientid = $1`, [row.clientid]);
console.log('city restored to:', JSON.stringify(restored.rows[0].city));
console.log('audit rows back to:', finalAudit.rows[0].n);
const clean = String(restored.rows[0].city ?? '') === String(row.city ?? '')
  && finalAudit.rows[0].n === auditBefore.rows[0].n;
console.log(clean ? 'PASS - probe left no trace' : 'FAIL - production data not restored');
await c.end();
```

Run: `node <scratchpad>/verify-mutations.mjs`

Expected: the audit count goes up by one, the city changes to `__PROBE__`, then both are restored, ending with `PASS - probe left no trace`. If it does not print PASS, **stop and restore the row by hand before doing anything else** — this touches production client data.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep adminClientMutations`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/adminClientMutations.ts
git commit -m "feat(admin): add audited client mutation path

All writes funnel through here: server-side field allowlist, then the
UPDATE and the pms_clients_audit_log insert in ONE transaction on a
dedicated pool.connect() client — lib/db.ts query() uses pool.query(),
which takes a different connection per call, so BEGIN/COMMIT through it
would not be atomic.

There are no DB triggers and nothing else writes the audit log, so an
unlogged edit would be invisible forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Client API routes

**Files:**
- Create: `app/api/admin/clients/route.ts`
- Create: `app/api/admin/clients/[id]/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `isAdminUser` (Task 1); `searchClients`, `getClientDetail`, `getFamilyMembers`, `getClientAudit` (Task 2); `updateClient` (Task 3)
- Produces:
  - `GET /api/admin/clients?q=&status=&page=` → `{ rows: ClientListRow[]; total: number; page: number; pageSize: number }`
  - `GET /api/admin/clients/[id]` → `{ client: ClientDetail; family: ClientListRow[]; audit: AuditEntry[] }`
  - `PATCH /api/admin/clients/[id]` → `{ ok: true; changedFields: string[] }` or `{ error: string }`

- [ ] **Step 1: Write the list route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import { searchClients } from "@/lib/adminClientQueries";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? "50") || 50;

    const { rows, total } = await searchClients({
      q: searchParams.get("q") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      page,
      pageSize,
    });

    return NextResponse.json({ rows, total, page, pageSize });
  } catch (error) {
    console.error("[admin/clients] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the detail route**

Note: Next.js 15 types dynamic route params as a Promise — `await params`.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import {
  getClientDetail,
  getFamilyMembers,
  getClientAudit,
} from "@/lib/adminClientQueries";
import { updateClient } from "@/lib/adminClientMutations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const client = await getClientDetail(id);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [family, audit] = await Promise.all([
      client.groupid ? getFamilyMembers(client.groupid) : Promise.resolve([]),
      client.clientid ? getClientAudit(client.clientid) : Promise.resolve([]),
    ]);

    return NextResponse.json({ client, family, audit });
  } catch (error) {
    console.error("[admin/clients/:id] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const patch = (await request.json()) as Record<string, unknown>;
    const result = await updateClient(id, patch, admin);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, changedFields: result.changedFields });
  } catch (error) {
    console.error("[admin/clients/:id] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify the auth gate**

With the dev server running on port 2069:

```bash
curl -s -o /dev/null -w "no cookie: %{http_code}\n" http://localhost:2069/api/admin/clients
curl -s -o /dev/null -w "forged cookie: %{http_code}\n" -H "Cookie: admin-session=forged-nonsense" http://localhost:2069/api/admin/clients
```

Expected: **401 for both.** A forged cookie passing middleware but being rejected here is the whole point of Task 1. If either returns 200, stop.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/clients
git commit -m "feat(admin): add client list and detail APIs

GET search, GET detail with family and audit history, PATCH audited edit.
Every handler validates the admin session itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Family APIs

**Files:**
- Create: `app/api/admin/families/route.ts`
- Create: `app/api/admin/families/[groupid]/head/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `isAdminUser` (Task 1); `getFamilyGroups` (Task 2); `setHeadOfFamily` (Task 3)
- Produces:
  - `GET /api/admin/families?missingHeadOnly=1` → `{ groups: FamilyGroup[]; total: number; missingHead: number }`
  - `POST /api/admin/families/[groupid]/head` body `{ clientId: number }` → `{ ok: true; cleared: number }`

- [ ] **Step 1: Write the families list route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import { getFamilyGroups } from "@/lib/adminClientQueries";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const missingHeadOnly = searchParams.get("missingHeadOnly") === "1";

    // Both sets are needed: the full list to browse, and the missing-head
    // count as the headline number even when browsing everything.
    const all = await getFamilyGroups({ missingHeadOnly: false });
    const missingHead = all.filter((g) => g.headCount === 0).length;
    const groups = missingHeadOnly ? all.filter((g) => g.headCount === 0) : all;

    return NextResponse.json({ groups, total: all.length, missingHead });
  } catch (error) {
    console.error("[admin/families] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the set-head route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import { setHeadOfFamily } from "@/lib/adminClientMutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupid: string }> },
) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  try {
    const { groupid } = await params;
    const body = (await request.json()) as { clientId?: number };
    const clientId = Number(body?.clientId);

    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    const result = await setHeadOfFamily(groupid, clientId, admin);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, cleared: result.cleared });
  } catch (error) {
    console.error("[admin/families/:groupid/head] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify the auth gate**

```bash
curl -s -o /dev/null -w "families no cookie: %{http_code}\n" http://localhost:2069/api/admin/families
curl -s -o /dev/null -w "set head forged: %{http_code}\n" -X POST -H "Content-Type: application/json" -H "Cookie: admin-session=forged" -d "{\"clientId\":1}" http://localhost:2069/api/admin/families/14410026/head
```

Expected: **401 for both.**

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/families
git commit -m "feat(admin): add family list and set-head APIs

Setting head of family is its own endpoint because one head per group is
a family-level invariant — clearing the previous head and setting the new
one happen in a single transaction.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Admin shell

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/_components/admin-nav.tsx`

**Interfaces:**
- Produces: shared chrome for every `/admin` route

- [ ] **Step 1: Write the nav component**

`app/admin/_components/admin-nav.tsx` is a `"use client"` component, because it needs `usePathname()`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Users, UsersRound } from "lucide-react";

const LINKS = [
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/families", label: "Families", icon: UsersRound },
  { href: "/admin/onboarding", label: "Analytics (legacy)", icon: BarChart3 },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
      {LINKS.map(({ href, label, icon: Icon }) => {
        // startsWith, so /admin/clients/123 still highlights Clients.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors ${
              active
                ? "bg-card font-bold text-primary dark:text-primary-foreground"
                : "text-muted-foreground hover:bg-card/60"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write the layout**

`app/admin/layout.tsx` stays a server component so it can export `metadata` (a client component cannot):

```tsx
import type React from "react";
import { AdminNav } from "./_components/admin-nav";

export const metadata = {
  title: "myQode Back Office",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/20 bg-card px-4 py-3 sm:px-6">
        <p className="text-sm font-bold text-foreground">myQode Back Office</p>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:gap-6">
        <aside className="lg:w-56 lg:shrink-0">
          <AdminNav />
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the legacy page still renders**

```bash
curl -s -o /dev/null -w "legacy onboarding: %{http_code}\n" http://localhost:2069/admin/onboarding
```

Expected: `307` (redirect to admin login when signed out) — **not** 500. A 500 means the new layout broke the existing page.

- [ ] **Step 4: Commit**

```bash
git add app/admin/layout.tsx app/admin/_components/admin-nav.tsx
git commit -m "feat(admin): add back-office shell

Sidebar, header and shared conventions for /admin. The legacy onboarding
page stays reachable and unmodified.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Clients list page

**Files:**
- Create: `app/admin/clients/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/clients` (Task 4)

- [ ] **Step 1: Write the page**

A `"use client"` component. Mandatory behaviour:

- Debounced search box (300 ms) posting `q` to the API; searches name, email, clientcode, mobile, groupname.
- Status filter chips: All / pending / completed, mapped to the `status` param. Production currently holds 377 pending and 195 completed.
- Table columns: Name, Client code, Email, Family (groupname), Head (a "Head" badge when `headOfFamily` is true), Status, Last login. Wrapped in `overflow-x-auto`; date cells use `tabular-nums`.
- Each row links to `/admin/clients/{id}`.
- Pagination: Previous / Next with "Showing X–Y of Z". Page size 50.
- Loading: `<Skeleton>` blocks shaped like the table — never a spinner.
- Empty: "No clients match this search. Try a different name, email or client code."
- 401: "Your session has expired." with a link to `/admin/login?redirect=/admin/clients`.
- Dates render as "07 Jul 2026" via this local helper:

```typescript
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/clients"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/admin/clients/page.tsx
git commit -m "feat(admin): add client search and list page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Client detail page with editing

**Files:**
- Create: `app/admin/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/clients/[id]`, `PATCH /api/admin/clients/[id]` (Task 4); `POST /api/admin/families/[groupid]/head` (Task 5)

- [ ] **Step 1: Write the page**

A `"use client"` component. Mandatory sections:

1. **Header** — client name, client code, and a "Head of family" badge when applicable.
2. **Identity (read-only)** — client code, client ID, PAN, group ID, scheme, intermediary, account open date. Rendered in a panel captioned "These identifiers link this client to their family and distributor and cannot be edited here." This is not decoration: it tells the admin why the fields are locked.
3. **Editable details** — inputs for `email`, `mobile`, `address1`, `address2`, `city`, `state`, `pincode`, and a select for `onboarding_status` (pending / completed). One "Save changes" button, disabled until something differs from the loaded values. On save, PATCH only the changed fields. On success show "Saved — {n} field(s) updated" and refetch. When the response has `changedFields: []` show "No changes to save."
4. **Family** — every account in the group: name, client code, scheme, and a "Head" badge. Each non-head row gets a "Set as head" button calling `POST /api/admin/families/{groupid}/head` with `{ clientId }`, then refetches. When the client has no `groupid`, show "This client is not part of a family group."
5. **Recent changes** — the audit list: timestamp, changed fields, and `notes` (which names the admin who made the change). Empty state: "No recorded changes for this client."

Constraints: tokens only; inputs `min-h-[44px]`; errors inline and specific ("Couldn't save — that email address isn't valid"), never a bare code.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/clients"`
Expected: no output.

- [ ] **Step 3: Browser check**

Sign in at `/admin/login`, open a client from `/admin/clients`, change the city, save, and confirm the change appears under "Recent changes" attributed to your name. Then set a different family member as head and confirm the badge moves.

- [ ] **Step 4: Commit**

```bash
git add "app/admin/clients/[id]/page.tsx"
git commit -m "feat(admin): add client detail page with audited editing

Read-only identity panel explains why join keys are locked; edits PATCH
only changed fields and appear in the audit trail below.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Family explorer

**Files:**
- Create: `app/admin/families/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/families` (Task 5); `POST /api/admin/families/[groupid]/head` (Task 5)

- [ ] **Step 1: Write the page**

A `"use client"` component, attention-first:

1. **Headline** — two stat tiles: total multi-account families (~196) and families missing a head (~181). The second is `text-destructive` when above zero and doubles as a filter toggle.
2. **Filter** — "All families" / "Missing a head", defaulting to **missing a head**, because that is the work.
3. **Family cards** — one per group: group name, member count, and each member with name, client code, and either a "Head" badge or a "Set as head" button. Setting a head refetches and updates both tiles.
4. **Empty state when nothing is missing** — "Every family has a head assigned." Say the good news plainly rather than showing an empty table.
5. Loading uses skeletons; 401 links to `/admin/login?redirect=/admin/families`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/families"`
Expected: no output.

- [ ] **Step 3: Verify the count drops after assigning a head**

In the browser, note the "missing a head" figure, assign a head to one family, and confirm the figure decreases by exactly one. Then re-run `<scratchpad>/verify-queries.mjs` and confirm "families with >1 head" is still **0**.

- [ ] **Step 4: Commit**

```bash
git add app/admin/families/page.tsx
git commit -m "feat(admin): add family explorer

Leads with the 181 multi-account families that have no head of family,
which is the back office's day-one job.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Admin shell / navigation / conventions | 6 |
| `/admin/clients` search and list | 2, 4, 7 |
| `/admin/clients/[id]` detail + family + history | 2, 4, 8 |
| `/admin/families` explorer, missing heads first | 2, 5, 9 |
| Server-side field allowlist | 3 |
| Audit write in the same transaction | 3 |
| Single head per family invariant | 3, 5 |
| `getSession()` in every handler | 1, 4, 5 |
| Admin attribution from SSO | 1, 3 |
| Join keys never writable | 3 (enforced), 8 (explained in UI) |
| `/admin/onboarding` untouched | 6 (kept reachable, verified) |
| Design system tokens only | 6, 7, 8, 9 |

No spec requirement is unassigned. Analytics is correctly absent — it is the second spec.

**Placeholder scan:** No TBDs. Library and API tasks carry complete code; the three page tasks enumerate every section, state, and copy string rather than saying "build the UI".

**Type consistency:** `ClientListRow`, `ClientDetail`, `AuditEntry`, `FamilyGroup`, `AdminUser`, `EDITABLE_FIELDS`, `updateClient`, `setHeadOfFamily`, `requireAdmin`, `isAdminUser` are used with identical names and shapes across Tasks 4, 5, 7, 8 and 9 as defined in Tasks 1–3. `headOfFamily` (camelCase, API/UI) maps `head_of_family` (snake_case, DB) consistently in `mapListRow` and nowhere else.

**Carry-forward risks:**
1. Task 3's probe writes to production client data and restores it. If it does not print PASS, restore by hand before continuing.
2. `pms_clients_master.password` exists and this plan never touches it. Worth a separate review of investor credential storage.
