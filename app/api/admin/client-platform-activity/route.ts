// Per-client login activity, one row per distinct email, real data only
// (no modeling/estimation here — see the onboarding page for the separate
// one-time estimated snapshot).
//
// Buckets each person into exactly one of:
//   - never        no login recorded at all (login_count = 0)
//   - web          only web_login_count > 0
//   - app          only app_login_count > 0
//   - both         both > 0
//   - unclassified logged in before platform-split tracking existed
//                  (login_count > 0 but web/app counters are still 0)
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getInvestorSourceMap, getZohoSourceTotals } from '@/lib/zoho'

export async function GET() {
  try {
    // Zoho CRM's Investor_Source per email — best-effort. A Zoho hiccup
    // shouldn't take down the whole dashboard, so this degrades to "unknown"
    // per client rather than failing the request.
    let sourceMap = new Map<string, string>()
    let zohoSourceTotals: Array<{ source: string; zohoTotal: number; zohoActivated: number }> = []
    try {
      sourceMap = await getInvestorSourceMap()
      zohoSourceTotals = await getZohoSourceTotals()
    } catch (err) {
      console.error('[admin/client-platform-activity] Zoho source fetch failed:', err)
    }

    const result = await query(
      `SELECT DISTINCT ON (m.email)
              m.email,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', m.salutation, m.firstname, m.middlename, m.lastname)), ''), m.clientname) AS name,
              m.mobile,
              m.clientcode,
              m.clienttype,
              (m.password IS NOT NULL AND m.password <> 'Qode@123') AS password_set,
              COALESCE(m.login_count, 0)      AS login_count,
              m.last_login_at,
              COALESCE(m.web_login_count, 0)  AS web_login_count,
              COALESCE(m.app_login_count, 0)  AS app_login_count,
              COALESCE(m.ios_login_count, 0)     AS ios_login_count,
              COALESCE(m.android_login_count, 0) AS android_login_count,
              m.last_web_login_at,
              m.last_app_login_at,
              m.last_ios_login_at,
              m.last_android_login_at,
              pt.platform  AS push_platform,
              pt.updated_at AS push_updated_at
       FROM pms_clients_master m
       LEFT JOIN LATERAL (
         SELECT platform, updated_at
         FROM client_push_tokens t
         WHERE t.client_id = m.clientid AND t.is_active = TRUE
         ORDER BY t.updated_at DESC
         LIMIT 1
       ) pt ON TRUE
       ORDER BY m.email, m.head_of_family DESC NULLS LAST, m.clientcode ASC`
    )

    const clients = result.rows.map((r: any) => {
      const webCount = parseInt(r.web_login_count ?? '0')
      const appCount = parseInt(r.app_login_count ?? '0')
      const iosCount = parseInt(r.ios_login_count ?? '0')
      const androidCount = parseInt(r.android_login_count ?? '0')
      const loginCount = parseInt(r.login_count ?? '0')
      const isDistributor = r.clienttype === 'DISTRIBUTORS'

      let platform: 'never' | 'web' | 'app' | 'both' | 'unclassified'
      if (loginCount === 0) platform = 'never'
      else if (webCount > 0 && appCount > 0) platform = 'both'
      else if (webCount > 0) platform = 'web'
      else if (appCount > 0) platform = 'app'
      else platform = 'unclassified' // real logins happened before platform tracking existed

      // App-side OS split — only meaningful once appCount > 0. 'unclassified'
      // means app logins exist but predate this OS-split rollout (or the
      // client didn't report a recognized Platform.OS).
      let appOS: 'ios' | 'android' | 'both' | 'unclassified' | null = null
      if (appCount > 0) {
        if (iosCount > 0 && androidCount > 0) appOS = 'both'
        else if (iosCount > 0) appOS = 'ios'
        else if (androidCount > 0) appOS = 'android'
        else appOS = 'unclassified'
      }

      return {
        email: r.email,
        name: r.name,
        mobile: r.mobile,
        clientcode: r.clientcode,
        accountType: isDistributor ? 'distributor' : 'investor',
        passwordSet: r.password_set,
        loginCount,
        lastLoginAt: r.last_login_at,
        webLoginCount: webCount,
        appLoginCount: appCount,
        iosLoginCount: iosCount,
        androidLoginCount: androidCount,
        lastWebLoginAt: r.last_web_login_at,
        lastAppLoginAt: r.last_app_login_at,
        lastIosLoginAt: r.last_ios_login_at,
        lastAndroidLoginAt: r.last_android_login_at,
        platform,
        appOS,
        // Real signal from client_push_tokens: an active token means Expo
        // hasn't seen a "DeviceNotRegistered" (uninstall) error for it yet.
        appInstalled: r.push_platform != null,
        installedOS: r.push_platform ?? null,
        investorSource: sourceMap.get(String(r.email ?? '').toLowerCase()) ?? null,
      }
    })

    const investors = clients.filter(c => c.accountType === 'investor')
    const distributors = clients.filter(c => c.accountType === 'distributor')

    const bucket = (list: typeof clients) => ({
      total: list.length,
      never: list.filter(c => c.platform === 'never').length,
      web: list.filter(c => c.platform === 'web').length,
      app: list.filter(c => c.platform === 'app').length,
      both: list.filter(c => c.platform === 'both').length,
      unclassified: list.filter(c => c.platform === 'unclassified').length,
      totalWebLogins: list.reduce((s, c) => s + c.webLoginCount, 0),
      totalAppLogins: list.reduce((s, c) => s + c.appLoginCount, 0),
      iosOnly: list.filter(c => c.appOS === 'ios').length,
      androidOnly: list.filter(c => c.appOS === 'android').length,
      bothOS: list.filter(c => c.appOS === 'both').length,
      unclassifiedOS: list.filter(c => c.appOS === 'unclassified').length,
      appInstalled: list.filter(c => c.appInstalled).length,
      appInstalledIos: list.filter(c => c.appInstalled && c.installedOS === 'ios').length,
      appInstalledAndroid: list.filter(c => c.appInstalled && c.installedOS === 'android').length,
    })

    // Top-level summary covers everyone (kept for backward compatibility);
    // investors/distributors are broken out separately since distributor
    // accounts represent firms, not individual clients, and shouldn't be
    // read as investor engagement.
    const summary = {
      ...bucket(clients),
      investors: bucket(investors),
      distributors: bucket(distributors),
    }

    // Which Investor_Source brings the most web/app users — investors only.
    const bySource = new Map<string, { source: string; web: number; app: number; both: number; never: number; unclassified: number; total: number }>()
    for (const c of investors) {
      const key = c.investorSource ?? 'Unknown (not in Zoho)'
      if (!bySource.has(key)) {
        bySource.set(key, { source: key, web: 0, app: 0, both: 0, never: 0, unclassified: 0, total: 0 })
      }
      const entry = bySource.get(key)!
      entry.total += 1
      entry[c.platform] += 1
    }
    const sourceBreakdown = Array.from(bySource.values()).sort((a, b) => b.total - a.total)

    // Reconciliation: Zoho's raw per-source totals (independent of whether a
    // matching myQode account exists) vs. how many of those actually have one.
    // zohoActivated is Zoho's own "reached the funding/conversion milestone"
    // marker (Activation_Date set) — NOT the same thing as myqodeMatched.
    const myqodeBySource = new Map(sourceBreakdown.map(s => [s.source, s.total]))
    const sourceReconciliation = zohoSourceTotals.map(z => ({
      source: z.source,
      zohoTotal: z.zohoTotal,
      zohoActivated: z.zohoActivated,
      myqodeMatched: myqodeBySource.get(z.source) ?? 0,
    })).sort((a, b) => b.zohoTotal - a.zohoTotal)

    return NextResponse.json({ clients, summary, sourceBreakdown, sourceReconciliation })
  } catch (err: any) {
    console.error('[admin/client-platform-activity]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
