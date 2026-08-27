import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import { query } from "@/lib/db";

/**
 * Everything the ops console renders, in one request.
 *
 * WHY ONE ENDPOINT RATHER THAN REUSING THE EXISTING ANALYTICS ROUTES
 * The console shows six panels. Fetching them separately means six round
 * trips before the page settles, and each existing route returns a shape
 * built for a different screen. This returns exactly what the console draws,
 * so the page has no client-side reshaping to do and renders in one pass.
 *
 * Distributor rows are excluded from client counts throughout:
 * pms_clients_master holds both, and a distributor is identified by
 * clientcode IS NULL — see lib/distributorIdentity.ts for why that is exact.
 */

type WeekPoint = { week: string; count: number };

export async function GET(request: NextRequest) {
  const admin = await requireRole(request, "console");
  if (!isRoleUser(admin)) return admin;

  try {
    const [
      totals,
      funnelRes,
      familyRes,
      schemeRes,
      loginsRes,
      distributorRes,
    ] = await Promise.all([
      // Headline counts.
      query(
        `SELECT
           count(*) FILTER (WHERE clientcode IS NOT NULL)::int AS accounts,
           count(DISTINCT groupid) FILTER (WHERE groupid IS NOT NULL
             AND clientcode IS NOT NULL)::int AS households,
           count(*) FILTER (WHERE clientcode IS NOT NULL
             AND onboarding_status = 'completed')::int AS completed,
           count(*) FILTER (WHERE clientcode IS NOT NULL
             AND onboarding_status = 'pending')::int AS pending,
           count(*) FILTER (WHERE clientcode IS NOT NULL
             AND last_login_at IS NULL)::int AS never_logged_in
         FROM pms_clients_master`,
      ),

      // Onboarding funnel. Mirrors /api/admin/onboarding-funnel so the two
      // screens cannot disagree: distinct emails, distributors excluded.
      query(
        `SELECT
           count(DISTINCT email)::int AS created,
           count(DISTINCT email) FILTER (WHERE password IS NOT NULL
             AND password <> 'Qode@123')::int AS password_set,
           count(DISTINCT email) FILTER (WHERE first_web_login_at IS NOT NULL
             OR first_app_login_at IS NOT NULL)::int AS first_login,
           count(DISTINCT email) FILTER (WHERE first_web_login_at IS NOT NULL)::int AS web,
           count(DISTINCT email) FILTER (WHERE first_app_login_at IS NOT NULL)::int AS app
         FROM pms_clients_master
         WHERE clienttype <> 'DISTRIBUTORS' OR clienttype IS NULL`,
      ),

      // Multi-account households, and how many still have nobody as head.
      query(
        `SELECT
           count(*)::int AS multi,
           count(*) FILTER (WHERE head_count = 0)::int AS missing_head,
           count(*) FILTER (WHERE head_count > 1)::int AS conflicting
         FROM (
           SELECT groupid,
                  count(*) FILTER (WHERE head_of_family)::int AS head_count
             FROM pms_clients_master
            WHERE groupid IS NOT NULL AND clientcode IS NOT NULL
            GROUP BY groupid
           HAVING count(*) > 1
         ) g`,
      ),

      // Accounts per strategy, from the client code prefix.
      query(
        `SELECT substring(clientcode, 1, 3) AS scheme, count(*)::int AS n
           FROM pms_clients_master
          WHERE clientcode IS NOT NULL
          GROUP BY 1 ORDER BY n DESC`,
      ),

      // Weekly distinct logins over the last 8 weeks.
      query(
        `SELECT to_char(date_trunc('week', last_login_at), 'DD Mon') AS week,
                count(*)::int AS n,
                date_trunc('week', last_login_at) AS bucket
           FROM pms_clients_master
          WHERE last_login_at > now() - interval '8 weeks'
            AND clientcode IS NOT NULL
          GROUP BY bucket
          ORDER BY bucket`,
      ),

      // Client book per distributor. QODE ADVISORS LLP INT is the house
      // account, not a partner, so it is excluded.
      query(
        `SELECT intermediaryname AS name, count(*)::int AS n
           FROM pms_clients_master
          WHERE clientcode IS NOT NULL
            AND intermediaryname IS NOT NULL
            AND intermediaryname <> 'QODE ADVISORS LLP INT'
          GROUP BY 1 ORDER BY n DESC LIMIT 8`,
      ),
    ]);

    const t = totals.rows[0] ?? {};
    const f = funnelRes.rows[0] ?? {};
    const fam = familyRes.rows[0] ?? {};

    const logins: WeekPoint[] = (loginsRes.rows ?? []).map((r: any) => ({
      week: String(r.week),
      count: Number(r.n),
    }));

    // Week-on-week movement, shown on the logins tile. Null when there is no
    // prior week to compare against rather than a fabricated 0%.
    let loginDelta: number | null = null;
    if (logins.length >= 2) {
      const prev = logins[logins.length - 2].count;
      const curr = logins[logins.length - 1].count;
      if (prev > 0) loginDelta = Math.round(((curr - prev) / prev) * 100);
    }

    return NextResponse.json({
      asOf: new Date().toISOString(),
      totals: {
        accounts: Number(t.accounts ?? 0),
        households: Number(t.households ?? 0),
        completed: Number(t.completed ?? 0),
        pending: Number(t.pending ?? 0),
        neverLoggedIn: Number(t.never_logged_in ?? 0),
      },
      funnel: {
        created: Number(f.created ?? 0),
        passwordSet: Number(f.password_set ?? 0),
        firstLogin: Number(f.first_login ?? 0),
        web: Number(f.web ?? 0),
        app: Number(f.app ?? 0),
      },
      families: {
        multiAccount: Number(fam.multi ?? 0),
        missingHead: Number(fam.missing_head ?? 0),
        conflicting: Number(fam.conflicting ?? 0),
      },
      schemes: (schemeRes.rows ?? []).map((r: any) => ({
        scheme: String(r.scheme ?? "—"),
        count: Number(r.n),
      })),
      logins,
      loginDelta,
      distributors: (distributorRes.rows ?? []).map((r: any) => ({
        name: String(r.name),
        count: Number(r.n),
      })),
    });
  } catch (error) {
    console.error("[admin/console] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
