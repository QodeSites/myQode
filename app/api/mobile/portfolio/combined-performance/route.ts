// GET /api/mobile/portfolio/combined-performance?accountIds=QAW00037,QFH00035,QGF00032
// Aggregated performance for multiple accounts (owner-level "all strategies" view).
// Merges each account's daily rows by date, summing portfolio_value and cash_in_out.
// All accountIds must be present in the JWT accountCodes.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { REVIEWER_MOCK_COMBINED_PERFORMANCE } from '@/lib/reviewerMock'

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function businessDaysAgo(date: Date, days: number): Date {
  const target = new Date(date)
  let count = 0
  while (count < days) {
    target.setDate(target.getDate() - 1)
    const dow = target.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return target
}

function simpleReturn(current: number, past: number | null): number | null {
  if (past == null || past === 0) return null
  return +(((current / past - 1) * 100).toFixed(2))
}

function cagrReturn(current: number, past: number | null, years: number): number | null {
  if (past == null || past === 0) return null
  return +(((Math.pow(current / past, 1 / years) - 1) * 100).toFixed(2))
}

function inceptionReturn(current: number, past: number | null, inceptionDateStr: string, latestDateStr: string): number | null {
  if (past == null || past === 0) return null
  const days = (new Date(latestDateStr).getTime() - new Date(inceptionDateStr).getTime()) / (1000 * 60 * 60 * 24)
  const years = days / 365.25
  if (years >= 1) return +(((Math.pow(current / past, 1 / years) - 1) * 100).toFixed(2))
  return +(((current / past - 1) * 100).toFixed(2))
}

function valueOnOrBefore(rows: { date: string; portfolioValue: number }[], cutoff: Date): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (new Date(rows[i].date) <= cutoff) return rows[i].portfolioValue
  }
  return null
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const param = searchParams.get('accountIds')

  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_COMBINED_PERFORMANCE)

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
    const result = await pool.query(
      `SELECT account_code, report_date, portfolio_value, cash_in_out
       FROM public.pms_master_sheet
       WHERE account_code = ANY($1)
       ORDER BY report_date ASC`,
      [accountIds]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'No data found' }, { status: 404 })
    }

    // Merge by date: sum portfolio_value and cash_in_out across all accounts
    const dateMap: Record<string, { portfolioValue: number; cashInOut: number }> = {}
    for (const row of result.rows) {
      const date = String(row.report_date).split('T')[0]
      const pv = parseFloat(row.portfolio_value || 0)
      const cf = parseFloat(row.cash_in_out || 0)
      if (!dateMap[date]) dateMap[date] = { portfolioValue: 0, cashInOut: 0 }
      dateMap[date].portfolioValue += pv
      dateMap[date].cashInOut += cf
    }

    const combined = Object.keys(dateMap).sort().map(date => ({
      date,
      portfolioValue: dateMap[date].portfolioValue,
      cashInOut: dateMap[date].cashInOut,
    }))

    // Detect closed account: find last combined row with portfolioValue > 0
    let lastNonZeroIdx = combined.length - 1
    while (lastNonZeroIdx >= 0 && combined[lastNonZeroIdx].portfolioValue === 0) lastNonZeroIdx--
    const isClosed = lastNonZeroIdx < combined.length - 1
    const closedAtRaw = isClosed && lastNonZeroIdx >= 0 ? combined[lastNonZeroIdx].date : null
    const activeRows = isClosed && lastNonZeroIdx >= 0 ? combined.slice(0, lastNonZeroIdx + 1) : combined

    const first = activeRows[0]
    const latest = activeRows[activeRows.length - 1]
    const inceptionDate = first.date
    const latestDate = latest.date
    const currentValue = latest.portfolioValue
    const firstValue = first.portfolioValue

    const amountInvested = activeRows.reduce((sum, r) => sum + r.cashInOut, 0)
    const totalReturns = currentValue - amountInvested
    const returnsPercent = inceptionReturn(currentValue, firstValue, inceptionDate, latestDate) ?? 0

    // Trailing returns — ratio of combined portfolio value at each window
    const latestDateObj = new Date(latestDate)
    const isMonthEnd = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n.getMonth() !== d.getMonth() }
    const getMonthTarget = (months: number): Date => {
      const t = new Date(latestDateObj)
      if (isMonthEnd(latestDateObj)) t.setMonth(t.getMonth() - months + 1, 0)
      else t.setMonth(t.getMonth() - months)
      return t
    }

    const v1W  = valueOnOrBefore(activeRows, new Date(latestDateObj.getTime() - 7 * 86400000))
    const v10D = valueOnOrBefore(activeRows, businessDaysAgo(latestDateObj, 10))
    const v1M  = valueOnOrBefore(activeRows, getMonthTarget(1))
    const v3M  = valueOnOrBefore(activeRows, getMonthTarget(3))
    const v6M  = valueOnOrBefore(activeRows, getMonthTarget(6))
    const v1Y  = valueOnOrBefore(activeRows, getMonthTarget(12))
    const v3Y  = valueOnOrBefore(activeRows, getMonthTarget(36))

    // Max drawdown on combined portfolio value
    let peak = -Infinity
    let maxDD = 0
    let currentDD = 0
    for (const r of activeRows) {
      if (r.portfolioValue > peak) peak = r.portfolioValue
      const dd = peak > 0 ? ((r.portfolioValue - peak) / peak) * 100 : 0
      if (dd < maxDD) maxDD = dd
      currentDD = dd
    }

    return NextResponse.json({
      accountIds,
      isClosed,
      closedAt: closedAtRaw ? formatDate(closedAtRaw) : null,
      amountInvested: +amountInvested.toFixed(2),
      currentValue: +currentValue.toFixed(2),
      totalReturns: +totalReturns.toFixed(2),
      returnsPercent,
      isNegative: totalReturns < 0,
      inceptionDate: formatDate(inceptionDate),
      dataAsOf: formatDate(latestDate),
      grossValue: +currentValue.toFixed(2),
      trailingReturns: {
        portfolio: {
          w1:   simpleReturn(currentValue, v1W),
          d10:  simpleReturn(currentValue, v10D),
          m1:   simpleReturn(currentValue, v1M),
          m3:   simpleReturn(currentValue, v3M),
          m6:   simpleReturn(currentValue, v6M),
          y1:   simpleReturn(currentValue, v1Y),
          y3:   cagrReturn(currentValue, v3Y, 3),
          currentDD: +currentDD.toFixed(2),
          maxDD: +maxDD.toFixed(2),
          sinceInception: inceptionReturn(currentValue, firstValue, inceptionDate, latestDate),
        },
      },
    })
  } catch (err) {
    console.error('[mobile/portfolio/combined-performance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
