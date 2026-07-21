-- ============================================================================
-- Migration: 004_ios_android_login_split.sql
-- Run once. Safe to re-run (all IF NOT EXISTS).
--
-- app_login_count/last_app_login_at (added in 001... see 002) conflate iOS and
-- Android into one bucket. This adds OS-level granularity:
--   1. login_events.os — 'ios' | 'android' | NULL (NULL for web logins)
--   2. pms_clients_master.ios_login_count / android_login_count /
--      last_ios_login_at / last_android_login_at — mirrors the existing
--      web/app split pattern, one level more granular for the app side.
-- ============================================================================

ALTER TABLE login_events
  ADD COLUMN IF NOT EXISTS os TEXT CHECK (os IN ('ios', 'android'));

ALTER TABLE pms_clients_master
  ADD COLUMN IF NOT EXISTS ios_login_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS android_login_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ios_login_at     TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_android_login_at TIMESTAMP WITH TIME ZONE;
