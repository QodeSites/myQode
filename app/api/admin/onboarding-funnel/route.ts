// Onboarding funnel, split by platform: how many people (distinct emails,
// investors only — distributors excluded) made it through each stage.
//
//   Account created -> Password set -> First login (web) / First login (app)
//
// All real data from pms_clients_master (created_at, password_set_at,
// first_web_login_at, first_app_login_at). No modeling.
import { NextResponse, NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { requireRole, isRoleUser } from "@/lib/adminAuth";

export async function GET(request: NextRequest) {
  // Admin-only. middleware.ts checks the cookie exists but defers
  // validation, so a forged cookie passes it — this validates the session.
  const __admin = await requireRole(request, "analytics");
  if (!isRoleUser(__admin)) return __admin;

  try {
    const result = await query(
      `SELECT
         COUNT(DISTINCT email) AS created,
         COUNT(DISTINCT email) FILTER (WHERE password IS NOT NULL AND password <> 'Qode@123') AS password_set,
         COUNT(DISTINCT email) FILTER (WHERE first_web_login_at IS NOT NULL) AS first_web_login,
         COUNT(DISTINCT email) FILTER (WHERE first_app_login_at IS NOT NULL) AS first_app_login,
         COUNT(DISTINCT email) FILTER (WHERE first_web_login_at IS NOT NULL OR first_app_login_at IS NOT NULL) AS first_login_any
       FROM pms_clients_master
       WHERE clienttype <> 'DISTRIBUTORS' OR clienttype IS NULL`
    )

    const r = result.rows[0]
    return NextResponse.json({
      stages: {
        created:       parseInt(r.created ?? '0'),
        passwordSet:   parseInt(r.password_set ?? '0'),
        firstLoginAny: parseInt(r.first_login_any ?? '0'),
        firstWebLogin: parseInt(r.first_web_login ?? '0'),
        firstAppLogin: parseInt(r.first_app_login ?? '0'),
      },
    })
  } catch (err: any) {
    console.error('[admin/onboarding-funnel]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
