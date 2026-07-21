-- ============================================================================
-- Migration: 003_login_events_and_first_login.sql
-- Run once. Safe to re-run (all IF NOT EXISTS).
--
-- pms_clients_master.web_login_count / app_login_count / last_*_login_at only
-- capture current state (a count + the most recent timestamp) — not enough to
-- compute retention curves or active-investor trend lines, which need to know
-- WHEN each login happened. This adds:
--
--   1. first_web_login_at / first_app_login_at — per-platform first-login
--      timestamps (mirrors the existing first_login_at), for a platform-split
--      onboarding funnel.
--   2. login_events — an append-only log, one row per login, going forward.
--      Historical logins before this migration are NOT backfilled (that data
--      doesn't exist) — retention/trend charts will only cover activity from
--      the rollout date onward until enough history accumulates.
-- ============================================================================

ALTER TABLE pms_clients_master
  ADD COLUMN IF NOT EXISTS first_web_login_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS first_app_login_at TIMESTAMP WITH TIME ZONE;

-- Lives in the SAME database as pms_clients_master (not pms_clients_tracker,
-- which is a different database — see lib/db.ts vs lib/db1.ts) so admin
-- queries can join login_events directly against pms_clients_master.
CREATE TABLE IF NOT EXISTS login_events (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('web', 'app')),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_email       ON login_events (email);
CREATE INDEX IF NOT EXISTS idx_login_events_platform_ts ON login_events (platform, occurred_at DESC);
