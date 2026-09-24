# Razorpay — internal checks (not for QA)

QA tests what the browser shows. These cover what it cannot see, which is where
the last set of problems actually were. Run them alongside the QA round.

---

## 1. Before handing over: is the environment testable?

```
node "%TEMP%/claude/c--Users-tech-Qode-Desktop-development-qode-microsite/4d284e84-f0eb-4c16-9445-565c499a9df3/scratchpad/qa-precheck.mjs"
```

Confirms the 7 tables exist, Razorpay is in test mode, and there is database
connection headroom. **If free connections are under 20, restart the dev server
first** — the pool saturates across hot-reloads and requests then hang with no
error, which QA would report as "the page is stuck".

---

## 2. The webhook path — QA cannot test this

`/verify` (browser) and `/webhook` (server-to-server) are **separate paths**. A
successful browser payment proves nothing about webhooks, and webhooks are what
SIP activation depends on.

```
node "%TEMP%/claude/c--Users-tech-Qode-Desktop-development-qode-microsite/4d284e84-f0eb-4c16-9445-565c499a9df3/scratchpad\test-webhook.mjs"
```

Signs payloads with the real `RAZORPAY_WEBHOOK_SECRET`, exactly as Razorpay
does. Checks: bad signature rejected, valid accepted, event persisted, replay is
idempotent, `attempt_count` increments, subscription events work.

### Webhooks from Razorpay's own servers

The script above proves the handler works. It does **not** prove Razorpay can
reach us. For that:

```
npx ngrok http 3000
```

Set `<ngrok-url>/api/razorpay/webhook` in Razorpay Dashboard → Settings →
Webhooks with `RAZORPAY_WEBHOOK_SECRET`, then use their "Test webhook" button.
Delivery attempts and response codes are logged on their side — a signature
mismatch shows there as a 400.

---

## 3. After QA finishes: did the data land correctly?

```sql
-- One row per payment, no duplicates, amounts as entered
SELECT razorpay_order_id, razorpay_payment_id, amount,
       payment_status, investment_status, created_at
  FROM payment_transactions
 WHERE gateway = 'razorpay'
 ORDER BY created_at DESC;

-- Every webhook received, and whether it processed
SELECT event_type, status, attempt_count, received_at
  FROM webhook_events
 ORDER BY received_at DESC LIMIT 20;

-- Nothing stuck: anything old and still pending needs a look
SELECT * FROM razorpay_pending_transactions;
```

### What to look for

| Symptom | Meaning |
|---|---|
| Two rows, same `razorpay_payment_id` | Idempotency failure — serious |
| `amount` ≠ what QA entered | Amount tampering or a paise/rupee bug |
| `webhook_events` empty after QA paid | Webhooks are not arriving at all |
| `status = 'FAILED'` in `webhook_events` | Handler threw; read `error_message` |
| Rows stuck in `razorpay_pending_transactions` | Reconciliation cron is not running |

---

## 4. The gap worth closing before going live

QA will exercise one-time payments well. **SIP mandates depend entirely on the
`subscription.activated` webhook**, which was completely broken until the table
restore on 10 Sep — so it has never actually run end to end in this environment.

Test at least one full SIP with ngrok connected, so a real
`subscription.activated` arrives from Razorpay rather than from our own script.

---

## 5. Known context

- `RAZORPAY_ENVIRONMENT=test`, key `rzp_test_TJC…` — no real money can move
- Cards and wallets are disabled deliberately (regulated PMS: investors must pay
  from their own registered bank account). If QA reports them as "missing",
  that is expected behaviour, not a bug.
- `webhook_events`, `razorpay_plans` and 8 other objects were renamed away on
  7 Sep and restored on 10 Sep. If tables go missing again, look for whatever
  ran that rename — it targeted objects owned by the `sanket` database role.
