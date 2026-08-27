# Role-Based Back Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each staff member a back office scoped to their job — super admins land on consolidated analytics, Krutika sees distributors, finance sees invoices, everyone else sees investors.

**Architecture:** One module, `lib/adminRoles.ts`, maps a session email to a role and a role to the sections it may reach. `requireRole()` enforces it server-side in every admin API; the sidebar and the `/admin` redirect follow the same map so nobody is shown a door that will refuse them.

**Tech Stack:** Next.js 15.5 App Router, React 18.3, Tailwind v4 (CSS config), shadcn/ui, `pg`.

**Spec:** `docs/superpowers/specs/2026-08-27-back-office-roles-design.md`

## Global Constraints

- **The role comes from the httpOnly session email only.** Never from a header, request body, query parameter, or anything else the client controls.
- **`requireRole()` is the security boundary.** The sidebar and redirects are UX. Every admin API route must call it — hiding a link is not access control.
- **Unmapped authorised staff get `default`**, the least-privileged role. Never fall back to `super`.
- **Use `rishabh.nahar@qodeinvest.com`** — the address on the allowlist. The request spelled it `rishabnh.nahar@`, a transposition that would lock him out.
- **`karan.salecha@`, `kruti.dave@` and `accounts@` are NOT on `ADMIN_AUTHORIZED_EMAILS` yet.** Their roles are defined and dormant until an operator adds them. Do not edit `.env`.
- **Do not touch the fees module** — `lib/zohoDistributorFees.ts`, `lib/feeEngine.ts`, `app/(protected)/distributor/fees-distribution/`.
- **Do not modify the distributor-facing invoice pages** under `app/(protected)/`. The new admin view reads the same table independently.
- **Design system:** existing semantic tokens only (`bg-card`, `text-primary`, `text-muted-foreground`, `border-border/20`). Figures in **Lato** (`font-sans`); Playfair (`font-serif`) only for the myQode wordmark. Strategy colours `#008455` / `#0A3452` / `#550E0E` and neutral `#9CA3AF` for charts.
- **Mobile:** works at 375px; wide tables scroll in their own `overflow-x-auto` container.
- **No test framework exists.** Verification is Node probe scripts against the live DB, `npx tsc --noEmit`, and `curl` against the running dev server on port 2069. Probes go in the session scratchpad and are never committed.
- **Pre-existing, out of scope:** a `nodemailer` type error in `app/api/auth/admin/send-bulk-setup-emails/route.ts`. Do not fix unrelated errors.

> Never paste an absolute Windows path into a file under `docs/`. Tailwind v4 scans this directory, and a backslash followed by hex characters parses as a CSS unicode escape — this previously threw `RangeError: Invalid code point` and broke every page build.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/adminRoles.ts` | The role map and every access decision |
| `lib/adminAuth.ts` | Gains `requireRole()` alongside `requireAdmin()` |
| `app/api/admin/me/route.ts` | Returns the caller's role, for the nav |
| `app/api/admin/invoices/route.ts` | Read-only invoice list |
| `app/admin/page.tsx` | Redirects to the role's landing page |
| `app/admin/invoices/page.tsx` | Finance's invoice view |
| `app/admin/analytics/page.tsx` | Super admin consolidated dashboard |
| `app/admin/_components/admin-nav.tsx` | Renders only reachable sections |

---

### Task 1: The role map

**Files:**
- Create: `lib/adminRoles.ts`

**Interfaces:**
- Produces:
  - `type Role = "super" | "distributor" | "invoices" | "default"`
  - `type Section = "console" | "analytics" | "clients" | "families" | "distributor" | "invoices" | "queries"`
  - `resolveRole(email: string | null | undefined): Role`
  - `canAccess(role: Role, section: Section): boolean`
  - `landingFor(role: Role): string`
  - `sectionsFor(role: Role): Section[]`

- [ ] **Step 1: Write the module**

```typescript
// Who sees what in the back office.
//
// Roles are keyed on the email address because that is what the Microsoft SSO
// session already carries (app/api/auth/microsoft/callback writes user.email)
// and what ADMIN_AUTHORIZED_EMAILS already gates on. No schema change, no new
// auth concept.
//
// NOTE: karan.salecha@, kruti.dave@ and accounts@ are NOT on
// ADMIN_AUTHORIZED_EMAILS as of 2026-08-27, so they are rejected at login
// before any of this runs. Their entries here are deliberate and dormant:
// the moment an operator adds them to the environment, they get the right
// view with no code change.

export type Role = "super" | "distributor" | "invoices" | "default";

export type Section =
  | "console"
  | "analytics"
  | "clients"
  | "families"
  | "distributor"
  | "invoices"
  | "queries";

/**
 * Explicit role assignments. Anyone authorised but unlisted falls through to
 * "default" — the least-privileged role. Never default to "super": a new
 * staff member should have to be granted reach, not accidentally inherit it.
 *
 * rishabh.nahar@ is spelled as it appears on the allowlist. A transposed
 * "rishabnh" would silently drop him to the default role.
 */
const ROLE_MAP: Record<string, Role> = {
  "gaurav.didwania@qodeinvest.com": "super",
  "karan.salecha@qodeinvest.com": "super",
  "rishabh.nahar@qodeinvest.com": "super",
  "krutika.urankar@qodeinvest.com": "distributor",
  "kruti.dave@qodeinvest.com": "invoices",
  "accounts@qodeinvest.com": "invoices",
};

/** Which sections each role may reach. The API enforces this; the UI mirrors it. */
const ACCESS: Record<Role, Section[]> = {
  // Business decisions need the whole picture.
  super: [
    "console",
    "analytics",
    "clients",
    "families",
    "distributor",
    "invoices",
    "queries",
  ],
  // Distributors and their clients — the distributor view already scopes to
  // the partner's own book, so the general Clients page is not needed here.
  distributor: ["distributor"],
  // Finance reviews invoices. Investor records are not part of that job.
  invoices: ["invoices"],
  // Everyone else works with individual investors.
  default: ["clients", "families", "queries"],
};

/** Where each role starts. */
const LANDING: Record<Role, string> = {
  super: "/admin/analytics",
  distributor: "/distributors/internal",
  invoices: "/admin/invoices",
  default: "/admin/clients",
};

/** The role for a session email. Unknown or missing resolves to "default". */
export function resolveRole(email: string | null | undefined): Role {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return "default";
  return ROLE_MAP[key] ?? "default";
}

/** Whether a role may reach a section. */
export function canAccess(role: Role, section: Section): boolean {
  return ACCESS[role].includes(section);
}

/** Every section a role may reach, in navigation order. */
export function sectionsFor(role: Role): Section[] {
  return ACCESS[role];
}

/** The route a role should land on after signing in. */
export function landingFor(role: Role): string {
  return LANDING[role];
}
```

- [ ] **Step 2: Verify the map behaves**

Write `<scratchpad>/verify-roles.mjs`. It reimplements the same tables so the
logic can be checked without a TypeScript build:

```javascript
const ROLE_MAP = {
  "gaurav.didwania@qodeinvest.com": "super",
  "karan.salecha@qodeinvest.com": "super",
  "rishabh.nahar@qodeinvest.com": "super",
  "krutika.urankar@qodeinvest.com": "distributor",
  "kruti.dave@qodeinvest.com": "invoices",
  "accounts@qodeinvest.com": "invoices",
};
const ACCESS = {
  super: ["console","analytics","clients","families","distributor","invoices","queries"],
  distributor: ["distributor"],
  invoices: ["invoices"],
  default: ["clients","families","queries"],
};
const resolveRole = e => ROLE_MAP[String(e ?? "").trim().toLowerCase()] ?? "default";
const canAccess = (r, s) => ACCESS[r].includes(s);

const cases = [
  ["gaurav.didwania@qodeinvest.com", "super"],
  ["GAURAV.DIDWANIA@QODEINVEST.COM", "super"],   // case-insensitive
  ["  karan.salecha@qodeinvest.com ", "super"],  // trimmed
  ["rishabh.nahar@qodeinvest.com", "super"],
  ["rishabnh.nahar@qodeinvest.com", "default"],  // the typo must NOT be super
  ["krutika.urankar@qodeinvest.com", "distributor"],
  ["kruti.dave@qodeinvest.com", "invoices"],
  ["accounts@qodeinvest.com", "invoices"],
  ["sanket.shinde@qodeinvest.com", "default"],
  ["", "default"],
  [null, "default"],
];
let pass = 0, fail = 0;
for (const [email, want] of cases) {
  const got = resolveRole(email);
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(email)} -> ${got} (want ${want})`);
}

// The boundaries that matter most.
const denies = [
  ["distributor", "clients"], ["distributor", "analytics"], ["distributor", "console"],
  ["invoices", "clients"],    ["invoices", "analytics"],    ["invoices", "families"],
  ["default", "analytics"],   ["default", "console"],       ["default", "distributor"],
  ["default", "invoices"],
];
for (const [role, section] of denies) {
  const denied = !canAccess(role, section);
  denied ? pass++ : fail++;
  console.log(`${denied ? "PASS" : "FAIL"}  ${role} must NOT reach ${section}`);
}
const superOk = ACCESS.super.length === 7;
superOk ? pass++ : fail++;
console.log(`${superOk ? "PASS" : "FAIL"}  super reaches every section`);
console.log(`\n${pass} passed, ${fail} failed`);
```

Run: `node <scratchpad>/verify-roles.mjs`

Expected: **22 passed, 0 failed.** The `rishabnh` case is the important one —
if the typo resolves to `super`, the map has the wrong key and Rishabh would
be locked out while a non-existent address gains full access.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep adminRoles`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/adminRoles.ts
git commit -m "feat(admin): add back-office role map

Roles resolve from the SSO session email. Unmapped authorised staff fall
through to the least-privileged default role, never super.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Enforce roles in the API

**Files:**
- Modify: `lib/adminAuth.ts`
- Create: `app/api/admin/me/route.ts`

**Interfaces:**
- Consumes: `resolveRole`, `canAccess`, `landingFor`, `Role`, `Section` (Task 1); `requireAdmin`, `isAdminUser`, `AdminUser` (existing)
- Produces:
  - `type AdminUserWithRole = AdminUser & { role: Role }`
  - `requireRole(request: NextRequest, section: Section): Promise<AdminUserWithRole | NextResponse>`
  - `isRoleUser(v: AdminUserWithRole | NextResponse): v is AdminUserWithRole`
  - `GET /api/admin/me` → `{ email, name, role, sections, landing }`

- [ ] **Step 1: Extend the auth helper**

Append to `lib/adminAuth.ts`:

```typescript
import { resolveRole, canAccess, type Role, type Section } from "@/lib/adminRoles";

export type AdminUserWithRole = AdminUser & { role: Role };

/**
 * Validates the admin session AND checks the caller's role may reach this
 * section. Returns the acting admin with their role, or a ready-to-return
 * error response.
 *
 * THIS IS THE SECURITY BOUNDARY. The sidebar hides sections a role cannot
 * reach and /admin redirects to their landing page, but both are UX — a
 * distributor-role user who types /api/admin/console must be refused here,
 * not merely be unable to find the link.
 */
export async function requireRole(
  request: NextRequest,
  section: Section,
): Promise<AdminUserWithRole | NextResponse> {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  const role = resolveRole(admin.email);
  if (!canAccess(role, section)) {
    return NextResponse.json(
      { error: "Not available for your role" },
      { status: 403 },
    );
  }

  return { ...admin, role };
}

/** Narrows the requireRole result. Use: `if (!isRoleUser(a)) return a;` */
export function isRoleUser(
  v: AdminUserWithRole | NextResponse,
): v is AdminUserWithRole {
  return !(v instanceof NextResponse);
}
```

- [ ] **Step 2: Write the identity route**

`app/api/admin/me/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import { resolveRole, sectionsFor, landingFor } from "@/lib/adminRoles";

/**
 * The signed-in admin and what they may reach. The nav calls this to decide
 * which links to render.
 *
 * Uses requireAdmin rather than requireRole: every authenticated admin may
 * ask who they are, whatever their role.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  const role = resolveRole(admin.email);

  return NextResponse.json({
    email: admin.email,
    name: admin.name,
    role,
    sections: sectionsFor(role),
    landing: landingFor(role),
  });
}
```

- [ ] **Step 3: Apply `requireRole` to the section APIs**

Change the guard in each of these routes from `requireAdmin` to `requireRole`
with the section named below. The pattern in every file is identical — replace

```typescript
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;
```

with, for example,

```typescript
  const admin = await requireRole(request, "clients");
  if (!isRoleUser(admin)) return admin;
```

and update the import to
`import { requireRole, isRoleUser } from "@/lib/adminAuth";`.

| Route | Section |
|---|---|
| `app/api/admin/console/route.ts` | `console` |
| `app/api/admin/clients/route.ts` | `clients` |
| `app/api/admin/clients/[id]/route.ts` (both GET and PATCH) | `clients` |
| `app/api/admin/families/route.ts` | `families` |
| `app/api/admin/families/[groupid]/head/route.ts` | `families` |
| `app/api/admin/queries/route.ts` (both GET and POST) | `queries` |
| `app/api/distributor/internal-overview/route.ts` | `distributor` |
| `app/api/admin/retention-trend/route.ts` | `analytics` |
| `app/api/admin/login-analytics/route.ts` | `analytics` |
| `app/api/admin/client-platform-activity/route.ts` | `analytics` |
| `app/api/admin/investor-insights/route.ts` | `analytics` |
| `app/api/admin/onboarded-clients/route.ts` | `analytics` |
| `app/api/admin/onboarding-funnel/route.ts` | `analytics` |
| `app/api/admin/mobile-analytics/route.ts` | `analytics` |

Leave every other admin route on `requireAdmin` — they stay reachable by any
authenticated admin, which is the current behaviour and not part of this change.

Note `app/api/distributor/internal-overview/route.ts` uses `getSession`
directly rather than `requireAdmin`; replace that whole block with the
`requireRole(request, "distributor")` pattern above.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "adminAuth|api/admin|internal-overview"`
Expected: no output.

- [ ] **Step 5: Verify the gate rejects**

With the dev server running:

```bash
curl -s -o /dev/null -w "me, no cookie: %{http_code}\n" http://localhost:2069/api/admin/me
curl -s -o /dev/null -w "console, forged: %{http_code}\n" -H "Cookie: admin-session=forged" http://localhost:2069/api/admin/console
```

Expected: **401 for both.** A role check cannot run without a valid session,
so an unauthenticated caller must still be refused by `requireAdmin` first.

- [ ] **Step 6: Commit**

```bash
git add lib/adminAuth.ts app/api/admin/me app/api/admin app/api/distributor/internal-overview
git commit -m "feat(admin): enforce roles server-side on section APIs

requireRole validates the session then checks the caller's role may reach
the section, returning 403 otherwise. This is the boundary — the sidebar
and redirects are UX only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Role-aware navigation and landing

**Files:**
- Modify: `app/admin/_components/admin-nav.tsx`
- Create: `app/admin/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/me` (Task 2), `GET /api/admin/console` (existing)
- Produces: the route `/admin`, which redirects by role

- [ ] **Step 1: Make the nav role-aware**

Rewrite `app/admin/_components/admin-nav.tsx` so each link declares the
section it belongs to, and the component renders only the sections returned by
`/api/admin/me`. Keep the existing grouped structure (Today / People /
Insight) and the live counts.

Requirements, all mandatory:

- Fetch `/api/admin/me` once; hold `sections: string[]` in state.
- Each nav item carries a `section` field; filter items with
  `sections.includes(item.section)`.
- A group whose items are all filtered out renders nothing — no empty heading.
- Keep the Families count badge red when above zero, from `/api/admin/console`.
  **Only fetch the console counts when `sections` includes `"console"`** —
  a distributor-role user calling it now gets a 403, and firing a request you
  expect to fail is noise in the log.
- While `sections` is null, render no links rather than all of them. Showing
  everything for a moment then removing it looks like a permissions glitch.

The section for each item:

| Label | href | section |
|---|---|---|
| Console | `/admin/console` | `console` |
| Analytics | `/admin/analytics` | `analytics` |
| Clients | `/admin/clients` | `clients` |
| Families | `/admin/families` | `families` |
| Distributors | `/distributors/internal` | `distributor` |
| Invoices | `/admin/invoices` | `invoices` |
| Queries | `/admin/queries` | `queries` |

- [ ] **Step 2: Write the landing redirect**

`app/admin/page.tsx` — a client component, because the role is only known
after the fetch:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * /admin sends each person to the surface their job starts from.
 *
 * Client-side because the role comes from an authenticated fetch. This is
 * convenience, not access control — every destination enforces its own role
 * check server-side, so a user who guesses another role's URL is refused
 * there regardless of what this redirect does.
 */
export default function AdminIndexPage() {
  const router = useRouter();

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { cache: "no-store" });
        if (!res.ok) {
          router.replace("/admin/login?redirect=/admin");
          return;
        }
        const me = await res.json();
        router.replace(me?.landing ?? "/admin/clients");
      } catch {
        router.replace("/admin/login?redirect=/admin");
      }
    })();
  }, [router]);

  return (
    <div className="px-1 py-8">
      <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "admin-nav|admin/page"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/admin/_components/admin-nav.tsx app/admin/page.tsx
git commit -m "feat(admin): role-aware sidebar and landing redirect

The nav renders only sections the signed-in role may reach, and /admin
sends each person to their starting surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Invoice API

**Files:**
- Create: `app/api/admin/invoices/route.ts`

**Interfaces:**
- Consumes: `requireRole`, `isRoleUser` (Task 2); `query` from `@/lib/db`
- Produces: `GET /api/admin/invoices?distributor=&from=&to=` →
  `{ invoices: InvoiceRow[]; totals: { count: number; beforeTax: number; tax: number; total: number }; distributors: string[] }`
  where `InvoiceRow = { id: number; distributorEmail: string; invoiceNumber: string; invoiceDate: string | null; periodLabel: string | null; periodStart: string | null; periodEnd: string | null; amountBeforeTax: number; taxAmount: number; totalAmount: number; createdAt: string | null }`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import { query } from "@/lib/db";

/**
 * Issued distributor invoices, read-only.
 *
 * Finance reviews invoices here; the distributor flow issues them. This route
 * deliberately has no POST, PATCH or DELETE — the issuing path lives in
 * app/api/distributor/invoice-issue and is not part of this surface.
 *
 * The table is distributor_invoice_issued, the same one the distributor flow
 * writes. It held 0 rows as of 2026-08-27, so an empty response is the normal
 * early state, not a fault.
 */
export async function GET(request: NextRequest) {
  const admin = await requireRole(request, "invoices");
  if (!isRoleUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const distributor = searchParams.get("distributor")?.trim();
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();

    const where: string[] = [];
    const params: any[] = [];

    if (distributor) {
      params.push(distributor.toLowerCase());
      where.push(`lower(distributor_email) = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`invoice_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`invoice_date <= $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rowsRes = await query(
      `SELECT id, distributor_email, invoice_number, invoice_date,
              period_label, period_start, period_end,
              amount_before_tax, tax_amount, total_amount, created_at
         FROM distributor_invoice_issued
         ${whereSql}
        ORDER BY invoice_date DESC NULLS LAST, id DESC
        LIMIT 500`,
      params,
    );

    // The full distributor list, unfiltered, so the filter dropdown does not
    // shrink to only what the current filter already matched.
    const distinctRes = await query(
      `SELECT DISTINCT lower(distributor_email) AS email
         FROM distributor_invoice_issued
        WHERE distributor_email IS NOT NULL
        ORDER BY email`,
    );

    const invoices = (rowsRes.rows ?? []).map((r: any) => ({
      id: Number(r.id),
      distributorEmail: String(r.distributor_email ?? ""),
      invoiceNumber: String(r.invoice_number ?? ""),
      invoiceDate: r.invoice_date ? String(r.invoice_date) : null,
      periodLabel: r.period_label ?? null,
      periodStart: r.period_start ? String(r.period_start) : null,
      periodEnd: r.period_end ? String(r.period_end) : null,
      amountBeforeTax: Number(r.amount_before_tax ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
      totalAmount: Number(r.total_amount ?? 0),
      createdAt: r.created_at ? String(r.created_at) : null,
    }));

    const totals = invoices.reduce(
      (acc, i) => ({
        count: acc.count + 1,
        beforeTax: acc.beforeTax + i.amountBeforeTax,
        tax: acc.tax + i.taxAmount,
        total: acc.total + i.totalAmount,
      }),
      { count: 0, beforeTax: 0, tax: 0, total: 0 },
    );

    return NextResponse.json({
      invoices,
      totals,
      distributors: (distinctRes.rows ?? []).map((r: any) => String(r.email)),
    });
  } catch (error) {
    console.error("[admin/invoices] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the table and query**

Write `<scratchpad>/verify-invoices.mjs`:

```javascript
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const { default: pg } = await import(
  pathToFileURL(path.join(process.cwd(), 'node_modules', 'pg', 'lib', 'index.js')).href);
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const c = new pg.Client({ user: e.PG_USER, host: e.PG_HOST, database: e.PG_DATABASE,
  password: e.PG_PASSWORD, port: Number(e.PG_PORT || 5432), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(
  `SELECT id, distributor_email, invoice_number, invoice_date, period_label,
          amount_before_tax, tax_amount, total_amount
     FROM distributor_invoice_issued
    ORDER BY invoice_date DESC NULLS LAST, id DESC LIMIT 500`);
console.log('rows returned:', r.rowCount);
console.log(r.rowCount === 0
  ? 'EMPTY — expected as of 2026-08-27; the page must show its empty state, not an error'
  : JSON.stringify(r.rows[0], null, 1));
await c.end();
```

Run: `node <scratchpad>/verify-invoices.mjs`

Expected: the query runs without error. `rows returned: 0` is a pass — it
confirms the columns exist and the ordering is valid. A column-does-not-exist
error means the schema drifted; stop and re-check before building the page.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "api/admin/invoices"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/invoices
git commit -m "feat(admin): add read-only invoice API for finance

Gated to the invoices role. No write verbs — the distributor flow issues
invoices, finance reviews them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Invoice page

**Files:**
- Create: `app/admin/invoices/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/invoices` (Task 4)

- [ ] **Step 1: Write the page**

A `"use client"` component in the console's visual language. Mandatory:

1. **Header** — `<h1>Invoices</h1>` and "Issued distributor invoices. Review only — invoices are raised from the distributor portal."
2. **Summary tiles** — four: Invoices, Before tax, Tax, Total. Figures in
   `font-sans font-bold tabular-nums`, never `font-serif`. Currency via
   `toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`
   with a `₹` prefix.
3. **Filters** — a distributor `<select>` populated from `distributors`, and
   two date inputs (from / to) bound to `invoice_date`. Changing any refetches.
4. **Table** in `overflow-x-auto`: Invoice number, Distributor, Period,
   Invoice date, Before tax, Tax, Total. Amount columns right-aligned with
   `tabular-nums`. Dates as "07 Jul 2026".
5. **States:**
   - loading — `<Skeleton>` shaped like the tiles and table
   - 403 — "This page is for the finance team. If you need access, contact your administrator." Do **not** say "invoices" here; a user without the role should not learn what they are missing.
   - 401 — link to `/admin/login?redirect=/admin/invoices`
   - empty, no filters — "No invoices have been issued yet. They'll appear here once the first one is raised from the distributor portal."
   - empty, with filters — "No invoices match these filters. Try a wider date range."

The two empty states must be distinguishable — "nothing exists yet" and "your
filter excluded everything" are different problems with different fixes.

Helper for dates:

```typescript
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
```

Helper for money:

```typescript
function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/invoices"`
Expected: no output.

- [ ] **Step 3: Verify the route**

```bash
curl -s -o /dev/null -w "/admin/invoices: %{http_code}\n" http://localhost:2069/admin/invoices
```

Expected: `307` — redirected to admin login when signed out.

- [ ] **Step 4: Commit**

```bash
git add app/admin/invoices/page.tsx
git commit -m "feat(admin): add invoice review page for finance

Distinguishes 'none issued yet' from 'filters excluded everything' —
different problems, different fixes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Super admin analytics dashboard

**Files:**
- Create: `app/admin/analytics/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/console`, `/api/admin/retention-trend`, `/api/admin/login-analytics`, `/api/admin/investor-insights` (all now gated to `analytics` or `console` by Task 2)

- [ ] **Step 1: Write the page**

A `"use client"` component. This is the surface business decisions are made
from, so every panel must answer a question, not merely display a number.

Fetch all four endpoints with `Promise.allSettled`, so one failing endpoint
degrades its own panel rather than blanking the page. A panel whose fetch
failed shows "This section couldn't load. Refresh to try again." in place of
its chart.

Panels, in order:

1. **Headline tiles** (from `/api/admin/console`) — Client accounts,
   Onboarding complete with percentage, Never logged in, Families without a
   head. Same `Kpi` treatment as the console: Lato figures, destructive colour
   where the number represents a gap.

2. **The activation gap** (from `/api/admin/investor-insights`) — the single
   most decision-relevant panel. Render `activatedCount`,
   `loggedInWithTimestamp`, `neverLoggedInCount`, `avgDays` and `medianDays`.
   Show `coverageNote` verbatim beneath as muted text: it explains that the
   gap is computable for only some investors, and dropping that caveat would
   overstate the precision of the average.

3. **Onboarding funnel** (from `/api/admin/console`) — the same five-stage
   bar treatment as the console, with the largest drop called out in
   destructive colour beneath.

4. **Retention** (from `/api/admin/retention-trend`) — `weeklyActive` as an
   area chart in `#008455`, and the cohort table (`cohortWeek`, `cohortSize`,
   `retained`, `retentionRate`) beside it. Retention rate right-aligned,
   `tabular-nums`, one decimal.

5. **Web vs app** (from `/api/admin/login-analytics`) — `web`, `app` and
   `both` as a stacked horizontal bar: `#0A3452` for web, `#008455` for app,
   `#9CA3AF` for both, with a legend. Add `distinctUsers` and `totalLogins`
   as two small figures.

Every chart is inline SVG with `preserveAspectRatio="none"` inside a
`viewBox`, computed from the data rather than hardcoded, with an `aria-label`
naming the series and its values. Grid lines use `text-border/20`.

Loading uses skeletons shaped like the panels. 403 shows "This dashboard is
for the leadership team." 401 links to
`/admin/login?redirect=/admin/analytics`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/analytics"`
Expected: no output.

- [ ] **Step 3: Verify the route and its gate**

```bash
curl -s -o /dev/null -w "/admin/analytics: %{http_code}\n" http://localhost:2069/admin/analytics
curl -s -o /dev/null -w "retention-trend, no cookie: %{http_code}\n" http://localhost:2069/api/admin/retention-trend
```

Expected: `307` for the page, `401` for the API.

- [ ] **Step 4: Commit**

```bash
git add app/admin/analytics/page.tsx
git commit -m "feat(admin): add consolidated analytics dashboard for leadership

Activation gap, onboarding funnel, retention cohorts and platform split.
Panels degrade independently so one failing endpoint does not blank the
page, and the investor-insights coverage caveat is shown verbatim rather
than dropped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end role verification

**Files:** none — verification only.

- [ ] **Step 1: Confirm every section API refuses the wrong role**

There is no way to mint a real Microsoft session from a script, so verify the
two halves separately.

First, that the map denies correctly — re-run Task 1's probe:

Run: `node <scratchpad>/verify-roles.mjs`
Expected: **22 passed, 0 failed.**

Second, that every gated route calls `requireRole` and none was missed:

```bash
cd "$(git rev-parse --show-toplevel)"
for f in app/api/admin/console/route.ts \
         app/api/admin/clients/route.ts \
         "app/api/admin/clients/[id]/route.ts" \
         app/api/admin/families/route.ts \
         "app/api/admin/families/[groupid]/head/route.ts" \
         app/api/admin/invoices/route.ts \
         app/api/admin/retention-trend/route.ts \
         app/api/admin/login-analytics/route.ts \
         app/api/admin/investor-insights/route.ts \
         app/api/distributor/internal-overview/route.ts; do
  printf "%-52s " "$f"
  grep -q "requireRole" "$f" && echo "guarded" || echo "MISSING requireRole"
done
```

Expected: **every line reads "guarded".** Any "MISSING" is an unenforced
section — fix before continuing.

- [ ] **Step 2: Confirm no admin route lost its authentication**

```bash
for p in console clients families invoices me retention-trend login-analytics; do
  printf "  %-20s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 60 "http://localhost:2069/api/admin/$p"
done
```

Expected: **401 for every one.** A 200 anywhere means a route lost its guard
during the Task 2 edits.

- [ ] **Step 3: Confirm the pages route**

```bash
for p in /admin /admin/console /admin/analytics /admin/invoices /admin/clients /distributors/internal; do
  printf "  %-24s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 120 "http://localhost:2069$p"
done
```

Expected: `307` for each (redirect to admin login when signed out). A `500`
means a page failed to compile.

- [ ] **Step 4: Browser check, if you can sign in**

Sign in as a super admin and confirm: `/admin` lands on `/admin/analytics`;
the sidebar shows all seven sections; `/admin/invoices` renders its empty
state rather than an error.

If a distributor-role or invoices-role account is available, sign in as them
and confirm the sidebar shows only their section and that typing another
role's URL — `/admin/clients` for instance — returns the 403 message rather
than data. **This is the check that matters most**; note it explicitly as
unverified if no such account can be used.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(admin): verify role enforcement across the back office

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Four roles, mapped by email | 1 |
| Unmapped staff → `default` | 1 |
| `rishabh.nahar@` spelling | 1 (map + probe case) |
| Section access table | 1 |
| `requireRole` enforces server-side | 2 |
| `/api/admin/me` for the nav | 2 |
| Role-aware sidebar | 3 |
| `/admin` lands per role | 3 |
| Read-only invoice API | 4 |
| Invoice page with honest empty states | 5 |
| Super admin analytics dashboard | 6 |
| Distributor view keeps the console's UI | Already true — `/distributors/internal` adopted the shell in commit 3982f1f; Task 2 adds its role gate |
| Fees module untouched | Global constraint |
| Distributor invoice pages untouched | Global constraint; Task 4 reads the table independently |
| Figures in Lato | Tasks 5, 6 |

No spec requirement is unassigned.

**Placeholder scan:** No TBDs. Tasks 1, 2 and 4 carry complete code; Tasks 3,
5 and 6 enumerate every panel, state and copy string rather than saying "build
the UI".

**Type consistency:** `Role`, `Section`, `resolveRole`, `canAccess`,
`sectionsFor`, `landingFor`, `requireRole`, `isRoleUser`, `AdminUserWithRole`
are used with identical names and shapes across Tasks 2–6 as defined in Tasks
1 and 2. `InvoiceRow` field names in Task 4's mapping match the page's usage
in Task 5.

**Carry-forward risks:**
1. `karan.salecha@`, `kruti.dave@` and `accounts@` cannot sign in until an
   operator adds them to `ADMIN_AUTHORIZED_EMAILS`. Their roles are dormant
   until then, and the cross-role browser check in Task 7 Step 4 may be
   unverifiable without them.
2. `distributor_invoice_issued` holds 0 rows, so the invoice page ships
   showing its empty state. That is correct behaviour, not a defect.
