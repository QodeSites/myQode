// GET /api/mobile/services/registered-bank?accountId=QAW0009
// The client's registered (verified) bank account for this PMS account — the only account a SIP
// mandate may debit (SEBI third-party-validation rule). Same table the web reads in
// app/api/bank-details/route.tsx (pms_clients_tracker.pms_clients_bank_details, db1), masked here:
// the app never needs the full account number, only enough for the client to recognise it.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import db1 from '@/lib/db1'

export async function registeredBankFor(accountId: string) {
  const { rows } = await db1.query(
    `SELECT account_number, ifsc_code, client_name, verification_status
       FROM pms_clients_tracker.pms_clients_bank_details
      WHERE nuvama_code = $1
      ORDER BY updated_at DESC LIMIT 1`,
    [accountId]
  )
  if (!rows.length) return null
  const r = rows[0]
  return {
    accountNumber: String(r.account_number || '').trim(),
    ifsc: String(r.ifsc_code || '').trim().toUpperCase(),
    holderName: String(r.client_name || '').trim(),
    verified: String(r.verification_status || '').toLowerCase() === 'verified',
  }
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const accountId = new URL(request.url).searchParams.get('accountId') || ''
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!user!.accountCodes?.includes(accountId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const b = await registeredBankFor(accountId)
    if (!b) return NextResponse.json({ accountId, bank: null })
    return NextResponse.json({
      accountId,
      bank: { last4: b.accountNumber.slice(-4), ifsc: b.ifsc, bankCode: b.ifsc.slice(0, 4), holderName: b.holderName, verified: b.verified },
    })
  } catch (err) {
    console.error('[mobile/services/registered-bank]', err)
    return NextResponse.json({ error: 'Could not load bank details' }, { status: 500 })
  }
}
