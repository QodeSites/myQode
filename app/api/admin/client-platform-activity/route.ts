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
import { getInvestorSourceMap, getRawInvestorRecords } from '@/lib/zoho'

export async function GET() {
  try {
    // Zoho CRM's Investor_Source per email — best-effort. A Zoho hiccup
    // shouldn't take down the whole dashboard, so this degrades to "unknown"
    // per client rather than failing the request.
    let sourceMap = new Map<string, string>()
    let rawZohoRecords: Array<{ email: string; source: string; activated: boolean }> = []
    try {
      sourceMap = await getInvestorSourceMap()
      rawZohoRecords = await getRawInvestorRecords()
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

      // "Installed the app" = has any app login history (they downloaded it
      // and opened it). Its OS comes from the iOS/Android login split.
      // (Push tokens can't be the install signal — Android can't register a
      // token until a new Android build ships, so it would always read 0.)
      const appInstalled = appCount > 0
      const installOS: 'ios' | 'android' | null =
        !appInstalled ? null : (androidCount > iosCount ? 'android' : 'ios')
      // "Using it now" = opened the app in the last 30 days.
      const lastApp = r.last_app_login_at ? new Date(r.last_app_login_at) : null
      const usingNow = Boolean(lastApp && (Date.now() - lastApp.getTime()) <= 30 * 86_400_000)

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
        appInstalled,
        installOS,
        usingNow,
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
      // Simple "installed / using" model
      installed: list.filter(c => c.appInstalled).length,
      installedIos: list.filter(c => c.appInstalled && c.installOS === 'ios').length,
      installedAndroid: list.filter(c => c.appInstalled && c.installOS === 'android').length,
      usingNow: list.filter(c => c.usingNow).length,
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

    // Simple per-source view: total investors from Zoho (raw record count,
    // matching Zoho directly), how many installed the app, how many use it now.
    // App activity is looked up by email; a shared family email's activity is
    // attributed to each Zoho record under it.
    const byEmail = new Map(investors.map(c => [c.email.toLowerCase(), c]))
    const bySource = new Map<string, {
      source: string; total: number; installed: number; installedIos: number; installedAndroid: number; usingNow: number
    }>()
    for (const r of rawZohoRecords) {
      if (!bySource.has(r.source)) {
        bySource.set(r.source, { source: r.source, total: 0, installed: 0, installedIos: 0, installedAndroid: 0, usingNow: 0 })
      }
      const entry = bySource.get(r.source)!
      entry.total += 1
      const c = byEmail.get(r.email)
      if (c?.appInstalled) {
        entry.installed += 1
        if (c.installOS === 'ios') entry.installedIos += 1
        else if (c.installOS === 'android') entry.installedAndroid += 1
        if (c.usingNow) entry.usingNow += 1
      }
    }

    const sourceInsights = Array.from(bySource.values()).map(s => ({
      source: s.source,
      totalInvestors: s.total,
      installed: s.installed,
      installedIos: s.installedIos,
      installedAndroid: s.installedAndroid,
      usingNow: s.usingNow,
    })).sort((a, b) => b.totalInvestors - a.totalInvestors)

    return NextResponse.json({ clients, summary, sourceInsights })
  } catch (err: any) {
    console.error('[admin/client-platform-activity]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
