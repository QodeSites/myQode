-- Client self-service for bank details.
--
-- SIP requires a registered bank account to verify the payer against (TPV is
-- disabled on the Razorpay account, so this check is the only thing stopping a
-- client funding a portfolio from someone else's bank). Only 72 of 590 accounts
-- have one, because the table was ever only populated for clients who completed
-- a mandate. Nuvama does not supply this data, and manual entry by operations
-- is error-prone — a mistyped account number fails the payer check at mandate
-- time, which is worse than not offering SIP.
--
-- So clients submit their own. That needs three things the table does not
-- currently have: a uniqueness guard, an audit trail, and a verification state.

-- ── 1. De-duplicate ──────────────────────────────────────────────────────────
-- 15 nuvama_codes carry duplicate rows (QTF00036 has four). All are byte
-- identical today, so nothing is lost by collapsing them — but the SIP route
-- reads with `LIMIT 1` and no ORDER BY, so once clients start submitting, a
-- second row WOULD be chosen arbitrarily. Collapse first, then constrain.
DELETE FROM pms_clients_tracker.pms_clients_bank_details a
      USING pms_clients_tracker.pms_clients_bank_details b
      WHERE a.nuvama_code = b.nuvama_code
        AND a.id > b.id;

-- ── 2. One bank account per portfolio account ───────────────────────────────
-- Makes the upsert below safe against two concurrent submissions, and makes the
-- SIP route's `LIMIT 1` deterministic rather than planner-dependent.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_bank_details_nuvama_code
  ON pms_clients_tracker.pms_clients_bank_details (nuvama_code);

-- ── 3. Provenance and verification state ────────────────────────────────────
-- `source` distinguishes a client's own submission from an operations entry or
-- the original mandate capture — worth knowing when a payer check fails.
--
-- `verification_status` exists because a self-submitted account is a CLAIM, not
-- a verified fact. It is only proven correct when a real payment arrives from
-- it and lib/razorpay-payer-check.ts matches the two. Until then SIP treats it
-- as unverified rather than assuming the client typed it correctly.
ALTER TABLE pms_clients_tracker.pms_clients_bank_details
  ADD COLUMN IF NOT EXISTS source              VARCHAR(20)  NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20)  NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS submitted_by        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW();

-- Rows that predate this migration came from the mandate capture, and a mandate
-- only completes if the bank confirmed the account — so they are verified.
UPDATE pms_clients_tracker.pms_clients_bank_details
   SET verification_status = 'verified',
       source              = 'mandate'
 WHERE source = 'legacy'
   AND account_number IS NOT NULL
   AND account_number <> '';

-- ── 4. Audit trail ──────────────────────────────────────────────────────────
-- Bank details decide where money is collected from. Every change is recorded
-- with its previous value, so a disputed debit can be traced to who changed
-- what and when. Append-only: rows here are never updated or deleted.
CREATE TABLE IF NOT EXISTS pms_clients_tracker.pms_clients_bank_details_audit (
  id                  SERIAL PRIMARY KEY,
  nuvama_code         VARCHAR(50)  NOT NULL,
  action              VARCHAR(20)  NOT NULL,   -- created | updated
  -- Masked in the application layer before writing; the audit trail proves a
  -- change happened, it is not a second copy of the account number.
  old_account_masked  VARCHAR(50),
  new_account_masked  VARCHAR(50),
  old_ifsc            VARCHAR(20),
  new_ifsc            VARCHAR(20),
  changed_by          VARCHAR(255) NOT NULL,   -- session email
  source              VARCHAR(20)  NOT NULL,   -- client | operations
  ip_address          VARCHAR(64),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_audit_nuvama
  ON pms_clients_tracker.pms_clients_bank_details_audit (nuvama_code, created_at DESC);
