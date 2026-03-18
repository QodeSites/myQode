// GET /api/mobile/portfolio/monthly-pl?accountId=QFH0008
// Returns monthly P&L bucketed by year × month, in both % and ₹.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
type MonthKey = typeof MONTH_KEYS[number]

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
      `SELECT report_date, nav, pnl
       FROM public.pms_master_sheet
       WHERE account_code = $1
       ORDER BY report_date ASC`,
      [accountId]
    )

    const rows = result.rows
    if (rows.length === 0) {
      return NextResponse.json({ percentData: [], rupeeData: [] })
    }

    // Keep last row per year-month
    type MonthEnd = { nav: number; pnl: number }
    const monthMap: Record<number, Record<number, MonthEnd>> = {}

    rows.forEach((r: any) => {
      const d = new Date(r.report_date)
      const yr = d.getFullYear()
      const mo = d.getMonth() // 0-indexed
      if (!monthMap[yr]) monthMap[yr] = {}
      monthMap[yr][mo] = { nav: parseFloat(r.nav), pnl: parseFloat(r.pnl || 0) }
    })

    const years = Object.keys(monthMap).map(Number).sort()

    // Flatten to ordered sequence for sequential return calculation
    type NavPoint = { year: number; mo: number; nav: number; pnl: number }
    const seq: NavPoint[] = []
    for (const yr of years) {
      for (let mo = 0; mo < 12; mo++) {
        if (monthMap[yr][mo]) {
          seq.push({ year: yr, mo, nav: monthMap[yr][mo].nav, pnl: monthMap[yr][mo].pnl })
        }
      }
    }

    type YearRow = { year: number } & Record<MonthKey, number | null> & { total: number | null }

    const pctRows: YearRow[] = []
    const rupRows: YearRow[] = []

    const emptyMonths = (): Record<MonthKey, number | null> =>
      Object.fromEntries(MONTH_KEYS.map((k) => [k, null])) as Record<MonthKey, number | null>

    const pctMatrix: Record<number, Record<MonthKey, number | null>> = {}
    const rupMatrix: Record<number, Record<MonthKey, number | null>> = {}
    for (const yr of years) {
      pctMatrix[yr] = emptyMonths()
      rupMatrix[yr] = emptyMonths()
    }

    for (let i = 0; i < seq.length; i++) {
      const { year, mo, nav, pnl } = seq[i]
      const prevNav = i > 0 ? seq[i - 1].nav : null
      const pct = prevNav && prevNav !== 0
        ? +(((nav - prevNav) / prevNav) * 100).toFixed(2)
        : null
      const mKey = MONTH_KEYS[mo]
      pctMatrix[year][mKey] = pct
      rupMatrix[year][mKey] = +pnl.toFixed(2)
    }

    for (const yr of years) {
      const pcts = MONTH_KEYS.map((k) => pctMatrix[yr][k])
      const rups = MONTH_KEYS.map((k) => rupMatrix[yr][k])

      const validPcts = pcts.filter((v) => v !== null) as number[]
      const totalPct = validPcts.length > 0
        ? +(validPcts.reduce((acc, v) => acc * (1 + v / 100), 1) * 100 - 100).toFixed(2)
        : null

      const validRups = rups.filter((v) => v !== null) as number[]
      const totalRup = validRups.length > 0
        ? +validRups.reduce((a, b) => a + b, 0).toFixed(2)
        : null

      pctRows.push({ year: yr, ...pctMatrix[yr], total: totalPct })
      rupRows.push({ year: yr, ...rupMatrix[yr], total: totalRup })
    }

    return NextResponse.json({ percentData: pctRows, rupeeData: rupRows })
  } catch (err) {
    console.error('[mobile/portfolio/monthly-pl]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
