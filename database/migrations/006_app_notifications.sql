-- myQode app notifications: device popups (Expo push) + the in-app inbox behind the bell.
-- Additive only: four new tables, nothing existing is altered. Safe to re-run (IF NOT EXISTS).
-- Run: node scripts/migrate-app-notifications.mjs          (shows which tables exist)
--      node scripts/migrate-app-notifications.mjs --apply  (runs it in one transaction)
--
-- Every notification is written to app_notifications FIRST (the inbox is the source of truth), then delivered to
-- the login's devices by the outbox worker in lib/appNotify.ts. dedupe_key makes every trigger idempotent: a
-- scanner can run any number of times and each event still reaches a login once.

BEGIN;

-- Devices of THIS app (myQode, Expo project 56cc6ed6-…). Kept apart from client_push_tokens, which holds tokens of
-- the older Qode app: Expo rejects a request that mixes two projects' tokens.
CREATE TABLE IF NOT EXISTS app_push_devices (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT        NOT NULL,              -- login email, lower-case
  push_token   TEXT        NOT NULL UNIQUE,       -- ExponentPushToken[…]; one device belongs to one login at a time
  platform     TEXT,                               -- ios | android
  app_version  TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_push_devices_email ON app_push_devices (email) WHERE is_active;

-- Admin campaigns (written in /admin → Notifications).
CREATE TABLE IF NOT EXISTS app_notification_campaigns (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  link         TEXT,
  category     TEXT        NOT NULL DEFAULT 'updates',
  audience     JSONB       NOT NULL,              -- { type: 'all' | 'strategy' | 'emails' | 'test', value }
  created_by   TEXT        NOT NULL,
  recipients   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The inbox + outbox: one row per login per notification.
CREATE TABLE IF NOT EXISTS app_notifications (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT        NOT NULL,             -- recipient login email, lower-case
  category       TEXT        NOT NULL,             -- money | portfolio | reading | updates
  title          TEXT        NOT NULL,
  body           TEXT        NOT NULL,
  link           TEXT,                              -- in-app destination, e.g. 'tab:portfolio', 'page:newsletters'
  data           JSONB       NOT NULL DEFAULT '{}',
  dedupe_key     TEXT        NOT NULL,
  campaign_id    BIGINT      REFERENCES app_notification_campaigns(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at        TIMESTAMPTZ,
  -- delivery: pending → sent (Expo accepted) → delivered (receipt ok) | failed | no_device | muted
  push_status    TEXT        NOT NULL DEFAULT 'pending',
  push_attempts  INTEGER     NOT NULL DEFAULT 0,
  push_next_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_tickets   JSONB,                             -- [{ id, token }] from Expo, checked against receipts
  push_error     TEXT,
  pushed_at      TIMESTAMPTZ,
  UNIQUE (email, dedupe_key)
);
CREATE INDEX IF NOT EXISTS app_notifications_inbox ON app_notifications (email, created_at DESC);
CREATE INDEX IF NOT EXISTS app_notifications_outbox ON app_notifications (push_next_at) WHERE push_status IN ('pending', 'sent');
CREATE INDEX IF NOT EXISTS app_notifications_campaign ON app_notifications (campaign_id) WHERE campaign_id IS NOT NULL;

-- Per-login choices (Settings → Notifications). No row = everything on.
CREATE TABLE IF NOT EXISTS app_notification_prefs (
  email       TEXT        PRIMARY KEY,
  portfolio   BOOLEAN     NOT NULL DEFAULT TRUE,
  reading     BOOLEAN     NOT NULL DEFAULT TRUE,
  updates     BOOLEAN     NOT NULL DEFAULT TRUE,   -- money events are always on: they are about the client's money
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Watermarks for the scanners (last newsletter seen, first run of a trigger, …).
CREATE TABLE IF NOT EXISTS app_notification_state (
  key         TEXT        PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
