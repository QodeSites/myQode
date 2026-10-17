// Records an invoice the distributor has generated, and advances their number.
//
// The fee engine remains authoritative for what is owed; this is a log of what
// was issued, so a distributor can see their own history and we can answer
// "which invoice covered Q2?" without asking them for it.
//
// The unique constraint on (distributor_email, invoice_number) is the point of
// writing this at all: a duplicated number in a tax invoice series is a
// compliance defect, and the database refusing it is a stronger guarantee than
// the UI trying not to offer it.
import { signedUserContext } from '@/lib/webSession';
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'
import { sendPartnerInvoiceMails } from '@/lib/partnerInvoiceMail'
import { ensureInvoiceStatus, putInvoiceFile, invoiceFileUrl } from '@/lib/partnerInvoices'

interface UserContext {
  email?: string
}

async function callerEmail(): Promise<string | null> {
  const cookieStore = await cookies()
  const raw = (await signedUserContext())?.value
  if (!raw) return null
  try {
    const ctx = JSON.parse(raw) as UserContext
    return ctx?.email ? ctx.email.trim().toLowerCase() : null
  } catch {
    return null
  }
}

/** Past invoices, most recent first — shown on the invoice page. */
// GET ?doc=<invoice number> → { url }: a 10-minute link to the invoice the partner raised (the document saved when it
// was issued), so an issued invoice can be opened again from "Invoices you have issued" (17 Oct 2026).
export async function GET(request: Request) {
  const email = await callerEmail()
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  try {
    await ensureInvoiceStatus()
    const doc = new URL(request.url).searchParams.get('doc')
    if (doc) {
      const r = await query(`SELECT invoice_number, invoice_doc_key FROM distributor_invoice_issued
                              WHERE distributor_email = $1 AND invoice_number = $2 LIMIT 1`, [email, doc])
      const row: any = r.rows[0]
      if (!row?.invoice_doc_key) return NextResponse.json({ error: 'This invoice has no saved copy. Please write to partnerships@qodeinvest.com for it.' }, { status: 404 })
      const url = await invoiceFileUrl(row.invoice_doc_key, `invoice-${String(row.invoice_number).replace(/[^\w.-]+/g, '_')}.html`)
      return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const res = await query(
      `SELECT invoice_number, invoice_date, period_label, invoice_doc_key IS NOT NULL AS has_doc,
              amount_before_tax, tax_amount, total_amount,
              status, paid_on, paid_amount, payment_ref, payment_note
         FROM distributor_invoice_issued
        WHERE distributor_email = $1
        ORDER BY invoice_date DESC, id DESC
        LIMIT 24`,
      [email],
    )
    return NextResponse.json(
      {
        invoices: res.rows.map((r: any) => ({
          invoiceNumber: r.invoice_number,
          invoiceDate: r.invoice_date,
          periodLabel: r.period_label,
          hasDoc: !!r.has_doc,   // a saved copy to open again (GET ?doc=)
          amountBeforeTax: Number(r.amount_before_tax),
          taxAmount: Number(r.tax_amount),
          totalAmount: Number(r.total_amount),
          // payment status, set by Qode in the backoffice (Admin → Distributor invoices)
          status: r.status || 'unpaid',
          paidOn: r.paid_on ? (r.paid_on instanceof Date ? r.paid_on.toISOString() : String(r.paid_on)).slice(0, 10) : null,
          paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
          paymentRef: r.payment_ref || null,
          paymentNote: r.payment_note || null,
        })),
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[distributor/invoice-issue] read failed:', err)
    return NextResponse.json({ error: 'Could not load your invoice history' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const email = await callerEmail()
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const invoiceNumber = String(body.invoiceNumber ?? '').trim()
  const invoiceDate = String(body.invoiceDate ?? '').trim()
  const periodLabel = String(body.periodLabel ?? '').trim()
  if (!invoiceNumber || !invoiceDate || !periodLabel) {
    return NextResponse.json({ error: 'Missing invoice details' }, { status: 400 })
  }

  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  // The period an invoice bills (12 Oct 2026). On 9 Oct a partner raised two invoices for the whole of FY 2027
  // (Apr 2026 – Mar 2027): a year not yet over, including a quarter already invoiced and paid, twice in a minute.
  // Now: the period must be given, must have ended, and must not overlap any invoice the partner already raised.
  // The pages send the period's days as the fee calculator labels them ("1-Jul-26"); an ISO day is accepted too.
  // (13 Oct 2026: only ISO was accepted, so every invoice was refused from 12 Oct with "Choose the period".)
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const toDay = (v: unknown): string => {
    const t = String(v ?? '').trim()
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/), lab = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/)
    const y = iso ? +iso[1] : lab ? (lab[3].length === 2 ? 2000 + +lab[3] : +lab[3]) : 0
    const m = iso ? +iso[2] : lab ? MONTHS.indexOf(lab[2].toLowerCase()) + 1 : 0
    const d = iso ? +iso[3] : lab ? +lab[1] : 0
    const dt = new Date(Date.UTC(y, m - 1, d))
    return y && m && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : ''
  }
  const periodStart = toDay(body.periodStart), periodEnd = toDay(body.periodEnd)
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json({ error: 'Choose the period this invoice is for.' }, { status: 400 })
  }
  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  if (periodEnd >= todayIst) {
    return NextResponse.json({
      error: `${periodLabel} is not over yet (it ends ${periodEnd}). Invoice a period once it has ended, for example the last completed quarter.`,
      code: 'PERIOD_NOT_ENDED',
    }, { status: 400 })
  }

  try {
    await ensureInvoiceStatus()
    const clash = (await query(
      `SELECT invoice_number, period_label, period_start, period_end FROM distributor_invoice_issued
        WHERE distributor_email = $1 AND period_start IS NOT NULL AND period_end IS NOT NULL
          AND period_start <= $3::date AND period_end >= $2::date
        ORDER BY period_start LIMIT 1`, [email, periodStart, periodEnd])).rows[0]
    if (clash) {
      return NextResponse.json({
        error: `This period overlaps invoice ${clash.invoice_number} (${clash.period_label}), which you have already raised. Each period can be invoiced once; choose a period that has not been invoiced.`,
        code: 'PERIOD_ALREADY_INVOICED',
      }, { status: 409 })
    }
    const ins = await query(
      `INSERT INTO distributor_invoice_issued (
         distributor_email, invoice_number, invoice_date, period_label,
         period_start, period_end, amount_before_tax, tax_amount, total_amount
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        email,
        invoiceNumber,
        invoiceDate,
        periodLabel,
        periodStart,
        periodEnd,
        num(body.amountBeforeTax),
        num(body.taxAmount),
        num(body.totalAmount),
      ],
    )

    // Advance the series only as far as this invoice, never backwards — a
    // distributor re-issuing an older number must not rewind the counter and
    // cause the next invoice to collide.
    const trailing = invoiceNumber.match(/(\d+)\s*$/)
    if (trailing) {
      await query(
        `UPDATE distributor_invoice_profile
            SET last_invoice_number = GREATEST(last_invoice_number, $2),
                updated_at = NOW()
          WHERE distributor_email = $1`,
        [email, parseInt(trailing[1], 10)],
      )
    }

    // Keep the invoice document with the record, for the backoffice (Admin → Distributor invoices). Best effort.
    if (typeof body.invoiceHtml === 'string' && body.invoiceHtml.length < 1_500_000) {
      try {
        const id = Number(ins.rows[0]?.id)
        const key = await putInvoiceFile(id, `invoice-${invoiceNumber}.html`, body.invoiceHtml, 'text/html; charset=utf-8')
        await query(`UPDATE distributor_invoice_issued SET invoice_doc_key = $2 WHERE id = $1`, [id, key])
      } catch (e) { console.warn('[distributor/invoice-issue] document not saved:', (e as any)?.message) }
    }

    // The invoice goes to partnerships@ and the partner gets a receipt (lib/partnerInvoiceMail). Best effort: the
    // invoice is recorded either way.
    try {
      const prof = (await query(`SELECT * FROM distributor_invoice_profile WHERE distributor_email = $1`, [email])).rows[0] || null
      const nm = (await query(`SELECT clientname FROM pms_clients_master WHERE lower(btrim(email)) = $1 AND clientcode IS NULL LIMIT 1`, [email])).rows[0]?.clientname || null
      await sendPartnerInvoiceMails({
        partnerEmail: email, invoiceNumber, invoiceDate, periodLabel,
        amountBeforeTax: num(body.amountBeforeTax), taxAmount: num(body.taxAmount), totalAmount: num(body.totalAmount),
        html: typeof body.invoiceHtml === 'string' ? body.invoiceHtml : null,
      }, prof, nm)
    } catch (e) { console.warn('[distributor/invoice-issue] mail failed:', (e as any)?.message) }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err: any) {
    // The unique constraint doing its job. Reported plainly so the distributor
    // can pick another number rather than seeing a generic failure.
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: `You have already issued invoice ${invoiceNumber}. Use a different number.` },
        { status: 409 },
      )
    }
    console.error('[distributor/invoice-issue] write failed:', err)
    return NextResponse.json({ error: 'Could not record the invoice' }, { status: 500 })
  }
}
