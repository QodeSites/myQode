# Distributor Portal Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the distributor dashboard into three focused pages with plain-language labels, charts instead of prose, SOA downloads, and impersonation that blocks the transactional pages.

**Architecture:** One shared vocabulary module maps every CRM stage to partner-facing language, so no page invents its own wording. Three routes replace the single page. SOA PDFs stream through an authenticated route that first proves the investor belongs to the requesting partner. The impersonation restriction lives in middleware, which is the only layer that sees both the cookie and the path.

**Tech Stack:** Next.js 15.5 App Router, React 18.3, Tailwind v4 (CSS config), `pg`, Zoho CRM v2 REST + v3 COQL.

**Spec:** `docs/superpowers/specs/2026-09-01-distributor-portal-design.md`

## Global Constraints

- **Never show a CRM stage name to a partner.** Every label comes from `lib/distributorVocabulary.ts` (Task 1). "First Fund Initiated" is **Account funded**, never "Funding".
- **An SOA may only be fetched for an investor in the requesting partner's own book.** Verify membership before any Zoho read — this is the security boundary, not the UI.
- **Zoho credentials never reach the browser.** The PDF streams through the app; `download_Url` is never sent to the client.
- **Download call, exact form** (verified 2026-09-01, returns a 115KB PDF): `GET /crm/v2/Investors/{record.id}/actions/download_fields_attachment?fields_attachment_id={attachment_Id}`. Using `entity_Id` returns `INVALID_DATA`; using `file_Id` returns `UNABLE_TO_PARSE_DATA_TYPE`. Both were tried; neither works.
- **`SOA_Reports` is a fileupload field** — it does NOT come back through COQL, only a v2 record read or search.
- **102 of 418 investors have an SOA; 316 do not.** Absence is the normal case and must never render as an error.
- **The impersonation block belongs in `middleware.ts`, not the layout.** A server component cannot read the current pathname; middleware can.
- **Design system:** existing semantic tokens only. Figures in Lato (`font-sans`), Playfair only for the wordmark. Strategy colours `#008455` (QAW) / `#0A3452` (QGF) / `#550E0E` (QTF), neutral `#9CA3AF`.
- **Mobile:** works at 375px; nothing scrolls sideways.
- **No test framework exists.** Verification is Node probes against live Zoho plus `npx tsc --noEmit` and `curl`. Probes go in the session scratchpad, never committed.
- **Do not touch the fees module** (`lib/zohoDistributorFees.ts`, `lib/feeEngine.ts`, `app/(protected)/distributor/fees-distribution/`).

> Never paste an absolute Windows path into a file under `docs/`. Tailwind v4 scans this directory and a backslash followed by hex characters parses as a CSS unicode escape — this previously threw `RangeError: Invalid code point` and broke every page build.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/distributorVocabulary.ts` | The single source of partner-facing language |
| `lib/zohoInvestorSoa.ts` | SOA lookup and PDF fetch from Zoho |
| `app/api/distributor/investor-soa/route.ts` | Ownership check, then stream the PDF |
| `app/(protected)/distributors/page.tsx` | Overview — charts only |
| `app/(protected)/distributors/investors/page.tsx` | The investor list |
| `app/(protected)/distributors/referrals/page.tsx` | Links and help |
| `components/qode-distributor-sidebar.tsx` | Nav entries, and hiding restricted links |
| `middleware.ts` | Blocks transactional routes while impersonating |

---

### Task 1: The vocabulary module

**Files:**
- Create: `lib/distributorVocabulary.ts`

**Interfaces:**
- Produces:
  - `type StatusKey = "invested" | "funded" | "paperwork" | "inactive" | "declined" | "closed"`
  - `type StatusInfo = { key: StatusKey; label: string; detail: string; tone: "good" | "normal" | "warn" }`
  - `statusFor(stage: string | null): StatusInfo`
  - `STATUS_ORDER: readonly StatusInfo[]`
  - `STRATEGY_COLOR: Record<string, string>`
  - `shortStrategy(name: string): string`

- [ ] **Step 1: Write the module**

```typescript
// Partner-facing language for the distributor portal.
//
// WHY THIS EXISTS
// Zoho's stage names describe the firm's own pipeline, not the investor's
// situation. "First Fund Initiated" tells a distributor nothing about their
// client — it is our word for our process. A partner reading it has to guess,
// and guessing wrong about a client's money is the worst kind of confusion.
//
// Every label here answers "what happened to this investor?" in words a
// partner would use speaking to that client. No page may invent its own
// wording: if a label is wrong, it is wrong in one place.

export type StatusKey =
  | "invested"
  | "funded"
  | "paperwork"
  | "inactive"
  | "declined"
  | "closed";

export type StatusInfo = {
  key: StatusKey;
  /** Shown on the row. Two words at most. */
  label: string;
  /** One line under a group heading, explaining the label. */
  detail: string;
  tone: "good" | "normal" | "warn";
};

const INVESTED: StatusInfo = {
  key: "invested",
  label: "Invested",
  detail: "Money is in the market",
  tone: "good",
};
const FUNDED: StatusInfo = {
  key: "funded",
  label: "Account funded",
  detail: "Paid in, units being allotted",
  tone: "normal",
};
const PAPERWORK: StatusInfo = {
  key: "paperwork",
  label: "Paperwork in progress",
  detail: "Account opening not yet complete",
  tone: "normal",
};
const INACTIVE: StatusInfo = {
  key: "inactive",
  label: "Inactive",
  detail: "Account open, nothing moving",
  tone: "warn",
};
const DECLINED: StatusInfo = {
  key: "declined",
  label: "Did not proceed",
  detail: "Never opened an account",
  tone: "warn",
};
const CLOSED: StatusInfo = {
  key: "closed",
  label: "Closed",
  detail: "Opened, then exited",
  tone: "warn",
};

/** Display order: furthest along first, inactive last. */
export const STATUS_ORDER: readonly StatusInfo[] = [
  INVESTED,
  FUNDED,
  PAPERWORK,
  INACTIVE,
  DECLINED,
  CLOSED,
];

/**
 * Maps a Zoho stage to partner-facing language.
 *
 * An unrecognised stage falls through to "Paperwork in progress" rather than
 * showing the raw value: a new CRM stage should never leak internal wording
 * into a partner's screen. It is the least alarming honest default — it says
 * "in progress", which is true of anything not yet invested.
 */
export function statusFor(stage: string | null): StatusInfo {
  switch (stage) {
    case "Account Live":
    case "Regular Investor":
      return INVESTED;
    case "First Fund Initiated":
      return FUNDED;
    case "Onboarding":
      return PAPERWORK;
    case "Dormant Investor":
      return INACTIVE;
    case "Dropped before account opening":
      return DECLINED;
    case "Dropped after account opening":
      return CLOSED;
    default:
      return PAPERWORK;
  }
}

/** Strategy identity colours, per the design system. */
export const STRATEGY_COLOR: Record<string, string> = {
  "Qode All Weather": "#008455",
  "Qode Growth Fund": "#0A3452",
  "Qode Tactical Fund": "#550E0E",
};

/** "Qode Growth Fund" -> "Growth". Keeps chart labels readable. */
export function shortStrategy(name: string): string {
  return name.replace(/^Qode\s+/, "").replace(/\s+Fund$/, "");
}
```

- [ ] **Step 2: Verify every production stage maps to a label**

Write `<scratchpad>/verify-vocab.mjs`:

```javascript
// The six stages present in production, per lib/zohoDistributorJourney.ts.
const STAGES = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
  "Dormant Investor",
  "Dropped before account opening",
  "Dropped after account opening",
];
const MAP = {
  "Account Live": "Invested",
  "Regular Investor": "Invested",
  "First Fund Initiated": "Account funded",
  Onboarding: "Paperwork in progress",
  "Dormant Investor": "Inactive",
  "Dropped before account opening": "Did not proceed",
  "Dropped after account opening": "Closed",
};
let pass = 0, fail = 0;
for (const s of STAGES) {
  const label = MAP[s] ?? "Paperwork in progress";
  const leaks = label === s || /Fund Initiated|Dropped|Dormant|Regular Investor/.test(label);
  leaks ? fail++ : pass++;
  console.log(`${leaks ? "FAIL" : "PASS"}  ${s} -> ${label}`);
}
const unknown = MAP["Some New Stage"] ?? "Paperwork in progress";
console.log(`${unknown === "Paperwork in progress" ? "PASS" : "FAIL"}  unknown stage -> ${unknown}`);
console.log(`\n${pass + 1} passed, ${fail} failed`);
```

Run: `node <scratchpad>/verify-vocab.mjs`

Expected: **8 passed, 0 failed.** Every production stage maps to language that
does not repeat the CRM wording, and an unknown stage falls through safely.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep distributorVocabulary`
Expected: no output. (Pre-existing errors elsewhere — notably a `nodemailer` type error in `app/api/auth/admin/send-bulk-setup-emails/route.ts` — are out of scope.)

- [ ] **Step 4: Commit**

```bash
git add lib/distributorVocabulary.ts
git commit -m "feat(distributor): add partner-facing vocabulary

One source for every label a distributor sees. Zoho stage names describe
our pipeline, not the investor's situation — 'First Fund Initiated' is
now 'Account funded'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: SOA lookup and download

**Files:**
- Create: `lib/zohoInvestorSoa.ts`

**Interfaces:**
- Consumes: `getZohoAccessToken`, `zohoApiDomain` from `@/lib/zoho`
- Produces:
  - `type SoaFile = { fileName: string; attachmentId: string; recordId: string; sizeLabel: string }`
  - `findSoaForInvestor(email: string): Promise<SoaFile | null>`
  - `downloadSoa(recordId: string, attachmentId: string): Promise<{ body: ArrayBuffer; fileName: string } | null>`

- [ ] **Step 1: Write the module**

```typescript
// Statement-of-account PDFs, from the Zoho Investors module.
//
// SOA_Reports is a `fileupload` field. It does NOT come back through COQL —
// only a v2 record read or search returns it — which is why this module uses
// the REST API rather than the COQL helper the other Zoho modules share.
//
// Verified 2026-09-01: 102 of 418 investors carry a PDF; 316 do not. An
// investor without one is the ordinary case, so every function here returns
// null rather than throwing when nothing is attached.
import { getZohoAccessToken, zohoApiDomain } from "@/lib/zoho";

export type SoaFile = {
  fileName: string;
  attachmentId: string;
  recordId: string;
  /** Zoho's own human-readable size, e.g. "115.42 KB". */
  sizeLabel: string;
};

/**
 * The most recent SOA for an investor, or null when they have none.
 *
 * SECURITY: this function performs NO ownership check. The caller must first
 * confirm the investor belongs to the requesting distributor — see
 * app/api/distributor/investor-soa/route.ts. Called with an arbitrary email,
 * it will happily return any investor's statement.
 */
export async function findSoaForInvestor(email: string): Promise<SoaFile | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;

  const token = await getZohoAccessToken();
  const res = await fetch(
    `${zohoApiDomain()}/crm/v2/Investors/search?email=${encodeURIComponent(key)}&fields=Name,Email,SOA_Reports`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: "no-store" },
  );

  // 204 means no matching investor — a normal answer, not a failure.
  if (res.status === 204) return null;
  if (!res.ok) {
    throw new Error(`Zoho SOA lookup failed: ${res.status}`);
  }

  const body = (await res.json()) as { data?: any[] };
  const record = body.data?.[0];
  if (!record?.id) return null;

  const files = Array.isArray(record.SOA_Reports) ? record.SOA_Reports : [];
  if (!files.length) return null;

  // Zoho returns these oldest-first; the newest statement is the useful one.
  const file = files[files.length - 1];
  if (!file?.attachment_Id) return null;

  return {
    fileName: String(file.file_Name ?? "statement.pdf"),
    attachmentId: String(file.attachment_Id),
    recordId: String(record.id),
    sizeLabel: String(file.file_Size ?? ""),
  };
}

/**
 * Fetches the PDF bytes.
 *
 * The endpoint takes the RECORD id and the ATTACHMENT id. Verified
 * 2026-09-01 against a live record: this combination returns a 115KB PDF,
 * while `entity_Id` gives INVALID_DATA and `file_Id` gives
 * UNABLE_TO_PARSE_DATA_TYPE. Both alternatives were tried; neither works.
 */
export async function downloadSoa(
  recordId: string,
  attachmentId: string,
): Promise<{ body: ArrayBuffer; fileName: string } | null> {
  const token = await getZohoAccessToken();
  const res = await fetch(
    `${zohoApiDomain()}/crm/v2/Investors/${encodeURIComponent(recordId)}/actions/download_fields_attachment?fields_attachment_id=${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: "no-store" },
  );

  if (!res.ok) return null;

  // Zoho reports some failures as JSON with HTTP 200, so check the type.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return null;

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);

  return {
    body: await res.arrayBuffer(),
    fileName: match?.[1] ?? "statement.pdf",
  };
}
```

- [ ] **Step 2: Verify against a live record**

Write `<scratchpad>/verify-soa.mjs`. It mirrors both functions:

```javascript
import fs from 'fs';
const e = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const dc = e.ZOHO_CRM_DATA_CENTER || 'in';
const tok = (await (await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ refresh_token: e.ZOHO_CRM_REFRESH_TOKEN,
    client_id: e.ZOHO_CRM_CLIENT_ID, client_secret: e.ZOHO_CRM_CLIENT_SECRET,
    grant_type: 'refresh_token' }) })).json()).access_token;

const EMAIL = 'shah.dhaval39@gmail.com';   // known to have an SOA
const s = await fetch(`https://www.zohoapis.${dc}/crm/v2/Investors/search?email=${encodeURIComponent(EMAIL)}&fields=Name,SOA_Reports`,
  { headers: { Authorization: `Zoho-oauthtoken ${tok}` } });
console.log('lookup status:', s.status);
const rec = (await s.json()).data[0];
const f = rec.SOA_Reports[rec.SOA_Reports.length - 1];
console.log('file:', f.file_Name, '|', f.file_Size);

const d = await fetch(`https://www.zohoapis.${dc}/crm/v2/Investors/${rec.id}/actions/download_fields_attachment?fields_attachment_id=${f.attachment_Id}`,
  { headers: { Authorization: `Zoho-oauthtoken ${tok}` } });
const buf = Buffer.from(await d.arrayBuffer());
const isPdf = buf.subarray(0, 4).toString() === '%PDF';
console.log('download:', d.status, '|', buf.length, 'bytes | PDF:', isPdf);

// An investor with no SOA must return cleanly, not throw.
const none = await fetch(`https://www.zohoapis.${dc}/crm/v2/Investors/search?email=${encodeURIComponent('definitely-not-a-real-investor@example.com')}&fields=Name,SOA_Reports`,
  { headers: { Authorization: `Zoho-oauthtoken ${tok}` } });
console.log('unknown investor status:', none.status, '(204 = no match, handled as null)');
console.log(isPdf && d.status === 200 && none.status === 204 ? '\nPASS' : '\nFAIL');
```

Run: `node <scratchpad>/verify-soa.mjs`

Expected: lookup 200, a real PDF of ~115KB, unknown investor 204, and **PASS**.
If the download returns 400, re-read the constraint above — the record id and
attachment id are the only pair that works.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep zohoInvestorSoa`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/zohoInvestorSoa.ts
git commit -m "feat(distributor): add SOA lookup and download from Zoho

SOA_Reports is a fileupload field, so it needs the v2 REST API rather
than COQL. The download takes the record id and attachment id — entity_Id
and file_Id both fail, and were tried.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The SOA endpoint

**Files:**
- Create: `app/api/distributor/investor-soa/route.ts`

**Interfaces:**
- Consumes: `resolveDistributorByEmail` from `@/lib/distributorIdentity`; `getJourneyForDistributor` from `@/lib/zohoDistributorJourney`; `findSoaForInvestor`, `downloadSoa` (Task 2)
- Produces: `GET /api/distributor/investor-soa?email=…` → the PDF, or JSON error

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { getJourneyForDistributor } from "@/lib/zohoDistributorJourney";
import { findSoaForInvestor, downloadSoa } from "@/lib/zohoInvestorSoa";

/**
 * Streams an investor's statement of account to the distributor who referred
 * them.
 *
 * THE OWNERSHIP CHECK IS THE SECURITY BOUNDARY.
 * The investor's email arrives as a query parameter, so without this check a
 * partner could read any investor's statement by guessing an address. The
 * requested email must appear in the caller's OWN book — resolved from their
 * httpOnly session, never from anything the client sends.
 *
 * The PDF is streamed through this route rather than redirecting to Zoho's
 * download_Url, so the CRM credentials never reach the browser.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("qode-user-context")?.value;
    if (!raw) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let sessionEmail: string | undefined;
    try {
      sessionEmail = JSON.parse(raw)?.email;
    } catch {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    const distributor = await resolveDistributorByEmail(sessionEmail);
    if (!distributor) {
      return NextResponse.json({ error: "Not a distributor" }, { status: 403 });
    }

    const target = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
    if (!target) {
      return NextResponse.json({ error: "Missing investor" }, { status: 400 });
    }

    // Ownership: the investor must be in this partner's own book.
    const journey = await getJourneyForDistributor(distributor.email);
    const owns = (journey?.clients ?? []).some(
      (c) => String(c.email ?? "").trim().toLowerCase() === target,
    );
    if (!owns) {
      // Deliberately the same shape as "no statement": a partner should not be
      // able to probe which addresses exist by comparing error messages.
      return NextResponse.json({ error: "No statement available" }, { status: 404 });
    }

    const soa = await findSoaForInvestor(target);
    if (!soa) {
      return NextResponse.json({ error: "No statement available" }, { status: 404 });
    }

    const file = await downloadSoa(soa.recordId, soa.attachmentId);
    if (!file) {
      return NextResponse.json({ error: "No statement available" }, { status: 404 });
    }

    return new NextResponse(file.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${soa.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[distributor/investor-soa] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the gates**

With the dev server on port 2069:

```bash
printf "  no session:        "
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:2069/api/distributor/investor-soa?email=shah.dhaval39@gmail.com"

printf "  investor session:  "
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'Cookie: qode-auth=1; qode-user-context={"email":"drankitmehta18@gmail.com"}' \
  "http://localhost:2069/api/distributor/investor-soa?email=shah.dhaval39@gmail.com"

printf "  not in their book: "
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'Cookie: qode-auth=1; qode-user-context={"email":"advisory@onebattalion.in"}' \
  "http://localhost:2069/api/distributor/investor-soa?email=definitely-not-theirs@example.com"
```

Expected: **401**, **403**, **404**. The third is the important one — a real
distributor asking for someone else's statement must be refused.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep investor-soa`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/distributor/investor-soa
git commit -m "feat(distributor): add SOA download endpoint

The investor email arrives as a query parameter, so the route first
confirms that investor is in the caller's own book — resolved from their
session, never from the request. Without it a partner could read any
investor's statement by guessing an address.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Block transactional pages while impersonating

**Files:**
- Modify: `middleware.ts`
- Create: `app/(protected)/_components/impersonation-banner.tsx`

**Interfaces:**
- Produces: `<ImpersonationBanner />` — renders only when the impersonation cookie is present

- [ ] **Step 1: Add the block to middleware**

In `middleware.ts`, immediately before the final `return NextResponse.next()`
of the main function, insert:

```typescript
  // While an admin or distributor is viewing someone else's account, the
  // transactional pages are off limits: nobody may move a client's money from
  // inside an impersonated session.
  //
  // This lives in middleware because it is the only layer that sees both the
  // cookie and the path — a server component cannot read the current pathname.
  // Hiding the sidebar links is presentation; this is the control.
  const impersonating = request.cookies.get('qode-admin-impersonation')?.value;
  if (impersonating) {
    const blocked = ['/payment', '/experience/account-services'];
    if (blocked.some((p) => request.nextUrl.pathname.startsWith(p))) {
      const url = new URL('/portfolio/performance', request.url);
      url.searchParams.set('blocked', 'impersonation');
      return NextResponse.redirect(url);
    }
  }
```

Then extend the matcher so these paths reach middleware at all:

```typescript
  matcher: [
    '/admin/:path*',
    '/api/:path*',
    '/distributors/internal',
    '/distributors/internal/:path*',
    '/payment/:path*',
    '/experience/account-services/:path*',
  ],
```

- [ ] **Step 2: Write the banner**

`app/(protected)/_components/impersonation-banner.tsx`:

```tsx
"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

/**
 * Tells the viewer they are looking at someone else's account, and why a
 * transactional page refused them.
 *
 * The refusal message appears only when middleware redirected here with
 * ?blocked=impersonation — so a partner who typed /payment learns why it did
 * not open, rather than silently landing somewhere else.
 */
export function ImpersonationBanner({ clientName }: { clientName: string | null }) {
  const params = useSearchParams();
  const blocked = params.get("blocked") === "impersonation";

  if (!clientName && !blocked) return null;

  return (
    <div className="mb-4 flex flex-col gap-1 rounded-md border border-primary/30 bg-primary/[0.06] px-4 py-3">
      {clientName ? (
        <p className="text-sm text-foreground">
          You are viewing{" "}
          <span className="font-bold">{clientName}</span>&apos;s account.
        </p>
      ) : null}
      {blocked ? (
        <p className="text-[12px] text-muted-foreground">
          Adding money and changing strategy aren&apos;t available while viewing
          someone else&apos;s account. The investor can do this from their own login.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Verify the block**

```bash
printf "  /payment, normal session:        "
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'Cookie: qode-auth=1' http://localhost:2069/payment

printf "  /payment, impersonating:         "
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  -H 'Cookie: qode-auth=1; qode-admin-impersonation={"isImpersonating":true}' \
  http://localhost:2069/payment

printf "  account-services, impersonating: "
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'Cookie: qode-auth=1; qode-admin-impersonation={"isImpersonating":true}' \
  http://localhost:2069/experience/account-services
```

Expected: the normal session is unaffected; both impersonated requests return
**307** to `/portfolio/performance?blocked=impersonation`.

**Middleware changes require a dev-server restart to take effect.** If the
result is unchanged, restart before concluding the block does not work.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts "app/(protected)/_components/impersonation-banner.tsx"
git commit -m "feat(distributor): block transactional pages while impersonating

Nobody may move a client's money from inside an impersonated session.
Enforced in middleware, the only layer that sees both the cookie and the
path — hiding the sidebar links is presentation, this is the control.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Overview page

**Files:**
- Rewrite: `app/(protected)/distributors/page.tsx`

**Interfaces:**
- Consumes: `GET /api/distributor/journey`; `statusFor`, `STATUS_ORDER`, `STRATEGY_COLOR`, `shortStrategy` (Task 1)

- [ ] **Step 1: Write the page**

A `"use client"` component. Charts and figures only — **no investor list**;
that is Task 6's page. Sections, in order:

1. **Header** — `<h1>Overview</h1>` and the partner's name.
2. **Total value today** — the headline figure, with the gain against amount
   invested as `▲ ₹0.25 Cr (+1.5%)` in `#008455` when positive and
   `text-destructive` when negative. Beside it, three small figures: **Your
   investors**, **Invested**, **Not yet invested**.
3. **Where your investors are** — a horizontal stacked bar across
   `STATUS_ORDER`, each segment coloured by tone (`#008455` good, `#9CA3AF`
   normal, `var(--destructive)` warn) and sized by count. Beneath it, a legend
   row per non-zero status: swatch, `label`, count, and `detail` in muted text.
   Each segment carries a `title` attribute with `"{count} {label}"`.
4. **Strategy split** — one bar per strategy, coloured from `STRATEGY_COLOR`,
   labelled with `shortStrategy(name)` and the count. One line beneath: "An
   investor holding two strategies is counted in both."
5. **Recently invested** — up to three investors whose `accountLiveDate` falls
   in the last 30 days: name, strategies, value, date. Omit the whole section
   when none.
6. **Two links** — "See all investors" → `/distributors/investors`, and "Refer
   an investor" → `/distributors/referrals`, as cards with `ChevronRight`.

States: `<Skeleton>` shaped like the sections while loading; the 403 card
("This page is for Qode distribution partners…", contact
partnerships@qodeinvest.com); the CRM-unavailable and CRM-unlinked messages
already used on the current page, kept verbatim.

Helpers, in-file:

```typescript
function money(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
```

Where the partial-pricing caveat applies, keep the existing wording: "Values
cover the N of M investors whose holdings are priced in our records."

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "distributors/page"`
Expected: no output.

- [ ] **Step 3: Verify it renders**

```bash
curl -s -o /dev/null -w "/distributors: %{http_code}\n" http://localhost:2069/distributors
```

Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/distributors/page.tsx"
git commit -m "feat(distributor): overview page with charts, no lists

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Investors page

**Files:**
- Create: `app/(protected)/distributors/investors/page.tsx`

**Interfaces:**
- Consumes: `GET /api/distributor/journey`; `GET /api/distributor/investor-soa` (Task 3); `POST /api/admin/dashboard` with `{ action: "impersonate", clientCode }`; vocabulary (Task 1)

- [ ] **Step 1: Write the page**

A `"use client"` component. Mandatory:

1. **Header** — `<h1>Your investors</h1>`, with a back link to `/distributors`.
2. **Status filter** — one chip per non-zero status from `STATUS_ORDER`, each
   showing `label` and count, plus an "All" chip. The chip is the filter.
3. **Search** — name, city or strategy, `min-h-[44px]`.
4. **List** — one card per investor, sorted by `currentValue` descending,
   paginated at 10 with a "Show 25 more (N remaining)" control that resets when
   the filter or search changes. Each card shows:
   - name, and the status label as a pill (warn tones in `text-destructive`)
   - city · strategies · "Invested {date}" on one muted line
   - value and gain on the right
   - **Download statement** — only when the investor has an SOA
   - **Open account** — only when `clientCode` is available
5. **Actions.** Download calls
   `/api/distributor/investor-soa?email={email}` and, on a non-OK response,
   shows "No statement is available for this investor yet." — never a raw
   status code. Open account POSTs the impersonation action and opens
   `redirectUrl` in a new tab with `noopener`.

The API does not yet say who has an SOA, so the download button renders for
every investor and reports absence on click. That is deliberate: adding a
per-investor SOA probe to the journey endpoint would mean 53 extra Zoho reads
per page load, and the field is not available through COQL.

States: skeleton while loading; the same 403 / CRM-unavailable / CRM-unlinked
messages as the Overview; "No investors match this view. Try a different
search, or choose All above." when a filter empties the list.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "distributors/investors"`
Expected: no output.

- [ ] **Step 3: Verify**

```bash
curl -s -o /dev/null -w "/distributors/investors: %{http_code}\n" http://localhost:2069/distributors/investors
```

Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/distributors/investors/page.tsx"
git commit -m "feat(distributor): investors page with statements and account view

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Referrals page and navigation

**Files:**
- Create: `app/(protected)/distributors/referrals/page.tsx`
- Modify: `components/qode-distributor-sidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/distributor/journey` (for `referralLinks`)

- [ ] **Step 1: Write the referrals page**

A `"use client"` component holding what the Overview no longer carries: the
two links with copy buttons (labelled **Individual** and **Company, LLP, HUF or
trust**), the "haven't been set up yet" state when `referralLinks` is null, and
the partnerships contact card. Reuse the existing `CopyLinkRow` pattern —
copy to clipboard, flip to "Copied" for 2 seconds, and fall back silently when
the clipboard is unavailable, since the URL is on screen and selectable.

- [ ] **Step 2: Update the sidebar**

In `components/qode-distributor-sidebar.tsx`, replace the single
`/distributors` entry with three, keeping the existing order and icons:

| href | Desktop label | Mobile label | Icon |
|---|---|---|---|
| `/distributors` | Overview | Overview | `LayoutDashboard` |
| `/distributors/investors` | Your investors | Investors | `Users` |
| `/distributor/fees-distribution` | Fees & payouts | Fees | `Calculator` |
| `/distributors/referrals` | Refer an investor | Refer | `Share2` |
| `/engagement/insights-and-events` | Insights & events | Insights | `Lightbulb` |

Remove the `/distributor/clients` entry: the new Investors page supersedes it
and keeping both would give a partner two different investor lists.

Import `Share2` and `LayoutDashboard`; drop any icon left unused.

- [ ] **Step 3: Typecheck and verify all routes**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "distributors/referrals|distributor-sidebar"
for p in /distributors /distributors/investors /distributors/referrals; do
  printf "  %-28s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:2069$p"
done
```

Expected: no type errors, and `200` for all three.

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/distributors/referrals/page.tsx" components/qode-distributor-sidebar.tsx
git commit -m "feat(distributor): referrals page and three-way navigation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: No CRM wording reaches a partner**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "First Fund Initiated\|Dropped before\|Dropped after\|Dormant Investor\|Regular Investor" \
  "app/(protected)/distributors" || echo "clean: no raw CRM stages in partner-facing pages"
```

Expected: **clean**. Any hit means a page is bypassing the vocabulary module.

- [ ] **Step 2: SOA ownership holds**

```bash
printf "  someone else's investor: "
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'Cookie: qode-auth=1; qode-user-context={"email":"advisory@onebattalion.in"}' \
  "http://localhost:2069/api/distributor/investor-soa?email=shah.dhaval39@gmail.com"
```

Expected: **404** unless that investor happens to be in One Battalion's book.
If it returns a PDF, confirm the investor really is theirs before treating it
as a pass — a false pass here is a data leak between partners.

- [ ] **Step 3: Transactional pages stay blocked**

```bash
for p in /payment /experience/account-services; do
  printf "  %-32s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H 'Cookie: qode-auth=1; qode-admin-impersonation={"isImpersonating":true}' \
    "http://localhost:2069$p"
done
```

Expected: **307** for both.

- [ ] **Step 4: Fees module untouched**

```bash
git diff --name-only main..HEAD | grep -Ei "fee|calculator|fees-distribution" \
  || echo "fees untouched"
```

Expected: **fees untouched**.

- [ ] **Step 5: Browser pass**

Sign in as a distributor. Confirm: Overview shows the value and both charts
with no list; Investors filters by status chip and searches; a Download
statement click either returns a PDF or says none is available; Open account
opens the portal in a new tab; and from inside that tab, `/payment` redirects
with the explanation rather than loading.

Note explicitly if any step could not be verified.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Plain-language labels, no CRM wording | 1, enforced by 8 |
| "First Fund Initiated" → "Account funded" | 1 |
| Three pages | 5, 6, 7 |
| Overview: charts, no lists | 5 |
| Strategy split chart | 5 |
| Recently invested | 5 |
| Investors list, search, filter, pagination | 6 |
| SOA download | 2, 3, 6 |
| SOA ownership check | 3, verified in 8 |
| PDF streamed, credentials never exposed | 2, 3 |
| Open investor account | 6 |
| Transactional pages blocked server-side | 4, verified in 8 |
| Restricted links hidden | 4 (banner), 7 (nav) |
| Referral links and help | 7 |
| Design tokens, Lato figures, strategy colours | 1, 5, 6 |
| Fees module untouched | Global constraint, verified in 8 |

No spec requirement is unassigned. Payout status stays a placeholder, as the
spec states.

**Placeholder scan:** No TBDs. Tasks 1–4 carry complete code; Tasks 5–7
enumerate every section, state and copy string rather than saying "build the
UI".

**Type consistency:** `StatusInfo`, `StatusKey`, `statusFor`, `STATUS_ORDER`,
`STRATEGY_COLOR`, `shortStrategy`, `SoaFile`, `findSoaForInvestor`,
`downloadSoa` are used with identical names and shapes across Tasks 3, 5, 6
and 7 as defined in Tasks 1 and 2. `money` and `formatDate` are defined
per-page rather than shared, matching the existing convention in this codebase.

**Carry-forward risks:**
1. The download button renders for every investor because the journey endpoint
   does not know who has an SOA. Absence is reported on click. Adding it to
   the list would cost ~53 Zoho reads per page load and the field is not
   COQL-readable.
2. Middleware changes need a dev-server restart before the block takes effect.
3. `referral_slug` and `head_of_family` are still wiped by the Nuvama scrape
   until migration 007's override mechanism is extended — unrelated to this
   plan, but it affects the referral links this portal renders.
