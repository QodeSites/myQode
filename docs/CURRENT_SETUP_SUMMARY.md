# myQode — Current Setup Summary (as of July 2026)

myQode is the investor portal for Qode (SEBI-registered PMS, India). One Next.js codebase serves
three things: the client web portal, the backend API for the mobile app, and admin/distributor tools.

## 1. Tech Stack

| Layer | What's used |
|---|---|
| Framework | Next.js 15 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (Radix primitives), tw-animate-css |
| Charts / motion | Recharts, Framer Motion, Mermaid |
| Data | PostgreSQL via `pg` — three connections (`lib/db.ts`, `db1.ts`, `db2.ts`) |
| Sessions / cache | Redis (ioredis) session store (`lib/session-store.ts`) |
| Auth | Custom email+password (bcrypt, JWT), OTP setup flows, Microsoft OAuth for admin, separate mobile JWT auth (`lib/mobileAuth.ts`) |
| Payments | Cashfree PG (orders, webhooks, SIP lifecycle) |
| Files | AWS S3 + presigned URLs (document vault) |
| Notifications | Firebase (push + analytics), `lib/notifications.ts`, push-token registration |
| Email | Nodemailer + Microsoft Graph (`lib/email.ts`, `lib/graphEmail.ts`) |
| Mobile | Capacitor (Android folder present), PWA via next-pwa; mobile app consumes `/api/mobile/*` |
| Analytics | Firebase Analytics provider, Vercel Analytics, admin analytics dashboards (Play Store / App Store / Firebase) |

## 2. Brand System

- Colors: cream background `#FCF9EB`, deep green `#02422B`, dark-green text `#002017`,
  beige `#EFECD3`, gold `#DABD38`; full dark-mode variable set exists in `styles/globals.css`.
- Fonts: Playfair Display (headings), Lato (body).
- Strategy identities (`lib/strategyConfig.ts`, from account-code prefix):
  - **QAW** Qode All Weather — benchmark NIFTY 50 — `#008455`
  - **QTF** Qode Tactical Fund — benchmark NIFTY MIDCAP 150 — `#550E0E`
  - **QGF** Qode Growth Fund — benchmark NIFTY SMLCAP 250 — `#0A3452`
  - (CSS also defines a QFH gold `#DABD38` token.)

## 3. Client Portal Pages (`app/(protected)/`)

- **Dashboard** — currently static marketing text ("Who We Are / What We Do / How We Work / Why It
  Matters") behind a timed 1.8s fullscreen loader. No live data. (Redesign target.)
- **Portfolio** — Performance (the real workhorse: ~3,000-line page with NAV/growth chart vs
  benchmark, trailing returns with CAGR/absolute logic, drawdown, cash flows, invested/current
  value/XIRR, Nuvama + Orbis custodian data merging, CSV export), Snapshot, Expiry-Day FAQ (new).
- **About Qode** — Philosophy, Foundation, Strategy Snapshot, Your Team at Qode.
- **Your Qode Experience** — Investor Portal Guide, Account Services, Account Mapping (family),
  Service Cadence, Portfolio Snapshot.
- **Engagement & Growth** — Insights & Events, Referral Program, Your Voice Matters (feedback).
- **Trust & Security** — Risk Management & Controls, Client Document Vault, Escalation &
  Grievance Redressal, FAQs & Glossary.
- **Payment result pages** — payment success, SIP success.

## 4. Other Areas

- **Public pages** — Login, reset/setup password (with OTP verification), Contact Us, Privacy
  Policy, Terms & Conditions, Cancellation policy.
- **Distributor portal** — Clients list, Fees & Distribution (+ demo versions), distributor
  header/sidebar components, fee calculator API.
- **Admin console** — Microsoft OAuth login, client onboarding tracker, queries inbox, client
  impersonation, bulk setup-email sender, Mailchimp status, mobile/app-store analytics.
- **External Distributor API** — versioned `/api/distributor-api/v1/*` (investors, portfolio,
  history, transactions, documents) for third-party integration.

## 5. Feature Systems

- **Multi-account / family** — `ClientContext` drives everything: accounts grouped by family,
  Head-of-Family role (crown), relations, Active/Closed status, account switcher in header +
  sidebar, group-level aggregation.
- **Portfolio data pipeline** — portfolio-history by client/code, combined (multi-account) NAV,
  cashflow, drawdown, monthly P&L, quarterly P&L endpoints; benchmark data (BSE500 hook).
- **Payments & SIP** — Cashfree order creation/verification, webhook, SIP setup / pause / resume /
  cancel / verify, investment-status cron, SIP management modal.
- **Account services** — withdrawal requests, bank-details update, account requests, strategy
  inquiry, discussions/tickets (`/api/ticket`).
- **Documents** — S3-backed vault with categories, list/download endpoints, in-app PDF dialog.
- **Engagement** — events, newsletters, perspectives (insights), referral program, portal guide,
  feedback + testimonial dialogs.
- **Expiry-day system** (new, uncommitted) — `lib/expiry-day.ts`, banner + popup components,
  `/api/expiry-check`, FAQ page.
- **Mobile API** — ~50 endpoints under `/api/mobile/*` mirroring the portal: auth, portfolio
  (single + combined), documents, payments, services, engagement, admin, app-version check.

## 6. Repo Extras

- `android/` (Capacitor), `.github/` (new), `database/`, `scripts/`, `postman/` + a Postman
  collection for the mobile API, `docs/`, `api_backup/`.
- ~15 root-level debugging/issue markdown files (NAV anomalies, closed-account handling, CSV
  download flow, trailing-returns logic) — working notes from past fixes.
- `STITCH_REDESIGN_PROMPT.md` — the redesign prompt pack for Google Stitch.

## 7. Notable Observations (relevant to the redesign)

1. The dashboard is the weakest screen: static content + artificial loader, while all the data an
   investor wants already exists one click away in Performance.
2. The performance page is a single ~3,000-line client component doing data fetching, custodian
   merging, metrics math, CSV export, and rendering — a prime candidate for splitting when the
   redesign is implemented.
3. Web portal and mobile API duplicate portfolio logic in places (`/api/portfolio-history*` vs
   `/api/mobile/portfolio/*`) — the mobile endpoints are the cleaner, more complete set.
4. Console.log debugging statements remain in production paths (sidebar, middleware).
5. Package.json carries unused framework deps (Svelte, Vue, Remix, SvelteKit) — likely v0
   scaffolding leftovers.
