-- Referral slugs for the onboarding links.
--
-- WHY THIS EXISTS
-- The portal was generating links as a query parameter built from the
-- distributor's name:
--     onboarding.qodeinvest.com/apply?distributor=Enso%20Finserve
-- The live links are short slug paths instead:
--     onboarding.qodeinvest.com/ensofinserve         (individual)
--     onboarding.qodeinvest.com/ni/ensofinserve      (non-individual)
--
-- WHY THE SLUG CANNOT BE DERIVED
-- It is not a transformation of the name or the email:
--   "First Quartile Private Limited" -> firstquartile
--   "Nuarch fintech Private Ltd"     -> nuarch
--   "Wealth India Financial Services Pvt. Ltd." -> wealthindia
--   "FUTUREWISE TECHNOLOGIES PVT LTD" -> futurewisetechno
-- and two distributors share one email address while having different slugs
-- (chhedarajmanish@gmail.com is both First Quartile and Chedda). Any rule that
-- computed a slug would get some of these wrong and silently mis-attribute
-- referrals, so the values are stored rather than guessed.
--
-- The onboarding app owns these slugs; this column is a copy so the portal can
-- render a partner's links without depending on that app at request time. If a
-- slug changes there, update it here too.

ALTER TABLE public.pms_clients_master
  ADD COLUMN IF NOT EXISTS referral_slug varchar(100);

COMMENT ON COLUMN public.pms_clients_master.referral_slug IS
  'Onboarding link slug: /{slug} for individuals, /ni/{slug} for non-individuals. '
  'Owned by the onboarding app; copied here so the portal can render links. '
  'Not derivable from name or email — see migration 008.';

-- Keyed on id, not email or name.
--
-- Rows 220 and 124362 share chhedarajmanish@gmail.com and both carry the
-- clientname "First Quartile Private Limited"; only `firstname` tells them
-- apart (220 is "Chedda", 124362 is "First Quartile Private Limited"). Keying
-- on email or clientname would give both the same slug and send one partner's
-- referrals to the other.
UPDATE public.pms_clients_master SET referral_slug = v.slug
  FROM (VALUES
    (186,    'ensofinserve'),      -- Enso Finserve
    (184,    'nuarch'),            -- Nuarch fintech Private Ltd
    (124362, 'firstquartile'),     -- First Quartile Private Limited
    (220,    'chedda'),            -- Chedda (same email as First Quartile)
    (109123, 'futurewisetechno'),  -- FUTUREWISE TECHNOLOGIES PVT LTD
    (105098, 'subhashagarwal'),    -- Subhash Agarwal
    (72303,  'basic'),             -- Basic Financial Services Private limited
    (61123,  'factorlab'),         -- Factorlab Capital Services Pvt Ltd
    (59668,  'rahulvinayshetty'),  -- Rahul Vinay Shetty
    (51490,  'tjs'),               -- TJS Financial Services LLP
    (45358,  'myalternates'),      -- MyAlternates Financial Services Pvt Ltd
    (44408,  'ninecube'),          -- NineCube
    (44407,  'wealthindia'),       -- Wealth India Financial Services Pvt. Ltd.
    (43789,  'onebattalion'),      -- One Battalion Ventures Private Limited
    (40522,  'prime'),             -- Prime Capital MF Distributors
    (200,    'jaymukeshshah'),     -- JAY MUKESH SHAH
    (1,      'yashsejpal')         -- YASH BHARAT SEJPAL
  ) AS v(id, slug)
 WHERE public.pms_clients_master.id = v.id;

-- Verification (run after applying):
--   SELECT id, clientname, firstname, referral_slug
--     FROM public.pms_clients_master
--    WHERE clientcode IS NULL ORDER BY clientname;
-- Expect all 17 distributor rows to carry a slug, with 220 = chedda and
-- 124362 = firstquartile.
--
--   SELECT referral_slug, count(*) FROM public.pms_clients_master
--    WHERE referral_slug IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- Expect no rows — two distributors sharing a slug would mis-attribute
-- referrals between them.
--
-- NOTE: the Nuvama pipeline rebuilds pms_clients_master by DELETE + INSERT and
-- preserves only password-related columns, so this column will be wiped on the
-- next scrape unless the manual-override mechanism in migration 007 is
-- extended to carry referral_slug as well. See
-- docs/pipeline-manual-overrides-patch.md.
