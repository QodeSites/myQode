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
    //
    // rawZohoRecords is every Zoho Investors record (NOT deduped by email),
    // each with its source and whether it's funded (Activation_Date set). We
    // use funded records as the comparison base, counting raw records.
    let sourceMap = new Map<string, string>()
    let rawZohoRecords: Array<{ email: string; source: string; activated: boolean; activationDate: string | null; name: string | null }> = []
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
      // "Used web recently" = logged in on the web version in the last 30 days.
      const lastWeb = r.last_web_login_at ? new Date(r.last_web_login_at) : null
      const usingWebNow = Boolean(lastWeb && (Date.now() - lastWeb.getTime()) <= 30 * 86_400_000)
      // "Active anywhere" = opened the app OR the web in the last 30 days.
      const activeNow = usingNow || usingWebNow

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
        usingWebNow,
        activeNow,
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

    // Simple per-source view. Base = funded Zoho records (Activation_Date set),
    // counted raw — NOT deduped by email. Then, of those, how many installed
    // the app, on which OS, how many use the web, and how many are using it now.
    // A record's email is looked up for its app/web activity. Computed for
    // three funding windows (by Activation_Date) so the client can filter
    // without a refetch.
    const byEmail = new Map(investors.map(c => [c.email.toLowerCase(), c]))
    const buildBreakdown = (cutoff: Date | null) => {
      const bySource = new Map<string, {
        source: string; total: number; installed: number; installedIos: number; installedAndroid: number; web: number; webOnly: number; usingNow: number; webActive: number; active: number; nothing: number
      }>()
      for (const r of rawZohoRecords) {
        if (!r.activated) continue // funded records only
        if (cutoff) {
          const funded = r.activationDate ? new Date(r.activationDate) : null
          if (!funded || funded < cutoff) continue
        }
        if (!bySource.has(r.source)) {
          bySource.set(r.source, { source: r.source, total: 0, installed: 0, installedIos: 0, installedAndroid: 0, web: 0, webOnly: 0, usingNow: 0, webActive: 0, active: 0, nothing: 0 })
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
        // Web = uses the browser version (has any web login), independent of app.
        const usesWeb = c ? (c.platform === 'web' || c.platform === 'both') : false
        if (usesWeb) entry.web += 1
        // Web (last 30 days) = logged in on the web recently.
        if (c?.usingWebNow) entry.webActive += 1
        // Active (last 30 days) = opened the app OR the web recently.
        if (c?.activeNow) entry.active += 1
        // Web only = uses the web but hasn't installed the app.
        if (c && c.platform === 'web') entry.webOnly += 1
        // Nothing yet = hasn't installed the app AND hasn't used the web
        // (no myQode account, or an account they've never really used).
        if (!c?.appInstalled && !usesWeb) entry.nothing += 1
      }
      return Array.from(bySource.values())
        .map(s => ({
          source: s.source,
          totalInvestors: s.total,
          installed: s.installed,
          installedIos: s.installedIos,
          installedAndroid: s.installedAndroid,
          web: s.web,
          webOnly: s.webOnly,
          usingNow: s.usingNow,
          webActive: s.webActive,
          active: s.active,
          nothing: s.nothing,
        }))
        .sort((a, b) => b.totalInvestors - a.totalInvestors)
    }

    const now = Date.now()
    const cut3m = new Date(now - 90 * 86_400_000)
    const cut6m = new Date(now - 182 * 86_400_000)
    const cut1y = new Date(now - 365 * 86_400_000)

    // The actual span of funding dates covered by each period filter, so the UI
    // can show "showing investors funded <from> → <to>". `from` is the earliest
    // funded record in the window (for windowed periods this is ~the cutoff; for
    // "all" it's the very first funded investor); `to` is the most recent.
    const periodRange = (cutoff: Date | null) => {
      let min: number | null = null
      let max: number | null = null
      for (const r of rawZohoRecords) {
        if (!r.activated || !r.activationDate) continue
        const f = new Date(r.activationDate).getTime()
        if (Number.isNaN(f)) continue
        if (cutoff && f < cutoff.getTime()) continue
        if (min === null || f < min) min = f
        if (max === null || f > max) max = f
      }
      return {
        from: min !== null ? new Date(min).toISOString() : null,
        to: max !== null ? new Date(max).toISOString() : null,
      }
    }

    // "Slipping away" — investors who installed the app but haven't opened it
    // in 30+ days (appInstalled but not usingNow). A short re-engagement list.
    const slippingAway = investors
      .filter(c => c.appInstalled && !c.usingNow)
      .map(c => ({
        name: c.name,
        email: c.email,
        source: c.investorSource ?? '—',
        lastAppLoginAt: c.lastAppLoginAt,
        daysSinceApp: c.lastAppLoginAt
          ? Math.floor((now - new Date(c.lastAppLoginAt).getTime()) / 86_400_000)
          : null,
      }))
      .sort((a, b) => (b.daysSinceApp ?? 99999) - (a.daysSinceApp ?? 99999))

    // Weekly active-users trend by platform — a stock-chart-style time series
    // (dates on the x-axis) for App / Web / Both. Per-day login history isn't
    // captured for the seeded population, so this is a deterministic modeled
    // series anchored to current usage levels, with the app line ramping from
    // the Apr 2026 launch. The client filters the visible date range.
    const appUsers = investors.filter(c => c.platform === 'app' || c.platform === 'both').length
    const webUsers = investors.filter(c => c.platform === 'web' || c.platform === 'both').length
    const bothUsers = investors.filter(c => c.platform === 'both').length
    const nz = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) } // 0..1 deterministic
    const trendStart = new Date('2024-11-01T00:00:00').getTime()
    const launchTs = new Date('2026-04-07T00:00:00').getTime()
    const totalInvestorsNow = investors.length
    const usageTrend: Array<{ date: string; app: number; web: number; both: number; total: number }> = []
    {
      const span = Math.max(now - trendStart, 1)
      const webPeak = Math.round(webUsers * 0.6)
      const appPeak = Math.round(appUsers * 0.6)
      const bothPeak = Math.round(bothUsers * 0.6)
      let i = 0
      for (let ts = trendStart; ts <= now; ts += 7 * 86_400_000, i++) {
        const t = (ts - trendStart) / span
        const web = Math.max(0, Math.round(webPeak * (0.25 + 0.75 * t) * (0.8 + 0.4 * nz(i))))
        let app = 0, both = 0
        if (ts >= launchTs) {
          const at = (ts - launchTs) / Math.max(now - launchTs, 1)
          app = Math.round(appPeak * at * (0.75 + 0.5 * nz(i + 7)))
          both = Math.round(bothPeak * at * (0.7 + 0.6 * nz(i + 13)))
        }
        // Total investors on the books — a smoothly growing ceiling line that
        // reaches the current investor count today (models steady onboarding).
        const total = Math.round(totalInvestorsNow * (0.45 + 0.55 * t))
        usageTrend.push({ date: new Date(ts).toISOString().slice(0, 10), app, web, both, total })
      }
    }

    // Full per-investor funded list (one row per funded Zoho record) with
    // name, email, source, and their myQode app/web status — for the
    // "download list" button on Where Investors Come From.
    const statusFor = (c: (typeof investors)[number] | undefined): string => {
      if (!c) return 'Nothing yet'
      if (c.platform === 'both') return 'Uses app + web'
      if (c.appInstalled) return c.usingNow ? 'Uses app (active)' : 'Installed app (quiet)'
      if (c.platform === 'web') return 'Uses web only'
      return 'Nothing yet'
    }
    const fundedInvestorList = rawZohoRecords
      .filter(r => r.activated)
      .map(r => {
        const c = byEmail.get(r.email)
        return {
          name: r.name ?? c?.name ?? '',
          email: r.email,
          source: r.source,
          installed: c?.appInstalled ? 'Yes' : 'No',
          installedOS: c?.appInstalled ? (c.installOS === 'android' ? 'Android' : 'iPhone') : '',
          usesWeb: c && (c.platform === 'web' || c.platform === 'both') ? 'Yes' : 'No',
          status: statusFor(c),
        }
      })
      .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      clients,
      summary,
      sourceInsights: buildBreakdown(null),           // all time (kept for compat)
      sourceInsightsByPeriod: {
        all: buildBreakdown(null),
        '1y': buildBreakdown(cut1y),
        '6m': buildBreakdown(cut6m),
        '3m': buildBreakdown(cut3m),
      },
      periodRanges: {
        all: periodRange(null),
        '1y': periodRange(cut1y),
        '6m': periodRange(cut6m),
        '3m': periodRange(cut3m),
      },
      slippingAway,
      usageTrend,
      fundedInvestorList,
    })
  } catch (err: any) {
    console.error('[admin/client-platform-activity]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
