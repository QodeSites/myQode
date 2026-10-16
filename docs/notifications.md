# myQode notifications

How myQode tells clients that something happened: the in-app inbox (the bell, web and phone) and phone pop-ups. No email ever goes out through this system.

## In one picture

```
 data changes                scanners (every few min)          inbox row             pop-up
 ─────────────               ───────────────────────          ─────────             ──────
 payment / SIP / Nuvama ──►  money scan       ──┐
 NAV sheet             ──►  portfolio scan    ──┤
 new newsletter (S3)   ──►  reading scan      ──┼──► notifyEmails() ──► app_notifications ──► worker ──► Expo ──► Apple / Google ──► phone
 Zoho Desk ticket      ──►  tickets scan      ──┤        (dedupe key)      (the bell reads it)   (deliverDue)
 admin panel send      ──────────────────────── ┘
```

## The tables (database `qode_portfolios`, migration `database/migrations/006_app_notifications.sql`)

| Table | Holds |
|---|---|
| `app_notifications` | **The inbox.** One row per notification per login: category, title, body, link, read time, pop-up status. |
| `app_push_devices` | Phones that may receive pop-ups: Expo push token, platform, app version, active or retired. |
| `app_notification_prefs` | Each login's switches from Notification settings (portfolio, reading, updates on/off; money cannot be turned off). |
| `app_notification_state` | The system's notepad: each scanner's "last seen" bookmark, each ticket's last known status (`ticket.status.<id>`), and the worker lease. |
| `app_notification_campaigns` | Messages the team sends by hand from the admin panel. |

## Writing a notification — `notifyEmails()` (`lib/appNotify.ts`)

Every notification, from any source, goes through this one function.

1. **The inbox row is written first.** The inbox is the source of truth: whatever happens to the pop-up, the client sees the notification under the bell.
2. **Dedupe key.** Each row has one (e.g. `ticket:<id>:Closed:<modifiedTime>`); `(email, dedupe_key)` is unique, so a scanner that runs twice, or two servers racing, never notify anyone twice.
3. **Pop-up or inbox only.** The row is `pending` (send a pop-up) only while `PUSH_LIVE=1`, or for logins in `PUSH_TEST_EMAILS`, or when an admin forces a test send. Otherwise it is `held`: inbox only, never pushed later.

Categories: `money`, `portfolio`, `reading`, `updates` (shown in Notification settings as Money, Portfolio, Reading, Announcements).

## Deciding what to write — the scanners (`lib/appNotifyTriggers.ts`)

A scanner looks at data as it stands, notices what is new since its bookmark, and calls `notifyEmails()`. On its first run it only sets the bookmark, so old data never floods clients.

| Scanner | Runs every | Writes, for example |
|---|---|---|
| money | 5 min | "We've received your ₹10 lakh", SIP instalments, failed payments, Nuvama bookings |
| portfolio | 30 min, 09:30–20:00 IST | monthly update, new high, ₹25 L … ₹25 Cr milestones, anniversary |
| reading | 30 min | a new newsletter or perspective |
| tickets | 5 min | "Request #557: Closed" — see below |
| zoho (sync) | 5 min | pulls Zoho capital inflows in first, so the money scan can announce them in the same pass |

**Team copies.** Money notifications for Zoho inflows and transfers are also copied to every login in `APP_ADMIN_EMAILS`, with the client's name and account in front ("Pallavi Kalyani (QGF00050) · We've received your ₹10 lakh"), so the team sees exactly what the client saw (`lib/capitalInflows.ts`, `copyToAdmins`).

## Running the scanners and sending pop-ups — the worker (`lib/appNotifyWorker.ts`)

A loop inside the backend server, started from `instrumentation.ts`, that wakes every **15 seconds**:

1. **Lease.** Production and dev share the database, so only one server may run the worker. It claims the `worker.lease` row in `app_notification_state`; a lease not renewed for 60 s can be taken over. The other servers stand by.
2. **Scanners** that are due (table above).
3. **`deliverDue()`** — sends `pending` rows through Expo's push service to every active device of the login:
   - skips categories the login switched off (money is always sent);
   - no pop-ups 21:00–09:00 IST except money;
   - a pop-up older than 3 days is not sent (it stays in the inbox);
   - network errors, Expo 5xx / 429 retry with back-off, 8 attempts over about a day;
   - rows claimed by a process that died mid-send go back to pending after 10 minutes.
4. **`checkReceipts()`** every 5 minutes — asks Expo whether Apple / Google accepted each message; dead devices (`DeviceNotRegistered`) are retired, transient errors are re-sent.

Where it runs: the worker starts on the **production** server, or on any server with `NOTIFY_WORKER=1`. A dev server does not run it. `GET /api/cron/notifications` runs one forced pass for an external scheduler.

## The app side (myqode-native)

- **The bell** (web and phone) loads `GET /api/mobile/notifications` when the client signs in, opens the bell, or brings the phone app back to the front. Opening an item marks it read (`/notifications/read`) and follows its link (`page:requests`, `tab:portfolio`, …).
- **Phone pop-ups** (`src/push.js`): asks permission, registers the Expo token on every start and whenever it changes, and unregisters it on sign-out **before** the session ends, so the next person on that phone gets nothing meant for the previous one. A pop-up arriving while the app is open refreshes the bell. Expo Go has no remote push; development, TestFlight and store builds do.
- **Web** has no pop-ups; the bell is the whole feature there.
- **Notification settings** saves the switches (`/notifications/prefs` → `app_notification_prefs`), which `deliverDue()` honours.

## Ticket status notifications (added 16 Oct 2026)

When a client's request — a Zoho Desk ticket raised from Account Services / Support — changes status in Desk, the login that raised it is told.

1. **Raised.** `raiseDeskTicket()` (`lib/zohoDesk.ts`) records the new ticket's status at once (`ticket.status.<id>` = `Open|Open`), so even a ticket closed within minutes is announced.
2. **Scanned.** Every 5 minutes `scanTickets()` takes our tickets of the last 90 days (`pms_clients_tracker.qode_microsite_inquiries`, `data.desk_ticket_id`) and reads each **by id** from Desk. (Desk's ticket *list* only shows tickets the token's own agent can see, so it cannot be used.) Reads go through the Desk queue — at most 3 calls at a time, a client raising a ticket goes first — and a 20-second cache.
3. **Compared.** If the status differs from the one last seen, it writes `Request #<number>: <status>` / `<request type>: the status changed from <old> to <new>.`, category `updates`, link `page:requests`, to the `user_email` on the request. Tickets last seen Closed are not read again; tickets deleted in Desk (trashed or 404) are never announced.
4. Delivery is the normal path above (inbox at once, pop-up by the worker's rules).

**Testing on a dev server** (the worker does not run there): raise a ticket from the dev app, change its status in Desk, then open `GET /api/dev/scan-tickets`. It runs the ticket scan once and answers `{ ok, notificationsWritten }`. The route returns 404 on production. Dev and production share the database, so a notification written this way also appears in that login's inbox on production.

## Environment

| Variable | Effect |
|---|---|
| `PUSH_LIVE=1` | Pop-ups go to every client. Without it, only to `PUSH_TEST_EMAILS`; everyone still gets the inbox entry. |
| `PUSH_TEST_EMAILS` | Comma-separated logins that get pop-ups before launch. |
| `APP_ADMIN_EMAILS` | Logins that get the team copies of money notifications. |
| `NOTIFY_WORKER` | `1` starts the worker on a non-production server; `0` stops it on production. |
| `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_SECRET`, `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_ORG_ID` | Needed by the ticket scan (and by the request form and Past Requests). Without them the ticket scan does nothing. |

## Where to look

| File | What |
|---|---|
| `lib/appNotify.ts` | `notifyEmails`, `deliverDue`, `checkReceipts`, devices, recipients |
| `lib/appNotifyTriggers.ts` | the scanners (money, portfolio, reading, tickets) |
| `lib/appNotifyWorker.ts` | the 15-second loop, lease and schedule |
| `lib/zohoDesk.ts` | Desk calls, the 3-at-a-time queue, ticket status reads |
| `app/api/mobile/notifications/*` | inbox, read, prefs for the app |
| `app/api/dev/scan-tickets` | dev-only manual ticket scan |
| myqode-native `src/push.js`, `src/main.js` (`loadNotifs`) | phone pop-ups and the bell |
