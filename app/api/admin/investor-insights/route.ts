// Cross-cutting insights combining Zoho CRM business context (source, RM,
// AUM, activation date, annual review status) with myQode's real login/
// platform data. Investors only (distributors excluded — see
// client-platform-activity for that distinction).
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getInvestorRecordMap } from '@/lib/zoho'

type Platform = 'never' | 'web' | 'app' | 'both' | 'unclassified'

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export async function GET() {
  try {
    let zohoMap = new Map<string, Awaited<ReturnType<typeof getInvestorRecordMap>> extends Map<string, infer V> ? V : never>()
    try {
      zohoMap = await getInvestorRecordMap()
    } catch (err) {
      console.error('[admin/investor-insights] Zoho fetch failed:', err)
    }

    const result = await query(
      `SELECT DISTINCT ON (m.email)
              m.email,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', m.salutation, m.firstname, m.middlename, m.lastname)), ''), m.clientname) AS name,
              m.clienttype,
              COALESCE(m.login_count, 0)     AS login_count,
              m.last_login_at,
              COALESCE(m.web_login_count, 0) AS web_login_count,
              COALESCE(m.app_login_count, 0) AS app_login_count,
              m.first_web_login_at,
              m.first_app_login_at,
              m.first_login_at
       FROM pms_clients_master m
       ORDER BY m.email, m.head_of_family DESC NULLS LAST, m.clientcode ASC`
    )

    const now = new Date()
    const investors = result.rows
      .filter((r: any) => r.clienttype !== 'DISTRIBUTORS')
      .map((r: any) => {
        const webCount = parseInt(r.web_login_count ?? '0')
        const appCount = parseInt(r.app_login_count ?? '0')
        const loginCount = parseInt(r.login_count ?? '0')
        let platform: Platform
        if (loginCount === 0) platform = 'never'
        else if (webCount > 0 && appCount > 0) platform = 'both'
        else if (webCount > 0) platform = 'web'
        else if (appCount > 0) platform = 'app'
        else platform = 'unclassified'

        // Prefer the platform-specific first-login timestamps (only populated
        // going forward from the OS-split rollout); fall back to the older
        // combined first_login_at where that's all we have. Neither is
        // comprehensive — see onboardingGap.coverage for how much of the
        // activated population this can actually speak to.
        const firstLogins = [r.first_web_login_at, r.first_app_login_at, r.first_login_at].filter(Boolean) as string[]
        const firstLoginAt = firstLogins.length
          ? new Date(firstLogins.sort()[0])
          : null
        const hasLoggedInEver = loginCount > 0

        const zoho = zohoMap.get(String(r.email ?? '').toLowerCase()) ?? null
        const daysSinceLastLogin = r.last_login_at ? daysBetween(new Date(r.last_login_at), now) : null

        return {
          email: r.email,
          name: r.name,
          platform,
          lastLoginAt: r.last_login_at,
          daysSinceLastLogin,
          firstLoginAt,
          hasLoggedInEver,
          zoho,
        }
      })

    // ── 1. Onboarding-to-adoption gap ──────────────────────────────────────
    // Precise day-count needs a real first-login timestamp, which most
    // accounts don't have on record (only ~1/3 of ever-logged-in investors
    // do — see coverage below). "Genuinely never logged in" (loginCount = 0)
    // is reliable for everyone; the day-count itself is a partial sample.
    const withActivation = investors.filter(i => i.zoho?.activated && i.zoho.activationDate)
    const gaps: number[] = []
    const activatedNeverLoggedIn: Array<{ email: string; name: string; activationDate: string; daysSinceActivation: number }> = []
    let loggedInNoTimestamp = 0
    for (const i of withActivation) {
      const activationDate = new Date(i.zoho!.activationDate!)
      if (i.firstLoginAt) {
        gaps.push(daysBetween(activationDate, i.firstLoginAt))
      } else if (i.hasLoggedInEver) {
        loggedInNoTimestamp += 1
      } else {
        activatedNeverLoggedIn.push({
          email: i.email,
          name: i.name,
          activationDate: i.zoho!.activationDate!,
          daysSinceActivation: daysBetween(activationDate, now),
        })
      }
    }
    gaps.sort((a, b) => a - b)
    const onboardingGap = {
      activatedCount: withActivation.length,
      loggedInWithTimestamp: gaps.length,
      loggedInNoTimestamp,
      neverLoggedInCount: activatedNeverLoggedIn.length,
      coverageNote: `Gap-in-days is only computable for ${gaps.length} of ${withActivation.length - activatedNeverLoggedIn.length} activated investors who have logged in — the rest logged in before per-login timestamps were tracked.`,
      avgDays: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
      medianDays: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      activatedNeverLoggedIn: activatedNeverLoggedIn.sort((a, b) => b.daysSinceActivation - a.daysSinceActivation).slice(0, 50),
    }

    // ── 2. Engagement by AUM bucket ─────────────────────────────────────────
    const aumBucketFor = (amount: number | null): string => {
      if (amount == null || amount <= 0) return 'Unknown'
      if (amount < 2_500_000) return '<25L'
      if (amount < 5_000_000) return '25L-50L'
      if (amount < 10_000_000) return '50L-1Cr'
      if (amount < 50_000_000) return '1Cr-5Cr'
      return '5Cr+'
    }
    const aumOrder = ['<25L', '25L-50L', '50L-1Cr', '1Cr-5Cr', '5Cr+', 'Unknown']
    const aumMap = new Map<string, { bucket: string; total: number; web: number; app: number; both: number; never: number; unclassified: number }>()
    for (const i of investors) {
      const amount = i.zoho?.investedAmount ?? i.zoho?.investorSize ?? null
      const bucket = aumBucketFor(amount)
      if (!aumMap.has(bucket)) aumMap.set(bucket, { bucket, total: 0, web: 0, app: 0, both: 0, never: 0, unclassified: 0 })
      const entry = aumMap.get(bucket)!
      entry.total += 1
      entry[i.platform] += 1
    }
    const aumBreakdown = aumOrder.filter(b => aumMap.has(b)).map(b => aumMap.get(b)!)

    // ── 3. RM leaderboard ────────────────────────────────────────────────────
    const rmMap = new Map<string, { rmName: string; total: number; web: number; app: number; both: number; never: number; unclassified: number }>()
    for (const i of investors) {
      const rmName = i.zoho?.ownerName ?? 'Unknown'
      if (!rmMap.has(rmName)) rmMap.set(rmName, { rmName, total: 0, web: 0, app: 0, both: 0, never: 0, unclassified: 0 })
      const entry = rmMap.get(rmName)!
      entry.total += 1
      entry[i.platform] += 1
    }
    const rmLeaderboard = Array.from(rmMap.values())
      .map(r => ({ ...r, engagementRate: r.total > 0 ? Math.round(((r.total - r.never) / r.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)

    // ── 4. Cohort trend by activation month ─────────────────────────────────
    const cohortMap = new Map<string, { month: string; total: number; web: number; app: number; both: number; never: number; unclassified: number }>()
    for (const i of withActivation) {
      const month = i.zoho!.activationDate!.slice(0, 7) // YYYY-MM
      if (!cohortMap.has(month)) cohortMap.set(month, { month, total: 0, web: 0, app: 0, both: 0, never: 0, unclassified: 0 })
      const entry = cohortMap.get(month)!
      entry.total += 1
      entry[i.platform] += 1
    }
    const cohortTrend = Array.from(cohortMap.values())
      .map(c => ({ ...c, engagementRate: c.total > 0 ? Math.round(((c.total - c.never) / c.total) * 100) : 0 }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // ── 5. Annual review due + dormant worklist ─────────────────────────────
    const DORMANT_THRESHOLD_DAYS = 30
    const reviewDueWorklist = investors
      .filter(i => i.zoho?.annualReviewStatus === 'Not Done')
      .filter(i => i.daysSinceLastLogin === null || i.daysSinceLastLogin >= DORMANT_THRESHOLD_DAYS)
      .map(i => ({
        email: i.email,
        name: i.name,
        rmName: i.zoho?.ownerName ?? 'Unknown',
        lastLoginAt: i.lastLoginAt,
        daysSinceLastLogin: i.daysSinceLastLogin,
      }))
      .sort((a, b) => (b.daysSinceLastLogin ?? 9999) - (a.daysSinceLastLogin ?? 9999))

    return NextResponse.json({
      onboardingGap,
      aumBreakdown,
      rmLeaderboard,
      cohortTrend,
      reviewDueWorklist,
    })
  } catch (err: any) {
    console.error('[admin/investor-insights]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
