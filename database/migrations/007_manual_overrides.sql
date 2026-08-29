-- Protect deliberate human decisions from the Nuvama scrape.
--
-- THE PROBLEM
-- app/nuvama/nuvama_client_master.py loads pms_clients_master by DELETE +
-- INSERT — its own comment says "Save existing passwords before DELETE+INSERT
-- wipes them". It preserves password, password_set_at and onboarding_status,
-- and nothing else. Every other column is replaced with whatever Nuvama sent.
--
-- So `head_of_family` and `groupid` — which the ops team sets by hand, and
-- which Nuvama does not know about — are reset on every run. Setting a head of
-- family in the back office works until the next scrape, then silently
-- reverts. That is why the Chanchlani household has no head despite the group
-- being named after Devesh.
--
-- THE FIX
-- This table records decisions the pipeline must not overwrite. After the
-- insert, the pipeline reapplies every row here (see the accompanying patch to
-- nuvama_client_master.py). Overrides therefore win permanently, and the
-- reason for each is recorded next to it.
--
-- Only columns a human legitimately sets belong here. Anything Nuvama is
-- authoritative for — holdings, valuations, account codes — must NOT be
-- overridden; those are the scrape's job.

CREATE TABLE IF NOT EXISTS public.pms_clients_manual_overrides (
  id             serial PRIMARY KEY,

  -- Which row this applies to. clientcode is the account identifier the
  -- pipeline keys on; it survives the delete/insert cycle because Nuvama
  -- reissues the same codes.
  clientcode     varchar(50) NOT NULL,

  -- The overridden values. NULL means "leave whatever the scrape produced" —
  -- an override row may fix the family without forcing a head, or vice versa.
  groupid        varchar(50),
  groupname      varchar(255),
  head_of_family boolean,

  -- Who decided this and why. Not decoration: a year from now, someone needs
  -- to know whether an override is still wanted before removing it.
  set_by         varchar(255) NOT NULL,
  reason         text,
  set_at         timestamptz NOT NULL DEFAULT now(),

  -- One override per account. Re-applying an override updates it rather than
  -- stacking a second, contradictory row.
  CONSTRAINT pms_clients_manual_overrides_clientcode_key UNIQUE (clientcode)
);

COMMENT ON TABLE public.pms_clients_manual_overrides IS
  'Human decisions the Nuvama scrape must not overwrite. Reapplied by '
  'nuvama_client_master.py after its DELETE+INSERT load.';

-- The pipeline joins on clientcode on every run; the unique constraint above
-- already provides that index, so no second one is needed.

-- ---------------------------------------------------------------------------
-- Seed: the Chanchlani household.
--
-- All four accounts already share groupid 14410381 ("DEVESH ASHOK
-- CHANCHLANI"), so the family mapping itself is correct today. What is missing
-- is a head: every row has head_of_family = false, so the login query
--
--     ORDER BY head_of_family DESC NULLS LAST, clientcode ASC
--
-- falls through to clientcode order. Naming Devesh head makes his login show
-- the household — including Shobha's two accounts — and this override keeps it
-- that way after each scrape.
--
-- Shobha's rows are pinned to the same group explicitly. The mapping is right
-- now, but the whole reason for this table is that the scrape may change it.
-- ---------------------------------------------------------------------------
INSERT INTO public.pms_clients_manual_overrides
  (clientcode, groupid, groupname, head_of_family, set_by, reason)
VALUES
  ('QAW00093', '14410381', 'DEVESH ASHOK CHANCHLANI', true,  'ops',
   'Head of the Chanchlani household; Nuvama resets this on every scrape.'),
  ('QGF00085', '14410381', 'DEVESH ASHOK CHANCHLANI', false, 'ops',
   'Second account of the head; must not also be flagged head.'),
  ('QAW00178', '14410381', 'DEVESH ASHOK CHANCHLANI', false, 'ops',
   'Shobha Chanchlani — family mapped to Devesh.'),
  ('QTF00181', '14410381', 'DEVESH ASHOK CHANCHLANI', false, 'ops',
   'Shobha Chanchlani — family mapped to Devesh.')
ON CONFLICT (clientcode) DO UPDATE
  SET groupid        = EXCLUDED.groupid,
      groupname      = EXCLUDED.groupname,
      head_of_family = EXCLUDED.head_of_family,
      set_by         = EXCLUDED.set_by,
      reason         = EXCLUDED.reason,
      set_at         = now();

-- Apply the seed to the live table immediately, so the fix takes effect
-- without waiting for the next pipeline run.
UPDATE public.pms_clients_master t
   SET groupid        = COALESCE(o.groupid, t.groupid),
       groupname      = COALESCE(o.groupname, t.groupname),
       head_of_family = COALESCE(o.head_of_family, t.head_of_family),
       updated_at     = now()
  FROM public.pms_clients_manual_overrides o
 WHERE t.clientcode = o.clientcode;

-- Verification (run after applying):
--   SELECT clientname, clientcode, groupid, head_of_family
--     FROM public.pms_clients_master
--    WHERE clientname ILIKE '%chanchlani%'
--    ORDER BY clientcode;
-- Expect four rows in group 14410381, with QAW00093 the only head_of_family.
--
--   SELECT count(*) FROM public.pms_clients_master
--    WHERE groupid IS NOT NULL
--    GROUP BY groupid HAVING count(*) FILTER (WHERE head_of_family) > 1;
-- Expect no rows — no family may have two heads.
