# myQode Back Office — Client & Family Management

**Date:** 2026-08-27
**Status:** Approved design, pending implementation plan

## Summary

Replace the single 2,635-line `/admin/onboarding` page with a structured back
office under `/admin`, starting with the client and family manager: search
clients, inspect a family's accounts, set head of family, and edit a safe set
of master-data fields with a full audit trail.

Analytics (funnel, retention, store metrics) is a **second spec** that reuses
the shell and conventions established here. `/admin/onboarding` is left
untouched in this phase so nothing in use breaks.

## Findings that drove this design

Measured against production on 2026-08-27.

### 1. The current page is three tools wearing one name

`app/admin/onboarding/page.tsx` is 2,635 lines and calls 10 different APIs. It
is a dashboard, an analytics viewer, and a distributor manager, all filed under
"onboarding". There is no `app/admin/layout.tsx`, so nothing establishes
navigation or shared design conventions.

### 2. Half the admin API surface is invisible

20 routes exist under `app/api/admin/`. Ten are never called by any page:

```
error-log            login-analytics      onboarded-clients
onboarding-funnel    onboarding-status    portfolio/performance
queries              retention-trend      send-bulk-setup-emails
impersonate
```

The data layer is further along than the UI. The back office does not need new
data plumbing so much as somewhere to show what already exists.

### 3. 92% of families have no head of family

| Measure | Count |
|---|---|
| Family groups (`groupid` not null) | 246 |
| Multi-account families | 196 |
| **Multi-account families with no head** | **181** |
| Families with more than one head (conflict) | 0 |
| Clients with `head_of_family = NULL` | 277 |
| Clients with `head_of_family = true` | 17 |

Zero conflicts means the data is clean, merely unset. This is the concrete job
the back office has on day one, and it is countable — a good measure of whether
the tool is working.

Example: group `14410026` ("CHETAN DHARNIDHAR DOSHI FAMILY") holds four
accounts (QAW0006, QFH00053, QGF00051, QTF00054) for one person, all with
`head_of_family = NULL`.

### 4. The audit log exists but is dormant

`pms_clients_audit_log` has the right shape — `operation_type`, `old_data` and
`new_data` (both JSONB), `changed_fields` (array), `operation_timestamp`,
`batch_id`, `notes` — and holds 6,386 rows.

**But there are no triggers on `pms_clients_master`, and no application code
references the table.** Every row came from an external migration; the most
recent is 2026-01-08.

Audit writes therefore have to be written deliberately into the new mutation
path. Nothing happens automatically. This is the single most important
constraint in the spec: without it, the back office silently changes financial
records.

### 5. Admin identity is available for attribution

Admin login is Microsoft SSO (`app/api/auth/microsoft/callback`) against an
email allowlist, and the session stores `user.email` and `user.name`. Edits can
therefore be attributed to a named person, not just "an admin".

## Architecture

### Routes

```
app/admin/layout.tsx            — shell: sidebar, header, design conventions
app/admin/clients/page.tsx      — search, filter, list
app/admin/clients/[id]/page.tsx — one client: detail, family, edit, history
app/admin/families/page.tsx     — family explorer; missing heads surfaced first
```

`/admin/onboarding` is untouched in this phase.

### API

Each route validates the admin session against Redis with `getSession()`
**inside the handler**. `middleware.ts` only checks that the cookie exists — it
explicitly defers validation, so a forged cookie passes it. Middleware is UX;
the handler is the boundary.

```
GET   /api/admin/clients            — paged search (q, status, hasHead, page)
GET   /api/admin/clients/[id]       — detail + family members + audit history
PATCH /api/admin/clients/[id]       — audited edit, allowlisted fields only
POST  /api/admin/families/[groupid]/head — set head of family
```

### The write path

All mutations go through one module, `lib/adminClientMutations.ts`, so the
audit rule cannot be bypassed by a future caller:

1. Reject any field not on the allowlist.
2. Open a transaction; read the current row.
3. Apply the update.
4. Insert into `pms_clients_audit_log` with `old_data`, `new_data`,
   `changed_fields`, and `notes` naming the acting admin from their SSO session.
5. Commit — or roll back, so a failed audit write cannot leave an unlogged edit.

**Editable fields:**
`head_of_family`, `email`, `mobile`, `address1`, `address2`, `city`, `state`,
`pincode`, `onboarding_status`.

**Read-only, enforced server-side:**
`clientcode`, `clientid`, `pannumber`, `groupid`, and every other column.
These are join keys. `pms_clients_master.intermediaryname` matching a
distributor's `clientname` is a text join, and the Enso rename showed that
moving such a value silently orphans dependent rows.

### Setting head of family

A family-level invariant — exactly one head per `groupid` — so it gets its own
endpoint rather than being a generic field edit. In one transaction it clears
any existing head in the group, sets the new one, and writes one audit row per
affected client. The data currently has zero conflicts; this keeps it that way.

## UI

Follows the myQode design system: existing semantic tokens (`bg-card`,
`text-primary`, `text-muted-foreground`, `border-border/20`), Lato and Playfair
Display, no new colors, fonts, or gradients. Built from `components/ui/`
primitives. Works at 375px; wide tables scroll inside their own container.

**Attention-first, like the distributor management page.** The families screen
leads with the 181 groups missing a head — the work to do — rather than an
undifferentiated list. Counts are actionable: clicking one filters the table.

The client detail screen shows the person, not the row: their accounts across
QAW/QGF/QTF, combined AUM, onboarding and login state, and their family
alongside, with an unambiguous "Set as head of family" action. Edits happen
inline with an explicit save, and recent changes from the audit log are shown
beneath, so an admin can see what was changed, when, and by whom.

Empty and error states state what happened and what to do next. Loading uses
skeletons shaped like the final layout.

## Security

| Risk | Mitigation |
|---|---|
| Forged admin cookie | `getSession()` against Redis in every handler |
| Unlogged change to financial data | Audit insert in the same transaction as the update |
| Join key corrupted via the UI | Server-side allowlist; keys never writable |
| Two heads in one family | Single transaction clears then sets |
| Edit attributed to nobody | Admin email and name from the SSO session written to `notes` |

## Out of scope

Analytics, funnel, retention and store metrics — second spec, reusing this
shell. Distributor management already exists at `/distributors/internal`.
Impersonation (`/api/admin/impersonate`) is untouched.

## Open question

`pms_clients_master.password` exists as a column. This spec never reads,
writes, or displays it, but its presence is worth a separate look at how
investor credentials are stored.
