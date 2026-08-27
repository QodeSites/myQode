# Role-Based Back Office

**Date:** 2026-08-27
**Status:** Approved design, pending implementation plan

## Summary

Four roles decide what a signed-in staff member sees. The sidebar, the landing
route, and every admin API respect the same role map, so a person only reaches
the surfaces their job needs.

| Role | Who | Sees |
|---|---|---|
| `super` | gaurav.didwania@, karan.salecha@, rishabh.nahar@ | Everything, landing on a consolidated analytics dashboard |
| `distributor` | krutika.urankar@ | Distributor management and their clients only |
| `invoices` | kruti.dave@, accounts@ | Distributor invoices only, read-only |
| `default` | any other authorised staff | Individual investors and their data |

## Findings

Verified against the repo and production on 2026-08-27.

### 1. An allowlist already exists and is the right foundation

`app/api/auth/microsoft/callback/route.ts:122` reads
`ADMIN_AUTHORIZED_EMAILS` and rejects anyone not on it. The session it writes
carries `user.email` and `user.name`, so a role can be derived from the email
with no schema change and no new auth concept.

### 2. Three named people cannot sign in today

`ADMIN_AUTHORIZED_EMAILS` currently holds sanket.shinde@, gaurav.didwania@,
charvi.birla@, saakshi.poddar@, rishabh.nahar@, investor.relations@ and
krutika.urankar@.

**Missing: karan.salecha@, kruti.dave@, accounts@.** They are rejected before
any role check runs. The role map names them so the system works the moment
those addresses are added to the environment; adding them is an operator
action, not a code change.

Also note: the request spelled Rishabh's address `rishabnh.nahar@`. The
allowlist has `rishabh.nahar@`, which is the address used here — a transposed
spelling would silently lock him out.

### 3. Invoices have a table but no admin-reachable surface

Every invoice page lives under `app/(protected)/distributor/`, whose layout
requires a `qode-auth` investor session. Finance signs in with `admin-session`,
so those pages redirect them to the investor login.

`distributor_invoice_issued` exists with a usable shape — `distributor_email`,
`invoice_number`, `invoice_date`, `period_label`, `period_start`, `period_end`,
`amount_before_tax`, `tax_amount`, `total_amount`, `created_at` — and
currently holds **0 rows**. The new view must therefore lead with a real empty
state, not look broken.

### 4. The analytics super admins need is already built

Seven APIs return data no page renders: `retention-trend` (5 queries),
`mobile-analytics` (9), `login-analytics`, `client-platform-activity`,
`investor-insights`, `onboarded-clients`, `firebase-analytics`. The
consolidated dashboard is largely a presentation problem, not a data problem.

## Architecture

### The role map

One module, `lib/adminRoles.ts`, is the single source of truth:

```
ROLE_MAP: Record<string, Role>   // email (lowercased) -> role
resolveRole(email): Role         // unmapped authorised staff -> "default"
canAccess(role, section): boolean
landingFor(role): string
```

Roles are assigned by email because that is what the session carries and what
the allowlist already gates on. `default` is deliberately the fallback: a new
staff member gets the least-privileged view, never an accidental super admin.

### Enforcement, in three places

**API** — `requireAdmin` gains a companion, `requireRole(request, section)`.
Each admin route declares the section it belongs to. A `distributor`-role
caller hitting `/api/admin/console` gets 403, not data. This is the real
boundary; the other two are UX.

**Routing** — `/admin` redirects to the role's landing page: super → `/admin/console`,
distributor → `/distributors/internal`, invoices → `/admin/invoices`,
default → `/admin/clients`.

**Sidebar** — `AdminNav` renders only the sections the role can reach, so
nobody is shown a door that will refuse them.

### Sections

```
console     super
analytics   super
clients     super, default
families    super, default
distributor super, distributor
invoices    super, invoices
queries     super, default
```

Two deliberate calls: `distributor` does **not** get `clients`, because
Krutika manages distributors and *their* clients, which the distributor view
already scopes; and `invoices` gets nothing else, because finance reviewing
invoices has no need of investor records.

### New surfaces

`/admin/analytics` — the consolidated dashboard for super admins. Charts over
the existing seven APIs: retention curve, login and platform split, onboarding
gap, activation trend. Built to the console's visual language.

`/admin/invoices` — read-only list from `distributor_invoice_issued`: number,
distributor, period, amounts, date. Filter by distributor and period. No issue
or edit controls; finance reviews, the distributor flow issues.

### What stays untouched

The fees module, per the standing constraint. `/admin/onboarding` remains as
the legacy analytics page. The distributor-facing invoice pages under
`(protected)` are not modified — the new view reads the same table
independently.

## Security

| Risk | Mitigation |
|---|---|
| Distributor manager reads investor analytics | `requireRole` returns 403 server-side, before any query runs |
| Finance reads client PII | `invoices` role reaches only the invoice table |
| Unmapped staff silently gain access | Fallback is `default`, the least-privileged role |
| Role spoofed from the client | Role derives from the httpOnly session email; never from a header, body or query parameter |
| Someone removed from the allowlist keeps access | Allowlist is checked at login; `requireAdmin` still validates the session against Redis on every request |

## UI

The distributor dashboard adopts the console's visual language exactly — same
rail, same nav component, same full-bleed grid, same KPI and panel treatment.
Only the *contents* of the sidebar differ by role. Existing myQode tokens
throughout; figures in Lato, Playfair reserved for the wordmark.

## Out of scope

Per-role audit reporting, and any change to who may *issue* an invoice.
