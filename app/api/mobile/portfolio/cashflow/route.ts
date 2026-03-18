// GET /api/mobile/portfolio/cashflow?accountId=QFH0008
// Returns cash-in / cash-out transactions derived from pms_master_sheet.cash_in_out.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

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

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  try {
    const result = await pool.query(
      `SELECT report_date, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = $1
         AND cash_in_out IS NOT NULL
         AND cash_in_out != 0
       ORDER BY report_date ASC`,
      [accountId]
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
      transactions,
      total: +total.toFixed(2),
      formattedTotal: `₹${Math.abs(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    })
  } catch (err) {
    console.error('[mobile/portfolio/cashflow]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
