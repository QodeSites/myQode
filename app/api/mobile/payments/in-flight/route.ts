// GET /api/mobile/payments/in-flight → the login's payments that have been received but don't show in the portfolio yet
// (Nuvama's data hasn't picked them up), with the dates they'll be invested and become visible (lib/investTimeline.ts).
//   { items: [{ orderId, accountId, strategy, amount, paidAt, deployOn, visibleOn, late }] }
// Covers Razorpay payments (payment_transactions) and money received otherwise (received_payments: Zoho Capital
// Inflows and cheques / transfers recorded in /admin). An item leaves the list
// once the money shows in Nuvama's data (lib/paymentProgress.ts), or 10 days after it was due, whichever is first.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { investTimeline } from '@/lib/investTimeline'
import { inPortfolio } from '@/lib/paymentProgress'

export const dynamic = 'force-dynamic'
const strategy = (s: unknown) => String(s || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const codes = (user!.accountCodes || []).filter(c => /^Q[A-Z]{2}/i.test(c))
  if (user!.isReviewer || !codes.length) return NextResponse.json({ items: [] })
  try {
    const rows = (await query(
      `SELECT p.order_id, p.nuvama_code, p.amount, coalesce(p.payment_time, p.created_at) AS paid, p.settled_at, m.schemename AS label, FALSE AS own_label
         FROM payment_transactions p LEFT JOIN pms_clients_master m ON m.clientcode = p.nuvama_code
        WHERE p.nuvama_code = ANY($1) AND p.payment_type IN ('ONE_TIME', 'NEW_STRATEGY')
          AND p.investment_status IN ('PAYMENT_SUCCESS', 'SETTLED') AND p.created_at > NOW() - interval '30 days'
       UNION ALL
       SELECT r.order_id, r.account_id, r.amount, r.received_at, r.received_at, r.label, TRUE
         FROM received_payments r WHERE r.account_id = ANY($1) AND r.status = 'on_its_way' AND r.received_at > NOW() - interval '30 days'
        ORDER BY 4 DESC LIMIT 20`, [codes])).rows
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
    const tenDaysAgo = new Date(Date.now() + 330 * 60000 - 10 * 86400000).toISOString().slice(0, 10)
    const items = (await Promise.all(rows.map(async (r: any) => {
      const t = await investTimeline(r.paid, r.settled_at)
      if (t.visibleOn < tenDaysAgo || await inPortfolio(r.nuvama_code, Number(r.amount), t.countsFrom)) return null
      return { orderId: r.order_id, accountId: r.nuvama_code, strategy: r.own_label ? (r.label || '') : strategy(r.label), amount: Number(r.amount),
        paidAt: r.paid, deployOn: t.deployOn, visibleOn: t.visibleOn, late: today > t.visibleOn }
    }))).filter(Boolean)
    return NextResponse.json({ items })
  } catch (err) {
    console.error('[mobile/payments/in-flight]', err)
    return NextResponse.json({ items: [] })
  }
}
