# Backoffice API (web `/admin` and the app's admin mode)

All routes live under `/api/admin/bo/*`, return JSON, and are guarded by `requireAdmin(req, level)` from
`lib/adminAuth.ts`. The admin is identified by the httpOnly `qode-admin` cookie (web, set by
`POST /api/admin/auth/login`), by `Authorization: Bearer <app admin JWT>` (app, issued by
`/api/mobile/auth/login` for `APP_ADMIN_EMAILS`), or by the Microsoft `admin-session` (staff only).
Level is `super` unless marked *(staff)*. Every mutating or impersonating call writes `admin_audit_log`
through `audit(req, admin, action, target, details)`.

Errors: `{ error: string, code?: string }` with 400 / 401 (`ADMIN_AUTH`) / 403 (`ADMIN_FORBIDDEN`) / 404 / 500.

## Auth
- `POST /api/admin/auth/login` `{ email, password }` → `{ admin: { email, name, level } }` + cookie. 401 `{ error }`.
- `GET /api/admin/auth/me` → `{ admin: { email, name, level, via } }` or 401.
- `POST /api/admin/auth/logout` → clears the cookie.

## Overview *(staff)*
`GET /api/admin/bo/overview` →
```
{ users: { investors, distributors, passwordSet, needsSetup, neverLoggedIn, locked },
  logins: { today, last7, last30, web30, app30, ios30, android30 },
  daily: [{ date: 'YYYY-MM-DD', web, app }],            // last 30 days, from login_events
  appVersions: [{ version, users }],                     // pms_mobile_analytics, last 30 days
  topScreens: [{ name, views }],                         // last 30 days
  errors7: number, recentErrors: [{ name, message, count, lastAt }],
  recentLogins: [{ email, name, platform, os, at }],     // latest 20
  openQueries: number }
```

## Users (investors and distributors) *(staff for reads)*
A "user" is one login email. Investors can have several `pms_clients_master` rows (one per account) sharing
an email; distributors are rows with `clientcode IS NULL`.

`GET /api/admin/bo/users?q=&type=all|investor|distributor&status=all|needs-setup|locked|never&page=1&limit=50` →
```
{ items: [{ email, name, type: 'investor'|'distributor', clientCodes: string[], groupId, headOfFamily,
            passwordSet: boolean, needsSetup: boolean, locked: boolean,
            lastLoginAt, lastWebLoginAt, lastAppLoginAt, loginCount, webLogins, appLogins,
            intermediary, clientCount /* distributors: investors under them */ }],
  total, page, limit }
```
`q` matches name, email or client code (case-insensitive).

`GET /api/admin/bo/users/detail?email=` →
```
{ user: <same shape as a list item>,
  accounts: [{ clientId, clientCode, name, strategy, status, headOfFamily, groupId, ownerId, maturityDate }],
  logins: [{ at, platform: 'web'|'app', os }],             // latest 50 login_events
  app: { lastVersion, platform, lastSeenAt } | null,      // from pms_mobile_analytics by user_id/email
  investors: [{ email, name, clientCodes }] | undefined,  // distributors: their investors
  audit: [{ at, admin, action, details }] }               // backoffice actions on this user
```

`POST /api/admin/bo/users/password` `{ email, password }` → sets the bcrypt password (cost 12) on every row
with that email, `password_set_at = now()`, clears setup token, `login_attempts`, `locked_until`.
Password rules: 8+ chars, a letter and a digit. Audit `user.set_password` (never log the password).

`POST /api/admin/bo/users/reset-link` `{ email }` → emails the standard reset link (same token table and
email as `/api/auth/forgot`). Audit `user.reset_link`.

`POST /api/admin/bo/users/unlock` `{ email }` → `login_attempts = 0, locked_until = NULL`. Audit `user.unlock`.

## Impersonation
`POST /api/admin/bo/impersonate` `{ email, target: 'portal' | 'app' }`
- `portal` → `{ redirectUrl }`: a one-time link `/api/admin/impersonate?token=<JWT, 2 min, kind 'imp'>` that
  sets the portal cookies (including the signed `qode-session`) and opens `/portfolio/performance` for an
  investor or `/distributor/fees-distribution` for a distributor.
- `app` → `{ token, expiresIn, user }`: a 4 h mobile JWT exactly like a normal login for that user (investor:
  accountCodes / ownerIds / groupId; distributor: `isDistributor`, `distributorName`) plus
  `isImpersonated: true, impersonatedBy: <admin email>`. The web app (`/app`, same origin) is opened by storing
  it in `localStorage['myqode.token']`; the phone app uses it in memory and keeps the admin token to return.
Audit `user.impersonate` with `{ target }`.

## Distributors
`POST /api/admin/bo/distributors` `{ name, email, password, salutation?, firstName?, lastName?, feePercentage? }`
→ creates the distributor row (`clientcode NULL`, `clienttype 'DISTRIBUTORS'`) with the given password hashed.
409 if the email exists. Audit `distributor.create`.
`DELETE /api/admin/bo/distributors?email=` → deletes the distributor row (only a `clientcode IS NULL` row).
Audit `distributor.delete`.

## Audit and admins
`GET /api/admin/bo/audit?limit=100&admin=&action=&target=` → `{ items: [{ id, at, admin, action, target, details, ip }] }`.
`GET /api/admin/bo/admins` → `{ items: [{ email, name, passwordSet, lastLoginAt, app: boolean }] }` (the
`BACKOFFICE_ADMINS` list joined with `admin_users`).
`POST /api/admin/bo/admins/password` `{ email, password }` → sets a backoffice admin's password (email must be in
`BACKOFFICE_ADMINS`). Audit `admin.set_password`.
