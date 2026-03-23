// GET /api/mobile/portfolio/combined-nav?accountIds=QAW00037,QFH00035&period=1Y
// NAV chart for the owner-level "all strategies" combined view.
// Sums portfolio_value across all accounts per date, then rebases to 100 at window start.
// No benchmark line — combined multi-strategy has no single meaningful benchmark.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { REVIEWER_MOCK_COMBINED_NAV } from '@/lib/reviewerMock'

const PERIOD_DAYS: Record<string, number> = {
  '1W': 7, '1M': 30, '3M': 90, '6M': 180,
  '1Y': 365, '3Y': 1095, 'ALL': 99999,
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const param = searchParams.get('accountIds')
  const period = (searchParams.get('period') || '1Y').toUpperCase()

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_NAV)

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

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['1Y']

  try {
    // Detect closed: check last 2 combined portfolio_value rows
    const closedCheckRes = await pool.query(
      `SELECT report_date, SUM(portfolio_value) AS combined_value
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
       GROUP BY report_date
       ORDER BY report_date DESC
       LIMIT 2`,
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
           FROM public.pms_master_sheet
           WHERE account_code = ANY($1)
           GROUP BY report_date
           ORDER BY report_date DESC
         ) t WHERE combined_value > 0 LIMIT 1`,
        [accountIds]
      )
      closedAt = caRes.rows[0]?.report_date
        ? String(caRes.rows[0].report_date).split('T')[0]
        : null
    }

    // Fetch portfolio_value rows in the selected window
    const result = await pool.query(
      `SELECT report_date, SUM(portfolio_value) AS combined_value
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
         AND report_date >= CURRENT_DATE - INTERVAL '${days} days'
         ${closedAt ? `AND report_date <= '${closedAt}'` : ''}
       GROUP BY report_date
       ORDER BY report_date ASC`,
      [accountIds]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ accountIds, period, isClosed, closedAt, series: [], minValue: 100, maxValue: 100 })
    }

    const rows = result.rows
    const baseValue = parseFloat(rows[0].combined_value)

    const series = rows.map((r: any) => {
      const val = parseFloat(r.combined_value)
      return {
        date: String(r.report_date).split('T')[0],
        portfolio: baseValue > 0 ? +(((val / baseValue) * 100).toFixed(4)) : 100,
        benchmark: null,
      }
    })

    const allValues = series.map(s => s.portfolio)

    return NextResponse.json({
      accountIds,
      period,
      isClosed,
      closedAt,
      series,
      minValue: allValues.length ? +Math.min(...allValues).toFixed(2) : 100,
      maxValue: allValues.length ? +Math.max(...allValues).toFixed(2) : 100,
    })
  } catch (err) {
    console.error('[mobile/portfolio/combined-nav]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
