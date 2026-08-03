// GET /api/mobile/portfolio/cashflow?accountId=QAW0009
// Returns cash-in / cash-out transactions derived from pms_master_sheet.cash_in_out.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { normaliseAccountCode } from '@/lib/utils'
import { reviewerMockCashflow } from '@/lib/reviewerMock'

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
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  if (user!.isReviewer) return NextResponse.json(reviewerMockCashflow(accountId ?? 'DEMO001'))

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  // Owner/group ids reach us float-formatted ("58282.0") — pms_clients_master
  // stores them that way, and the snapshot route echoes ownerid straight back to
  // the app. Authorise against either form, since accountCodes may hold the raw
  // suffixed value from the JWT while the app now sends the clean one (or vice
  // versa). Strategy codes like QGF00014 are left untouched by the normaliser.
  const dbAccountId = normaliseAccountCode(accountId)
  const isAuthorised = user!.accountCodes?.some(
    (code) => code === accountId || normaliseAccountCode(code) === dbAccountId
  )
  if (!isAuthorised) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  try {
    // Detect closed account
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
      closedAt = caRes.rows[0]?.report_date ?? null
    }

    const result = await pool.query(
      `SELECT report_date, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = $1
         AND cash_in_out IS NOT NULL
         AND cash_in_out != 0
         ${closedAt ? `AND report_date <= '${closedAt}'` : ''}
       ORDER BY report_date ASC`,
      [dbAccountId]
    )

    const transactions = result.rows.map((r: any) => {
      const amount: number = parseFloat(r.cash_in_out)
      return {
        date: r.report_date,
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
    console.error('[mobile/portfolio/cashflow]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
