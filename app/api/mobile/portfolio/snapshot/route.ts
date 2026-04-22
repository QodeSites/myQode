// GET /api/mobile/portfolio/snapshot
// Returns the owner profile + all linked accounts with latest portfolio values.
// The ownerId is derived from the JWT – no query param needed (but ownerId can
// be passed as an optional override for admin/impersonation use-cases).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { getStrategyName, getStrategyColor, getPrefix } from '@/lib/strategyConfig'
import { REVIEWER_MOCK_SNAPSHOT } from '@/lib/reviewerMock'

function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json(REVIEWER_MOCK_SNAPSHOT)

  try {
    const isHoF = user!.isHeadOfFamily
    const ACCOUNT_SELECT = `
      SELECT clientid, clientcode, email, mobile, groupid,
             salutation, firstname, middlename, lastname,
             ownerid, head_of_family, onboarding_status, created_at
      FROM pms_clients_master`
    const ACTIVE_FILTER = `(maturity_date IS NULL OR maturity_date > NOW())`

    let accountsResult

    if (isHoF) {
      // Look up the group of the logged-in user's primary row, then fetch all active
      // members of that group.
      accountsResult = await pool.query(
        `${ACCOUNT_SELECT}
         WHERE groupid = (SELECT groupid FROM pms_clients_master WHERE clientid = $1 LIMIT 1)
           AND ${ACTIVE_FILTER}
         ORDER BY head_of_family DESC, created_at ASC`,
        [user!.userId]
      )

      // Edge case (e.g. Ashok Jogani): HoF row's group may be fully matured while the
      // client has active accounts in another group (e.g. HUF accounts).
      // Fall back to email lookup — same logic as the login route.
      if (accountsResult.rows.length === 0) {
        console.log('[snapshot] HoF group fully matured — falling back to email lookup', {
          userId: user!.userId,
          email: user!.email,
        })
        accountsResult = await pool.query(
          `${ACCOUNT_SELECT}
           WHERE email = $1
             AND ${ACTIVE_FILTER}
           ORDER BY head_of_family DESC, created_at ASC`,
          [user!.email]
        )
      }
    } else {
      // Non-HoF: start with ownerid lookup. If the user has accounts across
      // multiple owner entities (e.g. personal + LLP under the same email —
      // like karan@qodeinvest.com with QAW0009/Qode Advisors LLP), the ownerid
      // query would miss them. Always augment with email lookup and deduplicate.
      const ownerResult = await pool.query(
        `${ACCOUNT_SELECT}
         WHERE (ownerid = $1 OR clientid = $1)
           AND ${ACTIVE_FILTER}
         ORDER BY head_of_family DESC, created_at ASC`,
        [user!.ownerIds?.[0] ?? user!.userId]
      )

      const emailResult = await pool.query(
        `${ACCOUNT_SELECT}
         WHERE email = $1
           AND ${ACTIVE_FILTER}
         ORDER BY head_of_family DESC, created_at ASC`,
        [user!.email]
      )

      // Merge & deduplicate by clientcode — email results may include extra
      // accounts (different owner entities) that ownerid alone wouldn't return.
      const seen = new Set<string>()
      const merged: typeof ownerResult.rows = []
      for (const row of [...ownerResult.rows, ...emailResult.rows]) {
        if (!seen.has(row.clientcode)) {
          seen.add(row.clientcode)
          merged.push(row)
        }
      }
      accountsResult = { ...ownerResult, rows: merged }
    }

    const accounts = accountsResult.rows
    if (accounts.length === 0) {
      return NextResponse.json({ error: 'No accounts found' }, { status: 404 })
    }

    const codes = accounts.map((a: any) => a.clientcode)

    // Latest 2 portfolio values per account to detect closed accounts
    const portfolioResult = await pool.query(
      `WITH ranked AS (
         SELECT account_code, report_date, portfolio_value,
                ROW_NUMBER() OVER (PARTITION BY account_code ORDER BY report_date DESC) AS rn
         FROM public.pms_master_sheet
         WHERE account_code = ANY($1)
       )
       SELECT account_code, report_date, portfolio_value, rn FROM ranked WHERE rn <= 2`,
      [codes]
    )

    // Build value map — if last 2 consecutive records are both 0.0, account is closed
    // NOTE: ROW_NUMBER() returns bigint which node-postgres gives back as a string — use Number()
    const rawMap: Record<string, { value: number; date: string; prev?: number }> = {}
    portfolioResult.rows.forEach((r: any) => {
      const val = parseFloat(r.portfolio_value || 0)
      const rn = Number(r.rn)
      if (rn === 1) {
        rawMap[r.account_code] = { value: val, date: r.report_date }
      } else if (rn === 2 && rawMap[r.account_code]) {
        rawMap[r.account_code].prev = val
      }
    })

    const valueMap: Record<string, { value: number; date: string; isClosed: boolean }> = {}
    Object.entries(rawMap).forEach(([code, data]) => {
      const isClosed = data.value === 0 && data.prev === 0
      valueMap[code] = { value: data.value, date: data.date, isClosed }
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
        const isClosed = pv?.isClosed ?? false
        // Active = has portfolio data and isn't closed by two-consecutive-zero rule.
        // onboarding_status is not used here — a user who can log in (password set)
        // should see their accounts as active regardless of onboarding_status.
        if (!isClosed) activeAccountCount++
        const status = isClosed ? 'closed' : 'active'
        return {
          id: a.clientcode,
          strategyPrefix: getPrefix(a.clientcode),
          strategyName: getStrategyName(a.clientcode),
          strategyColor: getStrategyColor(a.clientcode),
          type: 'Individual Account',
          clientId: a.clientid,
          lastUpdated: pv?.date ?? null,
          portfolioValue: +portfolioValue.toFixed(2),
          status,
          isClosed,
          mobile: a.mobile ?? null,
        }
      })

      totalPortfolioValue += ownerTotal

      return {
        id: ownerId,
        name,
        email: primary.email,
        groupId: primary.groupid ?? null,
        isHeadOfFamily: primary.head_of_family ?? false,
        totalValue: +ownerTotal.toFixed(2),
        accounts: mappedAccounts,
      }
    })

    const headOwner = owners.find(o => o.isHeadOfFamily) ?? owners[0]

    // "Combined Family View" only makes sense when there are multiple distinct
    // owners. The JWT isHeadOfFamily flag controls which *query path* we take
    // (group-based vs email-based), but the UI capability should be based on
    // what data actually came back. If multiple owners are found for the same
    // email (e.g. family accounts with mismatched groupids in the DB, or
    // cross-owner accounts like karan), show the combined view regardless of
    // the JWT flag — it just means the DB hasn't been fully normalised yet.
    const hasMultipleOwners = owners.length > 1
    const effectiveIsHoF = hasMultipleOwners
    const effectiveGroupId = hasMultipleOwners ? (headOwner?.groupId ?? null) : null

    return NextResponse.json({
      owners,
      totalPortfolioValue: +totalPortfolioValue.toFixed(2),
      formattedTotal: formatINR(totalPortfolioValue),
      activeAccountCount,
      isHeadOfFamily: effectiveIsHoF,
      groupId: effectiveGroupId,
    })
  } catch (err) {
    console.error('[mobile/portfolio/snapshot]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
