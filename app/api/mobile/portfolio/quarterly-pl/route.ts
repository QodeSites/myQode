// GET /api/mobile/portfolio/quarterly-pl?accountId=QFH0008
// Returns quarterly P&L bucketed by year × quarter, in both % and ₹.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

function quarterKey(dateStr: string): { year: number; quarter: number } {
  const d = new Date(dateStr)
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 }
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
      `SELECT report_date, nav, portfolio_value, period_return_percent, pnl
       FROM public.pms_master_sheet
       WHERE account_code = $1
       ORDER BY report_date ASC`,
      [accountId]
    )

    const rows = result.rows
    if (rows.length === 0) {
      return NextResponse.json({ percentData: [], rupeeData: [] })
    }

    // Group by year+quarter; take the LAST row in each quarter as end-of-quarter
    type QMap = Record<number, Record<number, { nav: number; pnl: number; pnl_pct: number }>>
    const qMap: QMap = {}

    rows.forEach((r: any) => {
      const { year, quarter } = quarterKey(r.report_date)
      if (!qMap[year]) qMap[year] = {}
      // Overwrite keeps last (chronologically latest) row per quarter
      qMap[year][quarter] = {
        nav: parseFloat(r.nav),
        pnl: parseFloat(r.pnl || 0),
        pnl_pct: parseFloat(r.period_return_percent || 0),
      }
    })

    // Build quarter-over-quarter return using end-of-quarter NAVs
    // Return for Qn = (NAV_end_Qn / NAV_end_Q(n-1) - 1) × 100
    type QRow = { year: number; q1: number | null; q2: number | null; q3: number | null; q4: number | null; total: number | null }

    const years = Object.keys(qMap).map(Number).sort()
    const percentData: QRow[] = []
    const rupeeData: QRow[] = []

    // Flatten to ordered list of (year, q, nav) for sequential calculation
    const navSeq: Array<{ year: number; q: number; nav: number; pnl: number }> = []
    for (const yr of years) {
      for (let q = 1; q <= 4; q++) {
        if (qMap[yr][q]) {
          navSeq.push({ year: yr, q, nav: qMap[yr][q].nav, pnl: qMap[yr][q].pnl })
        }
      }
    }

    // Build return matrices
    const pctMatrix: Record<number, Record<number, number | null>> = {}
    const rupMatrix: Record<number, Record<number, number | null>> = {}
    for (const yr of years) {
      pctMatrix[yr] = { 1: null, 2: null, 3: null, 4: null }
      rupMatrix[yr] = { 1: null, 2: null, 3: null, 4: null }
    }

    for (let i = 0; i < navSeq.length; i++) {
      const { year, q, nav, pnl } = navSeq[i]
      const prevNav = i > 0 ? navSeq[i - 1].nav : null
      const pct = prevNav && prevNav !== 0
        ? +(((nav - prevNav) / prevNav) * 100).toFixed(2)
        : null
      pctMatrix[year][q] = pct
      rupMatrix[year][q] = +pnl.toFixed(2)
    }

    for (const yr of years) {
      const qPcts = [pctMatrix[yr][1], pctMatrix[yr][2], pctMatrix[yr][3], pctMatrix[yr][4]]
      const qRups = [rupMatrix[yr][1], rupMatrix[yr][2], rupMatrix[yr][3], rupMatrix[yr][4]]

      // Annual total in % = compound of available quarters
      const yearPcts = qPcts.filter((v) => v !== null) as number[]
      const totalPct =
        yearPcts.length > 0
          ? +(yearPcts.reduce((acc, v) => acc * (1 + v / 100), 1) * 100 - 100).toFixed(2)
          : null

      const yearRups = qRups.filter((v) => v !== null) as number[]
      const totalRup = yearRups.length > 0 ? +yearRups.reduce((a, b) => a + b, 0).toFixed(2) : null

      percentData.push({ year: yr, q1: qPcts[0], q2: qPcts[1], q3: qPcts[2], q4: qPcts[3], total: totalPct })
      rupeeData.push({ year: yr, q1: qRups[0], q2: qRups[1], q3: qRups[2], q4: qRups[3], total: totalRup })
    }

    return NextResponse.json({ percentData, rupeeData })
  } catch (err) {
    console.error('[mobile/portfolio/quarterly-pl]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
