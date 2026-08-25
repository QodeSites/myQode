-- Rename the Enso distributor to match Zoho CRM exactly.
--
-- BEFORE: pms_clients_master held "ENSO FINSERV LLP" while Zoho CRM held
-- "Enso Finserve". Two systems, two spellings for one firm.
--
-- AFTER: both read "Enso Finserve".
--
-- WHY BOTH COLUMNS MUST CHANGE TOGETHER
-- A distributor's clients are linked by a TEXT match, not a foreign key:
--   pms_clients_master.intermediaryname = <the distributor's clientname>
-- (see app/api/distributor/clients/route.ts and lib/distributorIdentity.ts).
-- Renaming the distributor row alone would leave 4 client rows pointing at a
-- name no distributor has any more, and their portal page would show an empty
-- book. The transaction below updates both or neither.
--
-- KNOWN SIDE EFFECT: their referral link changes, because it is built from
-- clientname:
--   before  ?distributor=ENSO%20FINSERV%20LLP
--   after   ?distributor=Enso%20Finserve
-- Links already circulated with the old string will still be accepted by the
-- onboarding app (it takes the parameter as free text), but they will no
-- longer match this distributor's name. Re-share the link from the portal.
--
-- NOTE: this drops the "LLP" suffix that every other distributor row carries
-- (Pvt Ltd, Private Limited, LLP). That is deliberate — the instruction was to
-- match Zoho exactly — but it makes this row the only one without its legal
-- entity type.

BEGIN;

-- Guard: fail loudly if the expected rows are not there, rather than
-- silently updating nothing.
DO $$
DECLARE
  distributor_rows int;
  client_rows int;
BEGIN
  SELECT count(*) INTO distributor_rows
    FROM pms_clients_master
   WHERE clientname = 'ENSO FINSERV LLP' AND clientcode IS NULL;

  SELECT count(*) INTO client_rows
    FROM pms_clients_master
   WHERE intermediaryname = 'ENSO FINSERV LLP';

  IF distributor_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 distributor row, found %', distributor_rows;
  END IF;

  IF client_rows <> 4 THEN
    RAISE EXCEPTION 'Expected exactly 4 client rows, found %', client_rows;
  END IF;
END $$;

-- The distributor's own row (clientcode IS NULL identifies a distributor).
UPDATE pms_clients_master
   SET clientname = 'Enso Finserve'
 WHERE clientname = 'ENSO FINSERV LLP'
   AND clientcode IS NULL;

-- Their clients' link back to them.
UPDATE pms_clients_master
   SET intermediaryname = 'Enso Finserve'
 WHERE intermediaryname = 'ENSO FINSERV LLP';

COMMIT;

-- Verification (run after committing):
--   SELECT clientname, clientcode, intermediaryname
--     FROM pms_clients_master
--    WHERE clientname = 'Enso Finserve' OR intermediaryname = 'Enso Finserve';
-- Expect 5 rows: 1 with clientcode IS NULL, 4 clients.
