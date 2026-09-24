-- ============================================================================
-- Migration: 002_razorpay_migration.sql
-- Adds Razorpay alongside Cashfree. Run once. Safe to re-run (idempotent).
--
-- Context: payment_transactions must now hold rows from TWO gateways at once.
-- Cashfree keeps servicing the mobile app (app/api/mobile/*) and any in-flight
-- orders; Razorpay takes over the web flow. Every query that talks to a gateway
-- API must therefore filter on `gateway` or it will look up an ID in the wrong
-- provider and silently fail.
-- ============================================================================

-- ── 1. gateway discriminator ─────────────────────────────────────────────────
-- DEFAULT 'cashfree' is deliberate: every pre-existing row was a Cashfree
-- transaction, so the default backfills them correctly with no UPDATE pass.
-- New Razorpay inserts must pass 'razorpay' explicitly.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS gateway VARCHAR(20) NOT NULL DEFAULT 'cashfree';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_transactions_gateway'
  ) THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT chk_payment_transactions_gateway
      CHECK (gateway IN ('cashfree','razorpay'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pt_gateway ON payment_transactions(gateway);

-- Composite index for the reconciliation crons, which scan
-- "rows for gateway X still in a non-terminal state".
CREATE INDEX IF NOT EXISTS idx_pt_gateway_investment_status
  ON payment_transactions(gateway, investment_status);


-- ── 2. Razorpay identifier columns ───────────────────────────────────────────
-- Kept separate from the cf_* columns rather than renaming them to something
-- generic: the Cashfree code paths are still live and must not be disturbed.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS razorpay_order_id        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_signature       VARCHAR(255);

-- Partial unique indexes: one Razorpay order/payment maps to exactly one row.
-- This is what makes a duplicated webhook or a double-clicked verify call
-- collide at the DB level instead of creating a second transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_pt_razorpay_order_id
  ON payment_transactions(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pt_razorpay_payment_id
  ON payment_transactions(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pt_razorpay_subscription_id
  ON payment_transactions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;


-- ── 3. Mandate payer-account verification (stands in for disabled TPV) ───────
-- Razorpay TPV is NOT enabled on this merchant account, so the gateway will not
-- refuse a mandate authorised from a third-party bank account. SEBI expects PMS
-- funds to originate from the client's registered account, so we verify the
-- payer account AFTER authorisation and refuse to activate on mismatch.
--
-- This is a detective control, not a preventive one. These columns are the
-- audit trail for it — an ops reviewer must be able to answer "why was this
-- mandate activated?" months later.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_transactions
  -- PENDING | MATCHED | MISMATCH | UNVERIFIABLE | OVERRIDDEN
  ADD COLUMN IF NOT EXISTS payer_verification_status  VARCHAR(30),
  -- What Razorpay actually reported for the authorising account (masked).
  ADD COLUMN IF NOT EXISTS payer_account_last4        VARCHAR(8),
  ADD COLUMN IF NOT EXISTS payer_ifsc                 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payer_account_holder       VARCHAR(255),
  -- Human-readable reason, e.g. "UPI Autopay returned no account number".
  ADD COLUMN IF NOT EXISTS payer_verification_note    TEXT,
  ADD COLUMN IF NOT EXISTS payer_verified_at          TIMESTAMP WITH TIME ZONE,
  -- Set when ops manually clears an UNVERIFIABLE/MISMATCH mandate.
  ADD COLUMN IF NOT EXISTS payer_override_by          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS payer_override_at          TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pt_payer_verification_status'
  ) THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT chk_pt_payer_verification_status
      CHECK (payer_verification_status IS NULL OR payer_verification_status IN
        ('PENDING','MATCHED','MISMATCH','UNVERIFIABLE','OVERRIDDEN'));
  END IF;
END $$;

-- Ops queue: mandates authorised but not yet cleared for activation.
CREATE INDEX IF NOT EXISTS idx_pt_payer_verification_pending
  ON payment_transactions(payer_verification_status)
  WHERE payer_verification_status IN ('PENDING','MISMATCH','UNVERIFIABLE');


-- ── 4. webhook_events — idempotency ledger ───────────────────────────────────
-- Razorpay guarantees at-least-once delivery and retries for up to 24h on any
-- non-2xx. Without this table a retried `payment.captured` can re-run side
-- effects (notifications, status transitions) on an already-settled payment.
--
-- The unique constraint on event_id is the whole point: the handler INSERTs
-- first and bails out on conflict, so concurrent duplicate deliveries are
-- serialised by Postgres rather than by application-level guesswork.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id             SERIAL PRIMARY KEY,
  gateway        VARCHAR(20)  NOT NULL,
  -- Razorpay's x-razorpay-event-id header — stable across retries of one event.
  event_id       VARCHAR(255) NOT NULL,
  event_type     VARCHAR(100) NOT NULL,
  -- Correlation only; not a FK, because an event can arrive before we've
  -- written our own row (or reference an order we never created).
  reference_id   VARCHAR(255),
  payload        JSONB,
  -- RECEIVED | PROCESSED | FAILED | IGNORED
  status         VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED',
  error_message  TEXT,
  attempt_count  INTEGER      NOT NULL DEFAULT 1,
  received_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMP WITH TIME ZONE,
  CONSTRAINT uq_webhook_event UNIQUE (gateway, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_reference ON webhook_events(reference_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type      ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status    ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received  ON webhook_events(received_at);


-- ── 5. sip_charges: Razorpay support ─────────────────────────────────────────
-- Existing unique index is on cf_payment_id. Razorpay installments need their
-- own identifier and their own uniqueness guarantee for the same reason.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sip_charges
  ADD COLUMN IF NOT EXISTS gateway                  VARCHAR(20) NOT NULL DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS razorpay_payment_id      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_invoice_id      VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_sip_charges_razorpay_payment_id
  ON sip_charges(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sip_charges_gateway ON sip_charges(gateway);


-- ── 6. razorpay_plans — plan cache ───────────────────────────────────────────
-- Razorpay requires a Plan entity before a Subscription can be created, and a
-- plan is IMMUTABLE once created. Since each client chooses their own SIP
-- amount, a naive implementation creates a fresh plan per signup and the
-- dashboard fills with thousands of near-identical plans.
--
-- This table caches one plan per (amount, period, interval). The unique
-- constraint is also what makes two concurrent signups for the same amount
-- safe: the loser of the race reuses the winner's plan instead of erroring.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS razorpay_plans (
  id               SERIAL PRIMARY KEY,
  razorpay_plan_id VARCHAR(255) NOT NULL UNIQUE,
  amount_paise     BIGINT       NOT NULL,
  period           VARCHAR(20)  NOT NULL,   -- daily | weekly | monthly | yearly
  interval_count   INTEGER      NOT NULL,   -- quarterly == monthly x3
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_razorpay_plan_shape UNIQUE (amount_paise, period, interval_count)
);


-- ── 7. Guard the Cashfree reconciliation cron ────────────────────────────────
-- lib/investmentStatusCron.ts polls Cashfree's settlements API for every
-- transaction in a pending state. Now that Razorpay rows share this table, that
-- cron MUST be scoped to gateway='cashfree' or it will query Cashfree for order
-- IDs that only exist in Razorpay. This view makes the intent explicit and gives
-- the cron a safe thing to select from.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW cashfree_pending_transactions AS
  SELECT * FROM payment_transactions
   WHERE gateway = 'cashfree'
     AND investment_status NOT IN ('DEPLOYED','SETTLED','CANCELLED','EXPIRED');

CREATE OR REPLACE VIEW razorpay_pending_transactions AS
  SELECT * FROM payment_transactions
   WHERE gateway = 'razorpay'
     AND investment_status NOT IN ('DEPLOYED','SETTLED','CANCELLED','EXPIRED');


-- ── 8. Report ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cf_rows  INTEGER;
  rzp_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO cf_rows  FROM payment_transactions WHERE gateway = 'cashfree';
  SELECT COUNT(*) INTO rzp_rows FROM payment_transactions WHERE gateway = 'razorpay';
  RAISE NOTICE 'Migration 002 complete. cashfree rows=%, razorpay rows=%', cf_rows, rzp_rows;
END $$;
