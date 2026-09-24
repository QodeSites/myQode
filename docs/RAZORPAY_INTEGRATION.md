# Razorpay Integration — Setup & Operations

Web payments run on **Razorpay**. The Capacitor mobile app and any legacy
in-flight orders remain on **Cashfree**; both gateways run side by side and are
distinguished by `payment_transactions.gateway`.

---

## 1. Environment variables

Add to `.env`:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=<the secret you type into the Razorpay dashboard>
RAZORPAY_ENVIRONMENT=test          # 'production' for live keys
# Optional — only if Razorpay raises your per-transaction ceiling:
# RAZORPAY_MAX_AMOUNT_INR=1000000
```

There is **no `NEXT_PUBLIC_RAZORPAY_KEY_ID`**. The key id is returned by
`/api/razorpay/create-order` in its response, so test and production keys cannot
drift out of sync with the server.

`getRazorpayConfig()` refuses to start if `RAZORPAY_ENVIRONMENT=production` is
paired with an `rzp_test_*` key — that combination would silently accept
payments that never settle.

---

## 2. Database migration

```bash
psql "$DATABASE_URL" -f database/migrations/002_razorpay_migration.sql
```

Idempotent and additive-only. Applied to production on 2026-07-29; all 70
pre-existing rows were labelled `gateway='cashfree'` by the column default.

It adds:

| Object | Purpose |
|---|---|
| `payment_transactions.gateway` | `cashfree` \| `razorpay` discriminator |
| `payment_transactions.razorpay_*` | order / payment / subscription ids + signature |
| `payment_transactions.payer_*` | mandate payer-verification audit trail |
| `webhook_events` | idempotency ledger, unique on `(gateway, event_id)` |
| `razorpay_plans` | plan cache — Razorpay plans are immutable, one per (amount, period, interval) |
| `cashfree_pending_transactions` / `razorpay_pending_transactions` | views scoping each cron to its own gateway |

---

## 3. Webhook configuration

In the Razorpay dashboard → **Settings → Webhooks → Add New Webhook**:

- **URL**: `https://<your-domain>/api/razorpay/webhook`
- **Secret**: must match `RAZORPAY_WEBHOOK_SECRET` exactly, or every signature
  check fails.
- **Events**: `payment.captured`, `payment.failed`, `payment.authorized`,
  `order.paid`, `refund.created`, `refund.processed`, `subscription.authenticated`,
  `subscription.activated`, `subscription.charged`, `subscription.pending`,
  `subscription.halted`, `subscription.paused`, `subscription.resumed`,
  `subscription.cancelled`, `subscription.completed`

Localhost will not receive webhooks — use the same public tunnel as
`PUBLIC_BASE_URL`.

---

## 4. Cron jobs

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron/razorpay-reconcile` | every 30 min | Recovers payments whose webhook never arrived; expires genuinely stale orders; reports mandates held for verification |
| `/api/cron/investment-status` | existing | Cashfree settlement → SETTLED → DEPLOYED (now scoped to `gateway='cashfree'`) |

Both are protected by `CRON_SECRET` via the `x-cron-secret` header or a `?secret=` query param.

---

## 5. ⚠️ TPV is disabled — what that means

Cashfree's SIP flow used **TPV** (Third Party Validation): the client's
registered bank account was sent to the gateway, which then *refused* any mandate
authorised from a different account. **TPV is not enabled on this Razorpay
account**, so Razorpay will authorise a mandate from any account the customer
controls. SEBI expects PMS funds to originate from the client's registered
account.

The compensating control lives in `lib/razorpay-payer-check.ts` and runs in
`/api/razorpay/subscriptions/verify-payer` after authorisation:

| Verdict | Meaning | SIP activated? |
|---|---|---|
| `MATCHED` | Payer account == registered account | **Yes** |
| `MISMATCH` | Verified third-party account | No — blocked, ops notified |
| `UNVERIFIABLE` | Gateway returned no account number to compare | No — held for review |
| `OVERRIDDEN` | Ops manually cleared it | Yes |

**This is a detective control, not a preventive one.** It cannot stop the
authorisation happening; it only stops us acting on a bad one. It therefore
**fails closed** — `canActivate` is true only for `MATCHED`.

`UNVERIFIABLE` is the common case for **UPI Autopay**, which returns a VPA
(`user@bank`) rather than an account number. Treating that as "probably fine"
would reduce the control to a no-op for the most popular mandate method in
India, so those mandates require a human. Expect a steady trickle in the ops
queue:

```sql
SELECT razorpay_subscription_id, nuvama_code, payer_verification_status,
       payer_account_last4, payer_verification_note, updated_at
  FROM payment_transactions
 WHERE gateway = 'razorpay'
   AND payer_verification_status IN ('PENDING','MISMATCH','UNVERIFIABLE')
   AND investment_status NOT IN ('SIP_CANCELLED','SIP_COMPLETED','EXPIRED');
```

To clear one after manual verification:

```sql
UPDATE payment_transactions
   SET payer_verification_status = 'OVERRIDDEN',
       payer_override_by = '<your-email>',
       payer_override_at = NOW(),
       investment_status = 'SIP_ACTIVE'
 WHERE razorpay_subscription_id = '<sub_xxx>';
```

**Getting TPV enabled removes this entire burden.** It is usually a
business-category review and is normally granted for a SEBI-registered PMS —
worth pursuing with your account manager.

---

## 6. Transaction limits

Verified empirically against the test account on 2026-07-29:

- ₹5,00,000 — accepted
- ₹10,00,000 — rejected (`Amount exceeds maximum amount allowed`)

`MAX_AMOUNT_PAISE` is therefore ₹5,00,000, so an oversized amount is refused
with a clear message *before* checkout opens rather than failing opaquely at the
gateway. Override with `RAZORPAY_MAX_AMOUNT_INR` if Razorpay raises your ceiling.

Individual payment methods are lower still (UPI is typically ₹1,00,000 per
transaction). Those are enforced by the bank at payment time and cannot be
pre-checked.

---

## 7. Money handling

Razorpay works exclusively in **integer paise**; the DB stores `NUMERIC(10,2)`
rupees. All conversion goes through `toPaise()` / `toRupees()` in
`lib/razorpay.ts`, which use string/integer arithmetic only — never
`Math.round(x * 100)` on a float. `toPaise` **rejects** sub-paisa precision
rather than rounding, because rounding would silently change what the user
agreed to pay. Razorpay's API independently rejects float amounts, confirming
the design.

---

## 8. Trust model

Three checks must all pass before a payment is marked successful:

1. **HMAC signature** — proves Razorpay issued this payment for this order.
2. **Live API fetch** — proves the payment is captured *right now* (defeats
   replaying a signature from a payment later refunded).
3. **Amount match** — proves the captured amount equals the ordered amount.

Skipping (3) is the classic exploit: pay a ₹100 order, then replay that valid
signature against a ₹5,00,000 order.

Other invariants:

- **The webhook is the source of truth**, not the browser callback. The user may
  never return from checkout.
- **The browser never decides a payment failed.** A dismissed modal or a dead
  network is reported as *"confirming"*, never *"failed"* — the bank may already
  have debited them.
- **Terminal statuses are never downgraded.** Razorpay does not guarantee event
  ordering; `payment.captured` can arrive after `payment.failed`.
- **Identity comes from the session, not the request body.** The old Cashfree
  route accepted `client_id` from the browser, so a logged-in user could fund
  another account by editing the payload. Every Razorpay route re-derives
  identity from the session cookie and checks account ownership.

---

## 9. Testing

Razorpay test cards / instruments:

| Method | Value |
|---|---|
| Card (success) | `4111 1111 1111 1111`, any future expiry, any CVV |
| Card (failure) | `4000 0000 0000 0002` |
| UPI (success) | `success@razorpay` |
| UPI (failure)  | `failure@razorpay` |
| Netbanking | Pick any bank, then click Success/Failure on the simulator |

Unit suites (no network, no DB) — 63 assertions covering paise precision,
signature forgery, and the fail-closed payer invariant. They are transpile-and-run
scripts rather than a test-runner suite, since the repo has no test framework
configured.

Scenarios worth exercising manually before going live:

- [ ] Pay successfully → success page shows confirmed
- [ ] Close the modal mid-payment → "cancelled, no amount debited"
- [ ] Fail a card → clear failure message, order stays retryable
- [ ] Kill the network right after debit → "confirming", then reconciled by webhook
- [ ] Deliver the same webhook twice → second is a no-op (`webhook_events`)
- [ ] Tamper with the amount in devtools → rejected server-side
- [ ] Set up a SIP with a matching account → activates
- [ ] Set up a SIP via UPI Autopay → held as `UNVERIFIABLE`, ops queue
