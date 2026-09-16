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
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

interface UserContext {
  email?: string
}

async function callerEmail(): Promise<string | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get('qode-user-context')?.value
  if (!raw) return null
  try {
    const ctx = JSON.parse(raw) as UserContext
    return ctx?.email ? ctx.email.trim().toLowerCase() : null
  } catch {
    return null
  }
}

/** Past invoices, most recent first — shown on the invoice page. */
export async function GET() {
  const email = await callerEmail()
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  try {
    const res = await query(
      `SELECT invoice_number, invoice_date, period_label,
              amount_before_tax, tax_amount, total_amount
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
          amountBeforeTax: Number(r.amount_before_tax),
          taxAmount: Number(r.tax_amount),
          totalAmount: Number(r.total_amount),
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

  try {
    await query(
      `INSERT INTO distributor_invoice_issued (
         distributor_email, invoice_number, invoice_date, period_label,
         period_start, period_end, amount_before_tax, tax_amount, total_amount
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        email,
        invoiceNumber,
        invoiceDate,
        periodLabel,
        body.periodStart || null,
        body.periodEnd || null,
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
