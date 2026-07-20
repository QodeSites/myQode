-- ============================================================================
-- Migration: 002_platform_login_tracking.sql
-- Run once. Safe to re-run (all ADD COLUMN IF NOT EXISTS).
--
-- pms_clients_master.login_count / last_login_at are currently shared between
-- the web login route (/api/auth/login) and the mobile login route
-- (/api/mobile/auth/login) — there is no way to tell which platform a login
-- came from. This adds separate counters/timestamps per platform so the two
-- can be reported independently, while leaving the existing combined
-- login_count / last_login_at untouched (still updated by both routes).
-- ============================================================================

ALTER TABLE pms_clients_master
  ADD COLUMN IF NOT EXISTS web_login_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_login_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_web_login_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_app_login_at TIMESTAMP WITH TIME ZONE;
