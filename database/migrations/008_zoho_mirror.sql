-- Local copy of the Zoho CRM modules the app syncs (lib/zohoService.ts). The app reads this copy, never Zoho directly,
-- so it stays fast and keeps working while Zoho is slow or down. One row per record; deleted records are flagged.
-- Additive only. Safe to re-run.
BEGIN;
CREATE TABLE IF NOT EXISTS zoho_mirror (
  module         TEXT        NOT NULL,              -- Zoho module API name, e.g. Capital_Inflows
  id             TEXT        NOT NULL,              -- Zoho record id
  modified_time  TIMESTAMPTZ,
  data           JSONB       NOT NULL,
  deleted        BOOLEAN     NOT NULL DEFAULT FALSE,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (module, id)
);
CREATE INDEX IF NOT EXISTS zoho_mirror_module_time ON zoho_mirror (module, modified_time DESC);
COMMIT;
