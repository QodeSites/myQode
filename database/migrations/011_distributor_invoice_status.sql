-- Partner (distributor) invoices: payment status, managed in the backoffice (Admin → Distributor invoices).
-- Additive and idempotent; lib/partnerInvoices.ts also runs it on first use.
ALTER TABLE distributor_invoice_issued
  ADD COLUMN IF NOT EXISTS status             text        NOT NULL DEFAULT 'unpaid',   -- unpaid | on_hold | paid
  ADD COLUMN IF NOT EXISTS paid_on            date,
  ADD COLUMN IF NOT EXISTS paid_amount        numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_ref        text,                                   -- UTR / transaction reference
  ADD COLUMN IF NOT EXISTS payment_note       text,                                   -- shown to the partner
  ADD COLUMN IF NOT EXISTS payment_proof_key  text,                                   -- S3 key (qode-static-assets)
  ADD COLUMN IF NOT EXISTS invoice_doc_key    text,                                   -- S3 key of the invoice document
  ADD COLUMN IF NOT EXISTS status_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_by  text;
