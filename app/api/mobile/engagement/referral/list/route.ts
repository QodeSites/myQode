// GET /api/mobile/engagement/referral/list — the signed-in investor's past referrals (app addition: the web's
// referral page has no history). Read from the inquiries table the referral email is recorded in
// (send-email → pms_clients_tracker.qode_microsite_inquiries, type 'investor_referral'): every referral made from
// the app or the web on this login's email or any of its account codes, newest first.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db1'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const codes = (user!.accountCodes || []).filter(Boolean)
  try {
    const r = await pool.query(
      `SELECT id, nuvama_code, status, created_at, resolved_at, data
         FROM pms_clients_tracker.qode_microsite_inquiries
        WHERE type = 'investor_referral'
          AND (lower(user_email) = $1 OR nuvama_code = ANY($2::text[]))
        ORDER BY created_at DESC
        LIMIT 100`,
      [String(user!.email || '').toLowerCase(), codes],
    )
    const referrals = r.rows.map((row: any) => {
      const d = row.data || {}
      return {
        id: row.id,
        accountId: row.nuvama_code,
        name: d.referred_investor_name || '',
        email: d.referred_investor_email || '',
        phone: d.referred_investor_phone || '',
        note: d.description || '',
        // 'pending' until Investor Relations marks it resolved in the admin console
        status: row.status === 'resolved' ? 'resolved' : 'pending',
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      }
    })
    return NextResponse.json({ referrals })
  } catch (err) {
    console.error('[mobile/engagement/referral/list]', err)
    return NextResponse.json({ error: 'Could not load your referrals' }, { status: 502 })
  }
}
