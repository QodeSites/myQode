// GET /api/mobile/portfolio/snapshot
// Returns the owner profile + all linked accounts with latest portfolio values.
// The ownerId is derived from the JWT – no query param needed (but ownerId can
// be passed as an optional override for admin/impersonation use-cases).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { getStrategyName, getStrategyColor, getPrefix } from '@/lib/strategyConfig'

function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    // Fetch all accounts for this owner group
    const accountsResult = await pool.query(
      `SELECT
         clientid, clientcode, email, mobile, groupid,
         salutation, firstname, middlename, lastname,
         ownerid, head_of_family, onboarding_status, created_at
       FROM pms_clients_master
       WHERE (groupid = (SELECT groupid FROM pms_clients_master WHERE clientid = $1 LIMIT 1)
              OR ownerid = (SELECT ownerid FROM pms_clients_master WHERE clientid = $1 LIMIT 1))
       ORDER BY head_of_family DESC, created_at ASC`,
      [user!.userId]
    )

    const accounts = accountsResult.rows
    if (accounts.length === 0) {
      return NextResponse.json({ error: 'No accounts found' }, { status: 404 })
    }

    const codes = accounts.map((a: any) => a.clientcode)

    // Latest portfolio values for all codes
    const portfolioResult = await pool.query(
      `WITH ranked AS (
         SELECT account_code, report_date, portfolio_value,
                ROW_NUMBER() OVER (PARTITION BY account_code ORDER BY report_date DESC) AS rn
         FROM public.pms_master_sheet
         WHERE account_code = ANY($1)
       )
       SELECT account_code, report_date, portfolio_value FROM ranked WHERE rn = 1`,
      [codes]
    )

    const valueMap: Record<string, { value: number; date: string }> = {}
    portfolioResult.rows.forEach((r: any) => {
      valueMap[r.account_code] = {
        value: parseFloat(r.portfolio_value || 0),
        date: r.report_date,
      }
    })

    // Group by owner
    const ownerMap = new Map<string, typeof accounts>()
    accounts.forEach((a: any) => {
      const key = a.ownerid || a.clientid
      if (!ownerMap.has(key)) ownerMap.set(key, [])
      ownerMap.get(key)!.push(a)
    })

    let totalPortfolioValue = 0
    let activeAccountCount = 0

    const owners = Array.from(ownerMap.entries()).map(([ownerId, accs]) => {
      const primary = accs.find((a: any) => a.head_of_family) || accs[0]
      const name = [primary.salutation, primary.firstname, primary.middlename, primary.lastname]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

      let ownerTotal = 0
      const mappedAccounts = accs.map((a: any) => {
        const pv = valueMap[a.clientcode]
        const portfolioValue = pv?.value ?? 0
        ownerTotal += portfolioValue
        if (a.onboarding_status === 'completed') activeAccountCount++
        return {
          id: a.clientcode,
          strategyPrefix: getPrefix(a.clientcode),
          strategyName: getStrategyName(a.clientcode),
          strategyColor: getStrategyColor(a.clientcode),
          type: 'Individual Account',
          clientId: a.clientid,
          lastUpdated: pv?.date ?? null,
          portfolioValue: +portfolioValue.toFixed(2),
          status: a.onboarding_status === 'completed' ? 'active' : a.onboarding_status,
          mobile: a.mobile ?? null,
        }
      })

      totalPortfolioValue += ownerTotal

      return {
        id: ownerId,
        name,
        email: primary.email,
        totalValue: +ownerTotal.toFixed(2),
        accounts: mappedAccounts,
      }
    })

    return NextResponse.json({
      owners,
      totalPortfolioValue: +totalPortfolioValue.toFixed(2),
      formattedTotal: formatINR(totalPortfolioValue),
      activeAccountCount,
    })
  } catch (err) {
    console.error('[mobile/portfolio/snapshot]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
