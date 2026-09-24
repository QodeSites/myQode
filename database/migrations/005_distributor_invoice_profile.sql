-- Distributor invoice profiles.
--
-- A tax invoice needs the issuer's legal name, GSTIN, address and an invoice
-- number. None of that is in our data — of 15 distributors, one has a PAN and
-- no column exists for GSTIN — and it is not ours to invent: a wrong GSTIN on
-- an invoice is the distributor's compliance problem, not a cosmetic defect.
--
-- So the distributor supplies it once and we store it, rather than asking them
-- to retype it every quarter. Keyed on the email in their portal session, the
-- same identity the fee calculator uses.

CREATE TABLE IF NOT EXISTS distributor_invoice_profile (
  -- Matches pms_clients_master.email, which is the distributor's portal login
  -- and the key the fee calculator already resolves them by.
  distributor_email   VARCHAR(255) PRIMARY KEY,

  -- Registered legal name, which may differ from the display name we hold.
  legal_name          VARCHAR(255) NOT NULL,

  -- Tax identifiers. GSTIN is nullable: a distributor below the registration
  -- threshold legitimately has none, and blocking them from invoicing would be
  -- wrong. The invoice omits the GST lines entirely in that case.
  gstin               VARCHAR(15),
  pan                 VARCHAR(10),

  -- Registered address, as it must appear on the invoice.
  address_line1       VARCHAR(255) NOT NULL,
  address_line2       VARCHAR(255),
  city                VARCHAR(120),
  state               VARCHAR(120),
  -- GST state code, e.g. '27' for Maharashtra. Determines whether the invoice
  -- carries CGST+SGST (same state as Qode) or IGST (different state).
  state_code          VARCHAR(2),
  pincode             VARCHAR(10),

  -- Where Qode should remit. Held so the invoice carries it, not for payments
  -- initiated from this system.
  bank_account_name   VARCHAR(255),
  bank_account_number VARCHAR(34),
  bank_ifsc           VARCHAR(11),
  bank_name           VARCHAR(160),

  -- Invoice numbering is the distributor's own series, so we store their
  -- prefix and the last number issued rather than imposing a format. Suggested
  -- on the form; they remain free to override it.
  invoice_prefix      VARCHAR(24),
  last_invoice_number INTEGER NOT NULL DEFAULT 0,

  -- Free-text terms the distributor wants printed (payment terms, notes).
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A record of what was actually issued, so a distributor can see their own
-- history and we can answer "which invoice covered Q2?" without asking them.
-- Deliberately a log, not a source of truth for the amounts: the fee engine
-- remains authoritative, and this records what the distributor generated.
CREATE TABLE IF NOT EXISTS distributor_invoice_issued (
  id                  SERIAL PRIMARY KEY,
  distributor_email   VARCHAR(255) NOT NULL,
  invoice_number      VARCHAR(64)  NOT NULL,
  invoice_date        DATE         NOT NULL,
  period_label        VARCHAR(64)  NOT NULL,
  period_start        DATE,
  period_end          DATE,

  -- Amounts as shown on the generated invoice, in rupees.
  amount_before_tax   NUMERIC(14,2) NOT NULL,
  tax_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(14,2) NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One invoice number per distributor. Prevents a duplicate series entry,
  -- which on a tax invoice is a compliance defect rather than a nuisance.
  CONSTRAINT distributor_invoice_number_unique
    UNIQUE (distributor_email, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_distributor_invoice_issued_email
  ON distributor_invoice_issued (distributor_email, invoice_date DESC);
