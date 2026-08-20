# Distributor Module Revamp — Zoho-Connected Portal

**Date:** 2026-08-20
**Status:** Approved design, pending implementation plan

## Summary

Rebuild the distributor surface as a dedicated module at `/distributors`, with a
separate internal view at `/distributors/internal` for the Qode team. Distributor
journey data comes from Zoho CRM, joined on verified record IDs.

Out of scope by instruction: welcome-mail link (#4), SOA download (#6), and the
named-contact block (#9) — contact routes to partnerships@qodeinvest.com instead.

**Hard constraint: the fees module is not touched.** No edits to
`lib/zohoDistributorFees.ts`, `lib/feeEngine.ts`, `app/api/distributor/calculator/`,
or anything under `app/(protected)/distributor/fees-distribution/`. The journey
module performs its own independent Distributor lookup rather than extending the
fees library. This duplicates the email-indexing pattern; that duplication is the
accepted cost of leaving a working payout path untouched.

## Findings that drove this design

All verified against live Zoho CRM and the production database on 2026-08-20.

### 1. Distributor identity: `clientcode IS NULL`

`pms_clients_master` holds 548 rows. Exactly 16 have `clientcode IS NULL`, and all
16 sit under `intermediaryname = 'QODE ADVISORS LLP INT'`. Zero null-code rows
exist under any other intermediary. Every client row has a code.

`clientcode IS NULL` is therefore an exact discriminator for "this row is a
distributor, not a client". All 16 have a non-empty email, so the login join key
is complete with no fallback needed.

A distributor's clients are the rows where `intermediaryname = <their clientname>`
— the mechanism the current clients route already uses.

### 2. The referral link string comes from the DB, not Zoho

`pms_clients_master.clientname` matches the live onboarding links exactly:

| Source | Value |
|---|---|
| Live link | `Mr%20One%20Battalion%20Ventures%20Private%20Limited` |
| DB `clientname` | `One Battalion Ventures Private Limited` ✅ |
| Zoho `Name` | `One Battalion Ventures` ❌ (truncated) |

Zoho's `Name` is a shortened display label ("Enso Finserve", "Funds India") and
would generate broken attribution links. **Links are generated from
`clientname` with an `Mr ` prefix.**

This still needs one round of live testing before release: the `Mr ` prefix
convention is inferred from the provided list, not from the onboarding app's
matching logic, which is external and unreadable from these repos. If attribution
misses, the durable fix is storing the canonical link on the Distributor record
rather than deriving it.

### 3. The Zoho join is by record ID, and email must include `Secondary_Email`

Portal login addresses live in `Secondary_Email` for most distributors:

| Portal login | Zoho `Email` | Zoho `Secondary_Email` |
|---|---|---|
| `advisory@onebattalion.in` | `jash@thepersonalcfo.in` | ✅ match |
| `altassets.ops@fundsindia.com` | `hemanthraj.mundlur@fundsindia.com` | ✅ match |
| `info@ensofinserv.com` | `info@ensowealth.in` | ✅ match |
| `rahulshetty42@gmail.com` | `rahulshetty432@gmail.com` | ✅ match |

An `Email`-only lookup fails for most distributors. Note `rahulshetty42` vs
`rahulshetty432` — a one-digit difference between two real addresses, which is why
fuzzy matching is prohibited: mis-attribution here shows one distributor another's
clients.

Resolution chain, all exact-match:

```
session email → pms_clients_master (clientcode IS NULL) → clientname
             → Zoho Distributor WHERE Email = ? OR Secondary_Email = ?  → record id
             → Investors WHERE Primary_distributo = <id>
```

### 4. Journey data lives on Investors, not Leads

`Lead_Stage` is effectively binary — 105 of 112 distributor leads are "Onboarding
Investor", 7 are "Lost Lead". A funnel built on it would put every client in one
bucket.

`Investor_Stage` is the real funnel (105 investors across 19 distributors):

| Stage | Count |
|---|---|
| First Fund Initiated | 63 |
| Onboarding | 17 |
| Account Live | 12 |
| Regular Investor | 8 |
| Dropped before account opening | 3 |
| Dropped after account opening | 2 |

Verified readable per distributor: `Name`, `Email`, `Investor_Stage`,
`Stage_Entry_Date`, `Activation_Date`, `Date_Of_1st_Investment`,
`First_Top_Up_Date`, and both drop-date fields.

Leads convert to Investor records already (112 leads → 105 investors). No second
ingestion path is built; the existing conversion is surfaced, not replaced.

### 5. There is no role system, and `/internal` is not identity-gated

The `(protected)` layout checks one boolean cookie, `qode-auth === "1"`. No role
or user-type exists in the session, the auth library, or the user record.

The existing `app/internal/` surface is gated by `ENABLE_INTERNAL_DEMO`, an
environment flag — global, not per-user. That is adequate for a dev-only demo but
**cannot** gate `/distributors/internal`: with the flag on, any authenticated
user, including all 16 distributors, could read every distributor's book.

Middleware matches `['/admin/:path*', '/api/:path*']` — `/internal` is uncovered.

**Middleware checks only that the admin cookie exists**; it explicitly defers
validation (`middleware.ts:63`). A forged cookie passes middleware. Server-side
`getSession()` validation against Redis is therefore mandatory in the page and
the API route — middleware is UX, not the security boundary.

## Architecture

### Authorization

Two distinct gates, per approved decisions:

**`/distributors`** — distributor-facing. Requires `qode-auth`, then resolves the
session email against `pms_clients_master` with `clientcode IS NULL`. No match =
404. Scoped to that distributor's own book only.

**`/distributors/internal`** — internal team. Gated by the existing `admin-session`
cookie, reusing the mechanism already enforced on `/admin`. Middleware's matcher
gains `/distributors/internal/:path*` for the redirect UX; the page and API
independently call `getSession()` and verify the session is valid before returning
data. Sees all distributors.

No new auth concept is introduced.

### Data access rule

Every query filters by the resolved distributor identity **before** any row is
fetched. Never fetch-then-filter — the ordering rule documented at
`lib/zohoInvestorDetails.ts:8-14`. No client-supplied distributor identifier is
ever trusted; identity derives from the httpOnly session cookie only.

The Zoho slice exposed to distributors stays narrow: stage and journey dates only.
No notes, internal commentary, owner remarks, or fee data.

### Files

New:
```
lib/zohoDistributorJourney.ts                    — self-contained Zoho reads
lib/distributorIdentity.ts                       — session email → distributor
app/api/distributor/journey/route.ts             — distributor-scoped
app/api/distributor/internal-overview/route.ts   — admin-session gated
app/(protected)/distributors/page.tsx            — distributor surface
app/(protected)/distributors/internal/page.tsx   — internal surface
```

Modified:
```
middleware.ts   — one matcher entry for internal redirect UX
```

`lib/zohoDistributorJourney.ts` follows the conventions of the existing Zoho libs:
module-level cache with 5-minute TTL, paged COQL (200/page), fail-soft. Zoho
unreachable degrades the section to a notice; the page still renders from portal
data.

## Surfaces

### `/distributors` — distributor-facing

**Referral links** — "Please use these links to refer to your investors."
Individual (`/apply`) and Non-Individual (`/entity`) links for the logged-in
distributor only, built from `clientname`, with copy buttons.

**Client journey** — funnel across the six real `Investor_Stage` values, drop
states shown honestly rather than hidden. Per-client table: name, stage, stage
entry date, activation date, account live date, first top-up.

**Referred leads** — a count of in-flight referrals. Deliberately not a funnel,
per finding 4.

**Payout status** — section shell in an "awaiting update" empty state. No Zoho
field wired, per instruction; structured so a single field lights it up later.

**Contact** — CTA to partnerships@qodeinvest.com.

### `/distributors/internal` — internal team

All 16 distributors in one view: per-distributor client counts, stage
distribution, and drop-offs, so the team can see which partners are converting.
Drill-through to a single distributor's journey. Reuses the same journey library
with the scoping filter widened after the admin-session check passes.

## Security summary

| Risk | Mitigation |
|---|---|
| Distributor reaches internal view | `admin-session` + server-side Redis validation |
| Forged admin cookie | `getSession()` in page and API; middleware not trusted |
| Cross-distributor data leak | Filter-before-fetch on resolved Zoho record ID |
| Wrong-distributor attribution | Exact email match only; fuzzy matching prohibited |
| Over-exposure of CRM data | Narrow field allowlist; no notes or fee data |

## Known limitations

1. **The `?distributor=` link is unauthenticated and user-editable.** Anyone can
   retype the parameter to attribute a lead to a different partner. It drives
   revenue-share, so a signed referral code is worth doing. Out of scope here;
   recorded so it is not forgotten.

2. **`Primary_distributo`** — the typo is in Zoho's API name. Used as-is with a
   comment; renaming is a CRM-side change.

3. **Referral link format is inferred**, not verified against the onboarding app.
   Requires one live test before release (finding 2).

4. **16 distributors in the DB vs 19–21 in Zoho.** Some Zoho-linked distributors
   have no portal row and cannot log in. The internal view surfaces this gap
   rather than hiding it.

## Styling

Existing myQode tokens and the Curtain palette. No new colors or fonts.

## Deferred

Tickets (#5) and cobranded deck (#8) — neither touches Zoho, and both need
decisions (ticket backend and lifecycle; who supplies deck assets and whether
generation is server-side). Scoped separately rather than bolted on.
