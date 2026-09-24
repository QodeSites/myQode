# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`myQode` is a single Next.js 15 (App Router) application that serves **four different audiences** from one codebase:

1. Public marketing pages (`app/(open)/`)
2. The authenticated web portfolio app for investors (`app/(protected)/`)
3. An internal admin panel (`app/admin/`)
4. A JSON API layer at `app/api/mobile/*` consumed by a **separate React Native/Expo mobile app** (not in this repo), plus a bespoke partner API at `app/api/distributor-api/v1/*` for one external distributor ("One Battalion Ventures", see `docs/distributor-api-one-battalion.md`)

The `capacitor.config.ts` in this repo wraps the *deployed website* in a native WebView shell (`server.url: 'https://myqode.qodeinvest.com'`) — it is not where native mobile UI work happens. The real native app lives in a sibling Expo project (referenced elsewhere as `myqode-mobile`) that talks to this repo's `/api/mobile/*` endpoints.

## Commands

```
npm run dev             # dev server on port 2069 (not 3000)
npm run build            # next build
npm run start             # prod server on port 3010
npm run start:network     # prod server bound to 0.0.0.0:3010
npm run lint               # next lint
npx tsc --noEmit             # typecheck — NOT run automatically, see below
```

**Important:** `next.config.mjs` sets `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true` — `npm run build` will succeed even with lint/type errors. Manually run `npx tsc --noEmit` and `npm run lint` after making changes; the build will not catch regressions for you.

No test runner is configured in this repo.

## Database layer

Raw SQL via `pg` (node-postgres) — no ORM, no query builder. Three separate connection pool singletons, all pointing at the same Postgres host but **different databases**, each capped at 3 connections:

- `lib/db.ts` → `PG_DATABASE`
- `lib/db1.ts` → `PG_DATABASE1`
- `lib/db2.ts` → `PG_DATABASE2`

Each uses a `global._pgPool*` guard to survive Next.js dev hot-reload. When adding a new query, check which of the three pools/databases holds the table you need — using the wrong one is a common mistake.

Migrations live in `database/migrations/` as hand-numbered, idempotent (`CREATE IF NOT EXISTS`) SQL files (`001_...` through `004_...`). There is no migration runner — apply them manually via `psql`. `database/schema/` and root-level `database/*.sql` hold standalone table definitions.

## Auth model (three separate schemes)

- **Web app**: cookie-based, via `lib/auth.ts` (`qode-auth` / `qode-clients` cookies). `contexts/ClientContext.tsx` tracks which linked account/family member is currently selected.
- **Admin panel**: `admin-session` cookie, gated in `middleware.ts` for any `/admin/*` route except `/admin/login`. Middleware only checks cookie *presence* — real session validation happens in the API/page layer, not middleware.
- **Mobile API** (`/api/mobile/*`): Bearer JWT, verified in `lib/mobileAuth.ts`. Tokens carry an `accountCodes` claim that scopes access to one of three portfolio levels: Family Combined → Owner → Individual Strategy (see `docs/mobile-prompts/portfolio-scope-levels.md`). A superadmin user (`karan@qodeinvest.com`, `isSuperAdmin` claim) can mint short-lived (4h) impersonation tokens for another client via `POST /api/mobile/admin/impersonate` — see `docs/mobile-prompts/admin-master-view.md`.

`middleware.ts` also handles CORS preflight (`OPTIONS`) for all `/api/*`, allow-listing origins from `ALLOWED_ORIGINS` env var. Note `next.config.mjs`'s `headers()` *also* sets `Access-Control-Allow-Origin: *` on `/api/:path*` — these two CORS mechanisms overlap; be aware of both if debugging CORS issues.

## API surface map (`app/api/`)

- `mobile/` — the dedicated mobile-app backend: admin, app-version, auth, dev, documents, engagement, experience, payments, portfolio, services. **This is the API the RN app is built against** — `docs/mobile-prompts/complete-api-reference.md` is the authoritative reference (base URL `https://myqode.qodeinvest.com`, login at `POST /api/mobile/auth/login`, JWT TTL 30 days).
- `auth/` — web/admin auth flows: login, OTP setup, password setup/reset, Microsoft OAuth, Zoho.
- `admin/` — admin panel data endpoints (analytics, onboarding funnel, queries, impersonate, etc.)
- `distributor/` — web distributor-portal APIs (clients, invoices, fee calculator, documents, etc.)
- `distributor-api/v1/` — external partner API (One Battalion), API-key auth, strictly scoped by `intermediaryname`.
- `cashfree/` — payment gateway / SIP management (create-order, setup-sip, webhook).
- Misc flat routes at the top of `api/` — bank details, SIP pause/resume, transactions, portfolio history, indices, etc.

Two Postman collections exist for the mobile API surface: `postman/myqode-mobile-api.postman_collection.json` and root `qode-mobile-api.postman_collection.json` — these are similar but not identical; check both before assuming one is canonical.

## `docs/`

- `docs/mobile-prompts/` — API-contract docs written for the mobile app team: `complete-api-reference.md`, `admin-master-view.md`, `portfolio-scope-levels.md`, `snapshot-home-screen.md`. Read these first for any mobile-API work.
- `docs/distributor-api-one-battalion.md` — the external partner API spec.

## `lib/` (selected)

- `mobileAuth.ts` — JWT verify + `requireSuperAdmin` guard for `/api/mobile/*`
- `session-store.ts` — Redis (ioredis) session storage, 24h TTL
- `s3.ts` — S3-compatible client (E2E Networks object store, path-style addressing)
- `feeEngine.ts`, `invoiceTax.ts` — fee/invoice calculation
- `notifications.ts` — push/notification logic
- `zoho*.ts` (5 files) — Zoho CRM sync for investor/distributor data — the largest integration surface in the repo
- `graphEmail.ts` vs `email.ts` — two distinct email paths (Microsoft Graph API vs internal `/api/send-email`)
- `primaryUcc.ts` / `hooks/usePrimaryUcc.ts` — "primary UCC" (unique client code) resolution, used to determine the head-of-family account

Note: `lib/reviewerMock 2.ts` (space in filename) is a stray duplicate of `lib/reviewerMock.ts` (App Store/Play Store reviewer mock data) — don't edit the wrong copy.

## UI stack

shadcn/ui (`components.json`: style `new-york`, baseColor `neutral`, icons via `lucide`), Tailwind CSS v4, Radix primitives. Path alias `@/*` maps to repo root (`tsconfig.json`). PWA support via `next-pwa` in `next.config.mjs` (service worker excludes `/api/*` from caching; explicitly excludes Next's internal manifests from precache as a workaround for next-pwa + App Router middleware conflicts).

## Required environment variables

No `.env.example` exists in the repo — inferred from code:

- Postgres: `PG_USER`, `PG_HOST`, `PG_DATABASE`, `PG_DATABASE1`, `PG_DATABASE2`, `PG_PASSWORD`, `PG_PORT`
- Redis: `REDIS_URL`
- Auth: `JWT_SECRET` (mobile API), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- Microsoft OAuth/Graph: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
- AWS/S3 (E2E Networks): `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- CORS: `ALLOWED_ORIGINS`
- Partner API: `ONE_BATTALION_API_KEY`
- Zoho CRM, Cashfree, and Firebase credentials are also required (see `lib/zoho*.ts`, `lib/firebase-client.ts`, `cashfree-pg` usage) but exact variable names aren't centralized anywhere — grep the relevant `lib/` file if you need one.
