-- Money received outside the payment gateways: Zoho Capital Inflows (synced) and cheques / bank transfers recorded in
-- /admin → Payments. Drives the "Payment received" notification and the app's "On its way" card, the same way
-- Razorpay payments in payment_transactions do. Kept apart from payment_transactions (whose gateway check allows only
-- cashfree / razorpay, and whose tracker emails clients). Additive only. Safe to re-run.
BEGIN;
CREATE TABLE IF NOT EXISTS received_payments (
  order_id     TEXT        PRIMARY KEY,              -- zoho_<record id> | manual_<…>
  source       TEXT        NOT NULL,                 -- zoho | manual
  zoho_id      TEXT        UNIQUE,                   -- the Capital Inflow record id (source zoho)
  account_id   TEXT        NOT NULL,                 -- the Nuvama account on the form
  client_name  TEXT,
  amount       NUMERIC     NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL,                 -- when the money reached Qode (drives the 4 pm cut-off)
  label        TEXT,                                 -- where it's going, e.g. "Qode All Weather · Qode Growth Fund"
  split        JSONB,                                -- [{ code, amount }]
  channel      TEXT,                                 -- zoho | cheque | neft | rtgs | imps | upi
  reference    TEXT,
  recorded_by  TEXT,
  status       TEXT        NOT NULL DEFAULT 'on_its_way',   -- on_its_way | cancelled
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS received_payments_account ON received_payments (account_id, status);
CREATE INDEX IF NOT EXISTS received_payments_updated ON received_payments (updated_at);
COMMIT;
