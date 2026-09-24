-- ============================================================================
-- Migration: 003_strip_float_suffix_from_account_ids.sql
-- Run once. Safe to re-run (the WHERE clause makes it a no-op once clean).
--
-- pms_clients_master.ownerid and .groupid are varchar columns that were being
-- populated with float-formatted values ("65941.0") — an upstream import wrote
-- numbers into text columns. The join target, pms_master_sheet.account_code,
-- has no such suffix, so an exact match found NOTHING:
--
--     account_code = '65941.0'  ->   0 rows
--     account_code = '65941'    ->  25 rows
--
-- Measured before this migration: 0 of 462 distinct owner/group ids resolved.
-- After: 460 of 462. The consequence was blank family- and owner-level
-- portfolio charts — the API returned HTTP 200 with an empty series, so
-- nothing surfaced as an error.
--
-- The columns stay VARCHAR deliberately. account_code holds non-numeric codes
-- (QAW0001, QTF0009), so it cannot become numeric; converting ownerid/groupid
-- to bigint would force a cast on every join in both directions, and node-pg
-- returns bigint as a string to JS regardless.
-- ============================================================================

BEGIN;

-- Snapshot the before state so the migration output is auditable.
DO $$
DECLARE
  owner_dirty INTEGER;
  group_dirty INTEGER;
BEGIN
  SELECT COUNT(*) FILTER (WHERE ownerid LIKE '%.0'),
         COUNT(*) FILTER (WHERE groupid LIKE '%.0')
    INTO owner_dirty, group_dirty
    FROM pms_clients_master;
  RAISE NOTICE 'Before: ownerid with .0 = %, groupid with .0 = %', owner_dirty, group_dirty;
END $$;

-- Strip only a trailing ".0" (or ".00", …). A value with real decimal
-- precision would be a different identifier and is deliberately left alone.
UPDATE pms_clients_master
   SET ownerid = regexp_replace(ownerid, '\.0+$', ''),
       groupid = regexp_replace(groupid, '\.0+$', '')
 WHERE ownerid LIKE '%.0%'
    OR groupid LIKE '%.0%';

DO $$
DECLARE
  owner_dirty INTEGER;
  group_dirty INTEGER;
  resolved    INTEGER;
  total_ids   INTEGER;
BEGIN
  SELECT COUNT(*) FILTER (WHERE ownerid LIKE '%.0'),
         COUNT(*) FILTER (WHERE groupid LIKE '%.0')
    INTO owner_dirty, group_dirty
    FROM pms_clients_master;
  RAISE NOTICE 'After:  ownerid with .0 = %, groupid with .0 = %', owner_dirty, group_dirty;

  WITH ids AS (
    SELECT DISTINCT ownerid AS raw FROM pms_clients_master WHERE ownerid IS NOT NULL
    UNION
    SELECT DISTINCT groupid FROM pms_clients_master WHERE groupid IS NOT NULL
  )
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM pms_master_sheet m WHERE m.account_code = ids.raw))
    INTO total_ids, resolved
    FROM ids;
  RAISE NOTICE 'Owner/group ids resolving against account_code: % of %', resolved, total_ids;
END $$;

COMMIT;

-- ── Note on prevention ───────────────────────────────────────────────────────
-- This fixes the data as it stands. Whatever writes to pms_clients_master will
-- reintroduce the suffix on its next run unless it is also fixed. The
-- read-time guard (normaliseAccountCode in lib/utils.ts, applied in
-- /api/portfolio-history-by-code) is deliberately kept as a safety net so the
-- portal keeps working if that happens.
