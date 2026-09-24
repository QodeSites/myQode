// The distributor's own invoice details — legal name, GSTIN, address, bank.
//
// Stored so they enter it once rather than retyping a GSTIN every quarter,
// which is the field least tolerant of a typo. Scoped entirely to the caller's
// own session email: a distributor can read and write their own profile and
// nothing else.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'
import { validateGstin, validatePan, panFromGstin, GST_STATE_CODES } from '@/lib/invoiceTax'

interface UserContext {
  email?: string
}

/** Resolves the caller from their session cookie. Null means not signed in. */
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

export async function GET() {
  const email = await callerEmail()
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  try {
    const res = await query(
      `SELECT * FROM distributor_invoice_profile WHERE distributor_email = $1`,
      [email],
    )
    if (!res.rows.length) {
      // Not an error: a distributor who has never invoiced simply has no
      // profile yet, and the form handles that by starting empty.
      return NextResponse.json({ profile: null }, { status: 200 })
    }

    const r = res.rows[0]
    return NextResponse.json(
      {
        profile: {
          legalName: r.legal_name ?? '',
          gstin: r.gstin ?? '',
          pan: r.pan ?? '',
          addressLine1: r.address_line1 ?? '',
          addressLine2: r.address_line2 ?? '',
          city: r.city ?? '',
          state: r.state ?? '',
          stateCode: r.state_code ?? '',
          pincode: r.pincode ?? '',
          bankAccountName: r.bank_account_name ?? '',
          bankAccountNumber: r.bank_account_number ?? '',
          bankIfsc: r.bank_ifsc ?? '',
          bankName: r.bank_name ?? '',
          invoicePrefix: r.invoice_prefix ?? '',
          lastInvoiceNumber: Number(r.last_invoice_number ?? 0),
          notes: r.notes ?? '',
        },
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[distributor/invoice-profile] read failed:', err)
    return NextResponse.json({ error: 'Could not load your invoice details' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const email = await callerEmail()
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const str = (k: string) => String(body[k] ?? '').trim()
  const legalName = str('legalName')
  const gstin = str('gstin').toUpperCase()
  const pan = str('pan').toUpperCase()
  const addressLine1 = str('addressLine1')
  const stateCode = str('stateCode')

  // Validate server-side as well as in the form. The form can be bypassed, and
  // a malformed GSTIN reaching the invoice is a compliance defect rather than
  // a display bug.
  const errors: Record<string, string> = {}
  if (!legalName) errors.legalName = 'Enter the legal name your invoices are raised in'
  if (!addressLine1) errors.addressLine1 = 'Enter your registered address'

  // GSTIN is optional — below the threshold a distributor legitimately has
  // none — but if supplied it must be well-formed.
  if (gstin) {
    const check = validateGstin(gstin)
    if (!check.valid) errors.gstin = check.reason ?? 'Check your GSTIN'
    if (stateCode && gstin.slice(0, 2) !== stateCode.padStart(2, '0')) {
      errors.stateCode = `Your GSTIN begins ${gstin.slice(0, 2)}, which is ${
        GST_STATE_CODES[gstin.slice(0, 2)] ?? 'a different state'
      } — it must match the state you select`
    }
  }

  if (pan) {
    const check = validatePan(pan)
    if (!check.valid) errors.pan = check.reason ?? 'Check your PAN'
    // The PAN sits inside the GSTIN, so a mismatch means one was mistyped.
    const embedded = gstin ? panFromGstin(gstin) : null
    if (embedded && pan && embedded !== pan) {
      errors.pan = `This doesn't match the PAN inside your GSTIN (${embedded})`
    }
  }

  if (stateCode && !GST_STATE_CODES[stateCode.padStart(2, '0')]) {
    errors.stateCode = 'Select your state'
  }

  if (Object.keys(errors).length) {
    return NextResponse.json({ errors }, { status: 422 })
  }

  try {
    await query(
      `INSERT INTO distributor_invoice_profile (
         distributor_email, legal_name, gstin, pan,
         address_line1, address_line2, city, state, state_code, pincode,
         bank_account_name, bank_account_number, bank_ifsc, bank_name,
         invoice_prefix, notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
       ON CONFLICT (distributor_email) DO UPDATE SET
         legal_name = EXCLUDED.legal_name,
         gstin = EXCLUDED.gstin,
         pan = EXCLUDED.pan,
         address_line1 = EXCLUDED.address_line1,
         address_line2 = EXCLUDED.address_line2,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         state_code = EXCLUDED.state_code,
         pincode = EXCLUDED.pincode,
         bank_account_name = EXCLUDED.bank_account_name,
         bank_account_number = EXCLUDED.bank_account_number,
         bank_ifsc = EXCLUDED.bank_ifsc,
         bank_name = EXCLUDED.bank_name,
         invoice_prefix = EXCLUDED.invoice_prefix,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        email,
        legalName,
        gstin || null,
        pan || null,
        addressLine1,
        str('addressLine2') || null,
        str('city') || null,
        str('state') || null,
        stateCode || null,
        str('pincode') || null,
        str('bankAccountName') || null,
        str('bankAccountNumber') || null,
        str('bankIfsc').toUpperCase() || null,
        str('bankName') || null,
        str('invoicePrefix') || null,
        str('notes') || null,
      ],
    )
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error('[distributor/invoice-profile] write failed:', err)
    return NextResponse.json({ error: 'Could not save your invoice details' }, { status: 500 })
  }
}
