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

    const summary = {
      total: clients.length,
      never: clients.filter(c => c.platform === 'never').length,
      web: clients.filter(c => c.platform === 'web').length,
      app: clients.filter(c => c.platform === 'app').length,
      both: clients.filter(c => c.platform === 'both').length,
      unclassified: clients.filter(c => c.platform === 'unclassified').length,
      totalWebLogins: clients.reduce((s, c) => s + c.webLoginCount, 0),
      totalAppLogins: clients.reduce((s, c) => s + c.appLoginCount, 0),
    }

    return NextResponse.json({ clients, summary })
  } catch (err: any) {
    console.error('[admin/client-platform-activity]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
