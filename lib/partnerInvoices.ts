// Partner invoices: the status columns (database/migrations/011_distributor_invoice_status.sql, applied on first use)
// and the S3 files that go with an invoice — the invoice document saved when it is raised, and the payment proof
// uploaded when it is marked paid. Bucket qode-static-assets, under docs/partner-invoices/<id>/.
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3 } from '@/lib/s3'
import { query } from '@/lib/db'

export const INVOICE_BUCKET = 'qode-static-assets'
export const INVOICE_ROOT = 'docs/partner-invoices/'
export const INVOICE_STATUSES = ['unpaid', 'on_hold', 'paid'] as const
export type InvoiceStatus = typeof INVOICE_STATUSES[number]
export const STATUS_LABEL: Record<InvoiceStatus, string> = { unpaid: 'Unpaid', on_hold: 'On hold', paid: 'Paid' }

let ready: Promise<void> | null = null
export function ensureInvoiceStatus(): Promise<void> {
  ready ||= query(`ALTER TABLE distributor_invoice_issued
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unpaid',
      ADD COLUMN IF NOT EXISTS paid_on date,
      ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2),
      ADD COLUMN IF NOT EXISTS payment_ref text,
      ADD COLUMN IF NOT EXISTS payment_note text,
      ADD COLUMN IF NOT EXISTS payment_proof_key text,
      ADD COLUMN IF NOT EXISTS invoice_doc_key text,
      ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS status_updated_by text`, []).then(() => undefined, (e) => { ready = null; throw e })
  return ready
}

const safe = (s: string) => s.replace(/[\\/]/g, '_').replace(/[^\w .()&,+-]/g, '_').trim().slice(0, 120) || 'file'

export async function putInvoiceFile(id: number, name: string, body: Buffer | string, contentType: string): Promise<string> {
  const key = `${INVOICE_ROOT}${id}/${safe(name)}`
  await s3.send(new PutObjectCommand({ Bucket: INVOICE_BUCKET, Key: key, Body: typeof body === 'string' ? Buffer.from(body) : body, ContentType: contentType }))
  return key
}

export async function invoiceFileUrl(key: string, filename?: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: INVOICE_BUCKET, Key: key,
    ...(filename ? { ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, '')}"` } : {}),
  }), { expiresIn: 600 })
}
