// The client's registered (verified) bank account for a PMS account, from the same table the web reads
// in app/api/bank-details/route.tsx (pms_clients_tracker.pms_clients_bank_details, db1). Used by
// /api/mobile/services/registered-bank (masked for display) and setup-sip (mandate prefill).
// Lives in lib/ because a Next.js route file may export only its HTTP handlers — an extra export there
// fails `next build`.
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
