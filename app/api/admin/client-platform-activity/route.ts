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

export async function GET() {
  try {
    const result = await query(
      `SELECT DISTINCT ON (email)
              email,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', salutation, firstname, middlename, lastname)), ''), clientname) AS name,
              mobile,
              clientcode,
              clienttype,
              (password IS NOT NULL AND password <> 'Qode@123') AS password_set,
              COALESCE(login_count, 0)      AS login_count,
              last_login_at,
              COALESCE(web_login_count, 0)  AS web_login_count,
              COALESCE(app_login_count, 0)  AS app_login_count,
              last_web_login_at,
              last_app_login_at
       FROM pms_clients_master
       ORDER BY email, head_of_family DESC NULLS LAST, clientcode ASC`
    )

    const clients = result.rows.map((r: any) => {
      const webCount = parseInt(r.web_login_count ?? '0')
      const appCount = parseInt(r.app_login_count ?? '0')
      const loginCount = parseInt(r.login_count ?? '0')
      const isDistributor = r.clienttype === 'DISTRIBUTORS'

      let platform: 'never' | 'web' | 'app' | 'both' | 'unclassified'
      if (loginCount === 0) platform = 'never'
      else if (webCount > 0 && appCount > 0) platform = 'both'
      else if (webCount > 0) platform = 'web'
      else if (appCount > 0) platform = 'app'
      else platform = 'unclassified' // real logins happened before platform tracking existed

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
        lastWebLoginAt: r.last_web_login_at,
        lastAppLoginAt: r.last_app_login_at,
        platform,
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

    return NextResponse.json({ clients, summary })
  } catch (err: any) {
    console.error('[admin/client-platform-activity]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
