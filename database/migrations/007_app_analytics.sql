-- Sign-in and account events for app analytics (lib/authEvents.ts). Additive only; safe to re-run.
-- Run: node scripts/migrate-app-analytics.mjs          (shows whether the table exists)
--      node scripts/migrate-app-analytics.mjs --apply  (creates it in one transaction)
--
-- event: login_success | login_failed | lockout | otp_sent | otp_verified | otp_failed | password_set |
--        password_reset_requested | password_reset_completed | password_changed | logout
-- reason (login_failed): wrong_password | unknown_user | locked | account_closed | role_mismatch |
--        no_password_set | rate_limited | other;   (otp_failed): wrong_code | expired | too_many
-- Never holds passwords, OTPs or tokens.

BEGIN;

CREATE TABLE IF NOT EXISTS auth_events (
  id           BIGSERIAL   PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email        TEXT,                    -- lower-case; null when the identifier matched nobody
  event        TEXT        NOT NULL,
  reason       TEXT,
  platform     TEXT,                    -- web | app | admin
  os           TEXT,                    -- ios | android | null
  app_version  TEXT,
  device       TEXT,
  ip           TEXT,
  meta         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS auth_events_time ON auth_events (occurred_at);
CREATE INDEX IF NOT EXISTS auth_events_event_time ON auth_events (event, occurred_at);
CREATE INDEX IF NOT EXISTS auth_events_email_time ON auth_events (email, occurred_at);

COMMIT;
