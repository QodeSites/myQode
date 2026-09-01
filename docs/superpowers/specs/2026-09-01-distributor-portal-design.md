# Distributor Portal — Restructure

**Date:** 2026-09-01
**Status:** Approved design, pending implementation plan

## Summary

Split the single distributor dashboard into three focused pages, replace CRM
vocabulary with language a partner recognises, lead with charts rather than
paragraphs, add SOA report downloads, and let a partner open an investor's
account with the transactional pages blocked.

## Findings

Verified against live Zoho and the running app on 2026-09-01.

### 1. SOA reports exist and are downloadable

`Investors.SOA_Reports` is a **fileupload** field — it does not come back
through COQL, only through a record read. **102 of 418 investors** carry at
least one PDF, each with a `download_Url` and `is_Preview_Available: true`.

316 investors have none, so an absent SOA is the common case and must read as
normal, not as a failure.

### 2. Impersonation already has the hook this needs

`/api/admin/impersonate` sets `qode-admin-impersonation` with
`isImpersonating: true` and the target client. That cookie is what the
restriction gates on — no new mechanism is required.

### 3. The current labels are the confusion

The dashboard shows raw CRM stage names. "Funding" in particular describes the
firm's pipeline, not anything the investor did, and a partner reading it has to
guess. Every label needs to describe the investor's situation from the
partner's side.

### 4. There is enough data for charts

One Battalion's book alone spans Qode All Weather 29, Qode Growth Fund 29, Qode
Tactical Fund 26 — a real split worth drawing rather than listing.

## Language

The single most important part of this spec. Every label describes what
happened to the investor, in words a partner would use to a client.

| Zoho stage | Shown as | Why |
|---|---|---|
| `Account Live`, `Regular Investor` | **Invested** | Money is in the market |
| `First Fund Initiated` | **Account funded** | They have paid in; units pending |
| `Onboarding` | **Paperwork in progress** | Not yet funded |
| `Dormant Investor` | **Inactive** | Account exists, nothing moving |
| `Dropped before account opening` | **Did not proceed** | Never opened |
| `Dropped after account opening` | **Closed** | Opened, then exited |

Other renamings:

| Was | Now |
|---|---|
| Book value | **Total value today** |
| Investors referred | **Your investors** |
| In progress | **Not yet invested** |
| Reviews due | *(removed — internal concern, not the partner's)* |
| Referrals & Journey | **Refer an investor** |

Rules: no CRM field names, no internal process words, and every figure carries
its unit or "as of" date.

## Architecture

### Three pages

```
/distributors             Overview — charts and headline figures, no lists
/distributors/investors   The list — search, filter, SOA, open account
/distributors/referrals   Referral links and help
```

Each answers one question, so no page scrolls far. The nav gains one entry;
Overview links through to the other two.

### Overview

- **Total value today**, with gain against amount invested, and the "as of"
  date.
- **Where your investors are** — a horizontal stacked bar across the six
  plain-language groups, each segment labelled with its count. Replaces the
  four-card grid.
- **Strategy split** — a bar per strategy (QAW/QGF/QTF identity colours).
- **Recently invested** — up to three investors whose accounts went live in the
  last 30 days.

No investor list here. That is the second page's job.

### Investors

The searchable list, one card per investor: name, plain-language status,
strategies, value with gain, and two actions where available — **Download SOA**
and **Open account**. Paginated at 10 with an explicit control.

### Referrals

The two links with copy buttons, plus the partnerships contact.

### SOA downloads

`GET /api/distributor/investor-soa?email=…`

1. Resolve the distributor from the session (`resolveDistributorByEmail`).
2. Confirm that email is in **their** book — a partner may only fetch an SOA
   for an investor they referred. This check is the boundary, not the UI.
3. Read the investor record, take the newest `SOA_Reports` entry.
4. Stream the PDF back through the app so Zoho credentials never reach the
   browser.

Absent SOA returns 404 with a stated message; the button simply does not render
when the list already knows there is none.

### Opening an investor's account

Reuses `/api/admin/dashboard` — the same impersonation path the back office
uses, so there is one mechanism rather than two.

**Restriction, enforced in two places:**

1. **Server-side**, in `app/(protected)/layout.tsx`: when
   `qode-admin-impersonation` is present, requests for `/payment/**` and
   `/experience/account-services/**` render a stated message instead of the
   page. Typing the URL is refused, not merely unlinked.
2. **Sidebar**: both entries are hidden during impersonation.

The layout check is the control. Hiding a link is presentation — the same
reasoning applied to the forged-cookie case in the admin API.

A banner names whose account is open and offers a way back.

## Visual approach

Charts over prose. A stacked bar for status, bars for strategy, a value figure
with its change. Existing myQode tokens only; figures in Lato, Playfair for the
wordmark. Strategy colours `#008455` / `#0A3452` / `#550E0E`, neutral `#9CA3AF`.

Each chart states what it shows in one line beneath it, so nothing needs
decoding.

## Security

| Risk | Mitigation |
|---|---|
| Partner downloads another partner's investor SOA | Email checked against their own book before any Zoho read |
| Zoho credentials exposed | PDF streamed through the app; `download_Url` never sent to the browser |
| Transacting while impersonating | Route blocked in the protected layout, not just unlinked |
| Partner reaches investor data they did not refer | Every query scoped by the session-resolved distributor ID |

## Out of scope

Payout status stays a placeholder until the field exists. The fees module is
untouched. No changes to what a real investor sees when signed in themselves.
