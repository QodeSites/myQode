-- ============================================================================
-- Migration: 001_sip_infrastructure.sql
-- Run once. Safe to re-run (all CREATE IF NOT EXISTS / idempotent).
-- ============================================================================

-- ── 1. sip_charges ────────────────────────────────────────────────────────────
-- Tracks every individual SIP installment charge.
-- One row per Cashfree debit attempt, linked to payment_transactions via subscription_id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sip_charges (
  id                 SERIAL PRIMARY KEY,
  subscription_id    VARCHAR(255) NOT NULL,       -- FK → payment_transactions.order_id
  cf_subscription_id VARCHAR(255),               -- Cashfree's own cf_subscription_id
  nuvama_code        VARCHAR(50)  NOT NULL,
  client_id          VARCHAR(255) NOT NULL,
  installment_number INTEGER,                    -- sequential charge counter (1, 2, 3…)
  charge_amount      NUMERIC(10,2) NOT NULL,
  currency           VARCHAR(3)   NOT NULL DEFAULT 'INR',
  charge_status      VARCHAR(50)  NOT NULL,      -- INITIATED | SUCCESS | FAILED | PENDING
  cf_payment_id      VARCHAR(255),               -- Cashfree payment ID for this charge
  payment_time       TIMESTAMP WITH TIME ZONE,
  charge_date        DATE,                       -- the date Cashfree attempted the charge
  bank_reference     VARCHAR(255),
  payment_method     JSONB,
  failure_reason     TEXT,                       -- error message / reason code on FAILED
  retry_count        INTEGER      NOT NULL DEFAULT 0,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Prevent duplicate entries for the same Cashfree payment
CREATE UNIQUE INDEX IF NOT EXISTS uidx_sip_charges_cf_payment_id
  ON sip_charges(cf_payment_id)
  WHERE cf_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sip_charges_subscription_id ON sip_charges(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sip_charges_nuvama_code     ON sip_charges(nuvama_code);
CREATE INDEX IF NOT EXISTS idx_sip_charges_charge_status   ON sip_charges(charge_status);
CREATE INDEX IF NOT EXISTS idx_sip_charges_charge_date     ON sip_charges(charge_date);


-- ── 2. client_push_tokens ────────────────────────────────────────────────────
-- Stores Expo push tokens per client device.
-- A single client may have multiple devices (unique per client_id + token pair).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_push_tokens (
  id          SERIAL PRIMARY KEY,
  client_id   VARCHAR(255) NOT NULL,
  nuvama_code VARCHAR(50),
  push_token  TEXT        NOT NULL,
  platform    VARCHAR(10),                       -- 'ios' | 'android'
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT  uq_client_push_token UNIQUE (client_id, push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_client_id ON client_push_tokens(client_id);


-- ── 3. investment_status default ─────────────────────────────────────────────
-- Ensures the NOT NULL column always has a safe fallback on INSERT.
-- Idempotent: only sets default if one is not already defined.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_name   = 'payment_transactions'
      AND  column_name  = 'investment_status'
      AND  column_default IS NOT NULL
  ) THEN
    ALTER TABLE payment_transactions
      ALTER COLUMN investment_status SET DEFAULT 'PENDING_PAYMENT';
    RAISE NOTICE 'Set DEFAULT PENDING_PAYMENT on payment_transactions.investment_status';
  ELSE
    RAISE NOTICE 'investment_status default already set — skipped';
  END IF;
END $$;
