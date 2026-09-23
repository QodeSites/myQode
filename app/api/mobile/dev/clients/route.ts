// GET /api/mobile/dev/clients
// Returns a lightweight client list for the dev login picker.
// ⚠️  ONLY available in development — returns 404 in production.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    // Only accounts worth signing in as: live strategy accounts (QAW / QTF / QGF) that have portfolio rows with
    // value. Legacy QFH codes, closed and never-funded accounts are left out — signing in as one of them shows
    // an empty dashboard, which is never what a tester wants.
    const result = await query(
      `SELECT
         c.clientname  AS name,
         c.email,
         c.clientcode  AS "clientCode",
         c.schemename  AS "schemeName",
         c.ownerid     AS "ownerId"
       FROM pms_clients_master c
       WHERE c.clienttype = 'Discretionary'
         AND c.email IS NOT NULL
         AND c.email <> ''
         AND c.clientcode ~ '^Q(AW|TF|GF)[0-9]'
         AND EXISTS (
           SELECT 1 FROM pms_master_sheet m
            WHERE m.account_code = c.clientcode
              AND m.portfolio_value > 0
              AND m.report_date >= CURRENT_DATE - INTERVAL '45 days'
         )
       ORDER BY c.clientname ASC`,
      []
    )

    return NextResponse.json({ clients: result.rows })
  } catch (err) {
    console.error('[dev/clients] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
