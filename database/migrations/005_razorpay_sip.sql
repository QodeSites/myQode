-- ============================================================================
-- Migration: 005_razorpay_sip.sql
-- Run once. Safe to re-run (all ADD COLUMN IF NOT EXISTS / idempotent).
-- Adds Razorpay's own identifiers to sip_charges (001_sip_infrastructure.sql
-- only had Cashfree's cf_subscription_id / cf_payment_id). gateway distinguishes
-- rows written by the two webhooks so a shared table stays queryable.
-- ============================================================================

ALTER TABLE sip_charges
  ADD COLUMN IF NOT EXISTS gateway                    VARCHAR(20)  NOT NULL DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id         VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_sip_charges_razorpay_payment_id
  ON sip_charges(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sip_charges_razorpay_subscription_id
  ON sip_charges(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;
