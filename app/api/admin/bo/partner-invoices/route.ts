// Admin → Distributor invoices: every invoice partners raised in the portal, and their payment status.
//
// GET  (staff)                     → { invoices: [...], totals }
// GET  (staff)  ?file=<id>&kind=invoice|proof   → redirect to a short-lived link to the invoice document / payment proof
// POST (super)  multipart: id, status (unpaid | on_hold | paid), [paidOn, paidAmount, paymentRef, note, file, notify=1]
//               Paid needs paidOn, paidAmount and paymentRef; the partner is emailed (lib/partnerInvoiceMail) unless
//               notify=0. testTo=<email> sends that email to that address only and changes nothing.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { ensureInvoiceStatus, INVOICE_STATUSES, putInvoiceFile, invoiceFileUrl, type InvoiceStatus } from '@/lib/partnerInvoices'
import { sendInvoicePaidMail } from '@/lib/partnerInvoiceMail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }
const n = (v: unknown) => { const x = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : 0 }
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))

const SELECT = `
  SELECT i.*, p.legal_name, p.gstin, p.pan, p.bank_name, p.bank_account_number, p.bank_ifsc,
         (SELECT cm.clientname FROM pms_clients_master cm WHERE lower(btrim(cm.email)) = i.distributor_email AND cm.clientcode IS NULL LIMIT 1) AS partner_name
    FROM distributor_invoice_issued i
    LEFT JOIN distributor_invoice_profile p ON p.distributor_email = i.distributor_email`

const view = (r: any) => ({
  id: Number(r.id), partnerEmail: r.distributor_email, partnerName: r.partner_name || null, legalName: r.legal_name || null,
  gstin: r.gstin || null, pan: r.pan || null,
  bank: [r.bank_name, r.bank_account_number && 'A/c ' + r.bank_account_number, r.bank_ifsc && 'IFSC ' + r.bank_ifsc].filter(Boolean).join(' · ') || null,
  invoiceNumber: r.invoice_number, invoiceDate: day(r.invoice_date), periodLabel: r.period_label, periodStart: day(r.period_start), periodEnd: day(r.period_end),
  amountBeforeTax: n(r.amount_before_tax), taxAmount: n(r.tax_amount), totalAmount: n(r.total_amount), raisedAt: r.created_at,
  status: (r.status || 'unpaid') as InvoiceStatus, paidOn: day(r.paid_on), paidAmount: r.paid_amount == null ? null : n(r.paid_amount),
  paymentRef: r.payment_ref || null, paymentNote: r.payment_note || null,
  hasProof: !!r.payment_proof_key, hasDocument: !!r.invoice_doc_key,
  statusUpdatedAt: r.status_updated_at || null, statusUpdatedBy: r.status_updated_by || null,
})

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  try {
    await ensureInvoiceStatus()
    const fileId = req.nextUrl.searchParams.get('file')
    if (fileId) {
      const kind = req.nextUrl.searchParams.get('kind') === 'proof' ? 'proof' : 'invoice'
      const r = (await query(`SELECT invoice_number, invoice_doc_key, payment_proof_key FROM distributor_invoice_issued WHERE id = $1`, [Number(fileId)])).rows[0]
      const key = r && (kind === 'proof' ? r.payment_proof_key : r.invoice_doc_key)
      if (!key) return NextResponse.json({ error: kind === 'proof' ? 'No payment proof uploaded' : 'No invoice document saved for this invoice' }, { status: 404 })
      return NextResponse.redirect(await invoiceFileUrl(key, String(key).split('/').pop()))
    }
    const rows = (await query(`${SELECT} ORDER BY i.created_at DESC`, [])).rows.map(view)
    const sum = (s: InvoiceStatus) => rows.filter((x) => x.status === s)
    const totals = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, { count: sum(s).length, amount: sum(s).reduce((t, x) => t + x.totalAmount, 0) }]))
    return NextResponse.json({ invoices: rows, totals })
  } catch (e: any) {
    console.error('[admin/bo/partner-invoices] GET', e)
    return NextResponse.json({ error: 'Could not load invoices: ' + (e?.message || 'unknown error') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Send the update as multipart form data' }, { status: 400 }) }
  const id = Number(form.get('id'))
  const status = String(form.get('status') || '') as InvoiceStatus
  const testTo = String(form.get('testTo') || '').trim().toLowerCase()
  if (!id) return NextResponse.json({ error: 'Which invoice?' }, { status: 400 })
  if (!INVOICE_STATUSES.includes(status)) return NextResponse.json({ error: 'Status must be Unpaid, On hold or Paid' }, { status: 400 })

  try {
    await ensureInvoiceStatus()
    const row = (await query(`${SELECT} WHERE i.id = $1`, [id])).rows[0]
    if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    const inv = view(row)

    const paidOn = String(form.get('paidOn') || '').trim()
    const paidAmount = n(form.get('paidAmount'))
    const paymentRef = String(form.get('paymentRef') || '').trim().slice(0, 80)
    const note = String(form.get('note') || '').trim().slice(0, 500) || null
    if (status === 'paid') {
      const errs: Record<string, string> = {}
      if (!isDay(paidOn)) errs.paidOn = 'Enter the payment date'
      else if (paidOn > new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)) errs.paidOn = 'The payment date can’t be in the future'
      if (!(paidAmount > 0)) errs.paidAmount = 'Enter the amount paid'
      if (!paymentRef) errs.paymentRef = 'Enter the UTR or transaction reference'
      if (Object.keys(errs).length) return NextResponse.json({ error: Object.values(errs)[0], errors: errs }, { status: 400 })
    }

    // payment proof (optional)
    let proof: { name: string; contentType: string; content: Buffer } | null = null
    const file = form.get('file')
    if (file instanceof File && file.size) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      if (!TYPES[ext]) return NextResponse.json({ error: 'The payment proof must be a PDF, JPG or PNG' }, { status: 400 })
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The payment proof is larger than 10 MB' }, { status: 400 })
      proof = { name: file.name.replace(/[\\/]/g, '_'), contentType: TYPES[ext], content: Buffer.from(await file.arrayBuffer()) }
    }

    const mail = () => sendInvoicePaidMail({
      partnerEmail: inv.partnerEmail, partnerName: inv.legalName || inv.partnerName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate,
      periodLabel: inv.periodLabel, totalAmount: inv.totalAmount, paidOn, paidAmount, paymentRef, note, proof,
    }, testTo || null)

    // Test: the email only, to the address given; nothing is saved.
    if (testTo) {
      if (status !== 'paid') return NextResponse.json({ error: 'A test email is for the Paid status' }, { status: 400 })
      const m = await mail()
      await audit(req, admin!, 'partner-invoices.test-email', inv.partnerEmail, { id, to: testTo, sent: m.sent })
      return NextResponse.json({ test: true, email: m })
    }

    const proofKey = proof ? await putInvoiceFile(id, `payment-proof-${proof.name}`, proof.content, proof.contentType) : null
    if (status === 'paid') {
      await query(`UPDATE distributor_invoice_issued SET status = 'paid', paid_on = $2, paid_amount = $3, payment_ref = $4, payment_note = $5,
                     payment_proof_key = COALESCE($6, payment_proof_key), status_updated_at = NOW(), status_updated_by = $7 WHERE id = $1`,
        [id, paidOn, paidAmount, paymentRef, note, proofKey, admin!.email])
    } else {
      // Back to unpaid / on hold: the payment details are cleared (a wrong "Paid" undone); the note is kept for on hold.
      await query(`UPDATE distributor_invoice_issued SET status = $2, paid_on = NULL, paid_amount = NULL, payment_ref = NULL,
                     payment_note = $3, status_updated_at = NOW(), status_updated_by = $4 WHERE id = $1`,
        [id, status, status === 'on_hold' ? note : null, admin!.email])
    }
    const notify = status === 'paid' && form.get('notify') !== '0'
    const m = notify ? await mail() : null
    await audit(req, admin!, 'partner-invoices.status', inv.partnerEmail, { id, invoice: inv.invoiceNumber, from: inv.status, to: status, paymentRef, emailed: m?.sent ?? false })
    const updated = view((await query(`${SELECT} WHERE i.id = $1`, [id])).rows[0])
    return NextResponse.json({ invoice: updated, email: m })
  } catch (e: any) {
    console.error('[admin/bo/partner-invoices] POST', e)
    return NextResponse.json({ error: 'Could not update the invoice: ' + (e?.message || 'unknown error') }, { status: 500 })
  }
}
