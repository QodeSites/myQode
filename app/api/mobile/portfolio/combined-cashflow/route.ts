// GET /api/mobile/portfolio/combined-cashflow?accountId={ownerId}
// Recent Activity for an owner / group: every strategy account's deposits, withdrawals, full switches, securities
// in / out, straight from the custodian ledger (lib/ledgerFlows.ts). Only the closed check still
// reads the pre-computed pms_master_sheet row (account_code = ownerId).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { normaliseAccountCode } from '@/lib/utils'
import { REVIEWER_MOCK_COMBINED_CASHFLOW } from '@/lib/reviewerMock'
import { ledgerFlows, accountsBehind } from '@/lib/ledgerFlows'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_CASHFLOW)

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Owner/group ids are float-formatted ("65941.0") in the JWT — deliberately so,
  // because the authorisation check above compares against those raw values.
  // pms_master_sheet.account_code has no such suffix, so strip it before querying
  // or the combined view silently returns zero rows.
  const dbAccountId = normaliseAccountCode(accountId)

  try {
    // Detect closed account via pre-computed row
    const closedCheckRes = await pool.query(
      `SELECT report_date, portfolio_value FROM public.pms_master_sheet
       WHERE account_code = $1 ORDER BY report_date DESC LIMIT 2`,
      [dbAccountId]
    )
    const last2 = closedCheckRes.rows
    const isClosed = last2.length >= 2 &&
      parseFloat(last2[0].portfolio_value || 0) === 0 &&
      parseFloat(last2[1].portfolio_value || 0) === 0
    let closedAt: string | null = null
    if (isClosed) {
      const caRes = await pool.query(
        `SELECT report_date FROM public.pms_master_sheet
         WHERE account_code = $1 AND portfolio_value > 0
         ORDER BY report_date DESC LIMIT 1`,
        [dbAccountId]
      )
      closedAt = caRes.rows[0]?.report_date ? String(caRes.rows[0].report_date).split('T')[0] : null
    }

    const transactions = await ledgerFlows(await accountsBehind(dbAccountId), closedAt)
    const total = transactions.reduce((sum: number, t) => sum + t.amount, 0)

    return NextResponse.json({
      isClosed,
      closedAt,
      transactions,
      total: +total.toFixed(2),
      formattedTotal: `₹${Math.abs(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    })
  } catch (err) {
    console.error('[mobile/portfolio/combined-cashflow]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
