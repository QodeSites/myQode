// app/api/bank-details/route.tsx
//
// Read and submit the registered bank account for a portfolio account.
//
// SIP requires this data: the payer check in lib/razorpay-payer-check.ts
// compares the account a mandate is authorised from against the one registered
// here. TPV is disabled on the Razorpay account, so that comparison is the only
// control preventing a client funding a portfolio from someone else's bank.
//
// Only 72 of 590 accounts have a row, because the table was ever only populated
// for clients who completed a mandate. Nuvama does not supply it and operations
// keying it in by hand is error-prone, so clients submit their own — which is
// what POST below is for.
import { NextRequest, NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import pool from '@/lib/db1'
import { validateBankDetails, maskAccountNumber } from '@/lib/bankDetails'

interface SessionClient {
  clientid?: string
  clientcode?: string
}

/**
 * The accounts this session may act on, or null when not signed in.
 *
 * Mirrors the check in the Razorpay routes. The previous version of this file
 * checked only that SOMEBODY was logged in and then trusted the nuvama_code
 * from the query string — so any authenticated user could read any client's
 * bank details by changing one parameter.
 */
async function getSessionClients(): Promise<SessionClient[] | null> {
  const cookieStore = await cookies()
  if (cookieStore.get('qode-auth')?.value !== '1') return null
  const raw = cookieStore.get('qode-clients')?.value
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function ownsAccount(clients: SessionClient[], code: string): boolean {
  return clients.some((c) => c.clientcode === code || c.clientid === code)
}

/** The signed-in user's email, for the audit trail. */
async function sessionEmail(): Promise<string> {
  const cookieStore = await cookies()
  const raw = cookieStore.get('qode-user-context')?.value
  if (!raw) return 'unknown'
  try {
    return JSON.parse(raw)?.email ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function GET(request: NextRequest) {
  const sessionClients = await getSessionClients()
  if (sessionClients === null) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const nuvama_code = new URL(request.url).searchParams.get('nuvama_code')
  if (!nuvama_code) {
    return NextResponse.json({ error: 'nuvama_code is required' }, { status: 400 })
  }

  if (!ownsAccount(sessionClients, nuvama_code)) {
    return NextResponse.json(
      { error: 'This account is not linked to your login.' },
      { status: 403 },
    )
  }

  try {
    const { rows } = await pool.query(
      `SELECT nuvama_code, client_name, ifsc_code, account_number,
              verification_status, source, updated_at
         FROM pms_clients_tracker.pms_clients_bank_details
        WHERE nuvama_code = $1
        LIMIT 1`,
      [nuvama_code],
    )

    if (!rows.length) {
      // Not an error — most accounts simply have not submitted yet, and the UI
      // uses this to decide whether to show the form.
      return NextResponse.json({ success: true, bankDetails: null }, { status: 200 })
    }

    const r = rows[0]
    return NextResponse.json({
      success: true,
      bankDetails: {
        nuvamaCode:        r.nuvama_code,
        accountHolderName: r.client_name,
        ifsc:              r.ifsc_code,
        // Never return the full number, even to its owner: it is not needed to
        // confirm what is on file, and a masked value cannot be harvested.
        accountNumberMasked: maskAccountNumber(r.account_number),
        verificationStatus:  r.verification_status,
        source:              r.source,
        updatedAt:           r.updated_at,
      },
    })
  } catch (error) {
    console.error('[bank-details] read failed:', error)
    return NextResponse.json({ error: 'Failed to fetch bank details' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const sessionClients = await getSessionClients()
  if (sessionClients === null) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const nuvama_code = String(body.nuvamaCode ?? '').trim()
  if (!nuvama_code) {
    return NextResponse.json({ error: 'nuvamaCode is required' }, { status: 400 })
  }
  if (!ownsAccount(sessionClients, nuvama_code)) {
    return NextResponse.json(
      { error: 'This account is not linked to your login.' },
      { status: 403 },
    )
  }

  // Validated server-side as well as in the form: the form can be bypassed, and
  // a malformed account number here fails at mandate time instead of at entry.
  const check = validateBankDetails({
    accountNumber:        body.accountNumber,
    confirmAccountNumber: body.confirmAccountNumber,
    ifsc:                 body.ifsc,
    accountHolderName:    body.accountHolderName,
  })
  if (!check.valid || !check.normalised) {
    return NextResponse.json({ errors: check.errors }, { status: 422 })
  }

  const { accountNumber, ifsc, accountHolderName } = check.normalised
  const email = await sessionEmail()
  const ip =
    (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: existing } = await client.query(
      `SELECT account_number, ifsc_code, verification_status
         FROM pms_clients_tracker.pms_clients_bank_details
        WHERE nuvama_code = $1
        FOR UPDATE`,
      [nuvama_code],
    )
    const prior = existing[0] ?? null

    // A verified account was proven correct by a real payment arriving from it.
    // Letting it be silently replaced would defeat the payer check, so changing
    // one is an operations decision, not a self-service one.
    if (prior?.verification_status === 'verified' && prior.account_number !== accountNumber) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        {
          error:
            'A verified bank account is already registered for this portfolio. ' +
            'Please contact investor.relations@qodeinvest.com to change it.',
          error_code: 'VERIFIED_ACCOUNT_EXISTS',
        },
        { status: 409 },
      )
    }

    await client.query(
      `INSERT INTO pms_clients_tracker.pms_clients_bank_details
              (nuvama_code, client_name, account_number, ifsc_code,
               source, verification_status, submitted_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'client', 'unverified', $5, NOW(), NOW())
       ON CONFLICT (nuvama_code) DO UPDATE SET
              client_name         = EXCLUDED.client_name,
              account_number      = EXCLUDED.account_number,
              ifsc_code           = EXCLUDED.ifsc_code,
              source              = 'client',
              verification_status = 'unverified',
              submitted_by        = EXCLUDED.submitted_by,
              updated_at          = NOW()`,
      [nuvama_code, accountHolderName, accountNumber, ifsc, email],
    )

    // Append-only record of the change. Only the last four digits are kept:
    // this proves a change happened, it is not a second copy of the number.
    await client.query(
      `INSERT INTO pms_clients_tracker.pms_clients_bank_details_audit
              (nuvama_code, action, old_account_masked, new_account_masked,
               old_ifsc, new_ifsc, changed_by, source, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'client', $8)`,
      [
        nuvama_code,
        prior ? 'updated' : 'created',
        prior ? maskAccountNumber(prior.account_number) : null,
        maskAccountNumber(accountNumber),
        prior?.ifsc_code ?? null,
        ifsc,
        email,
        ip,
      ],
    )

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      bankDetails: {
        nuvamaCode:          nuvama_code,
        accountHolderName,
        ifsc,
        accountNumberMasked: maskAccountNumber(accountNumber),
        verificationStatus:  'unverified',
      },
      // Said plainly so the client is not surprised when their first SIP
      // instalment is checked against this.
      message:
        'Your bank details have been saved. Your first SIP payment must come ' +
        'from this account.',
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[bank-details] write failed:', error)
    return NextResponse.json({ error: 'Could not save your bank details' }, { status: 500 })
  } finally {
    client.release()
  }
}
