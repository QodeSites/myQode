// GET /api/mobile/payments/in-flight → the login's payments that have been received but don't show in the portfolio yet
// (Nuvama's data hasn't picked them up), with the dates they'll be invested and become visible (lib/investTimeline.ts).
//   { items: [{ orderId, accountId, strategy, amount, paidAt, deployOn, visibleOn, late }] }
// An item leaves the list once the investment-status tracker marks it DEPLOYED (the money is in Nuvama's data).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { investTimeline } from '@/lib/investTimeline'

export const dynamic = 'force-dynamic'
const strategy = (s: unknown) => String(s || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const codes = (user!.accountCodes || []).filter(c => /^Q[A-Z]{2}/i.test(c))
  if (user!.isReviewer || !codes.length) return NextResponse.json({ items: [] })
  try {
    const rows = (await query(
      `SELECT p.order_id, p.nuvama_code, p.amount, p.payment_time, p.created_at, p.settled_at, m.schemename
         FROM payment_transactions p LEFT JOIN pms_clients_master m ON m.clientcode = p.nuvama_code
        WHERE p.nuvama_code = ANY($1) AND p.payment_type IN ('ONE_TIME', 'NEW_STRATEGY')
          AND p.investment_status IN ('PAYMENT_SUCCESS', 'SETTLED') AND p.created_at > NOW() - interval '30 days'
        ORDER BY p.created_at DESC LIMIT 20`, [codes])).rows
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
    const items = await Promise.all(rows.map(async (r: any) => {
      const t = await investTimeline(r.payment_time || r.created_at, r.settled_at)
      return { orderId: r.order_id, accountId: r.nuvama_code, strategy: strategy(r.schemename), amount: Number(r.amount),
        paidAt: r.payment_time || r.created_at, deployOn: t.deployOn, visibleOn: t.visibleOn, late: today > t.visibleOn }
    }))
    return NextResponse.json({ items })
  } catch (err) {
    console.error('[mobile/payments/in-flight]', err)
    return NextResponse.json({ items: [] })
  }
}
