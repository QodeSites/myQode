// GET /api/mobile/portfolio/combined-cashflow?accountIds=QAW00037,QFH00035
// All cash transactions across multiple accounts, merged and sorted by date.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { REVIEWER_MOCK_COMBINED_CASHFLOW } from '@/lib/reviewerMock'

function formatINR(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sign = amount >= 0 ? '+' : '–'
  return `${sign}₹${formatted}`
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const param = searchParams.get('accountIds')

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_CASHFLOW)

  if (!param) {
    return NextResponse.json({ error: 'accountIds is required (comma-separated)' }, { status: 400 })
  }

  const accountIds = param.split(',').map(s => s.trim()).filter(Boolean)
  if (accountIds.length === 0) {
    return NextResponse.json({ error: 'At least one accountId is required' }, { status: 400 })
  }

  const unauthorized = accountIds.filter(id => !user!.accountCodes?.includes(id))
  if (unauthorized.length > 0) {
    return NextResponse.json({ error: 'Forbidden', unauthorized }, { status: 403 })
  }

  try {
    // Detect closed
    const closedCheckRes = await pool.query(
      `SELECT report_date, SUM(portfolio_value) AS combined_value
       FROM public.pms_master_sheet WHERE account_code = ANY($1)
       GROUP BY report_date ORDER BY report_date DESC LIMIT 2`,
      [accountIds]
    )
    const last2 = closedCheckRes.rows
    const isClosed = last2.length >= 2 &&
      parseFloat(last2[0].combined_value || 0) === 0 &&
      parseFloat(last2[1].combined_value || 0) === 0
    let closedAt: string | null = null
    if (isClosed) {
      const caRes = await pool.query(
        `SELECT report_date FROM (
           SELECT report_date, SUM(portfolio_value) AS combined_value
           FROM public.pms_master_sheet WHERE account_code = ANY($1)
           GROUP BY report_date ORDER BY report_date DESC
         ) t WHERE combined_value > 0 LIMIT 1`,
        [accountIds]
      )
      closedAt = caRes.rows[0]?.report_date ? String(caRes.rows[0].report_date).split('T')[0] : null
    }

    // Fetch all non-zero cash flows across all accounts
    const result = await pool.query(
      `SELECT account_code, report_date, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
         AND cash_in_out IS NOT NULL AND cash_in_out != 0
         ${closedAt ? `AND report_date <= '${closedAt}'` : ''}
       ORDER BY report_date ASC`,
      [accountIds]
    )

    const transactions = result.rows.map((r: any) => {
      const amount = parseFloat(r.cash_in_out)
      return {
        date: String(r.report_date).split('T')[0],
        accountId: r.account_code,
        amount,
        type: amount >= 0 ? 'inflow' : 'outflow',
        formattedAmount: formatINR(amount),
      }
    })

    const total = transactions.reduce((sum: number, t: any) => sum + t.amount, 0)

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
