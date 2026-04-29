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
    const result = await query(
      `SELECT
         clientname  AS name,
         email,
         clientcode  AS "clientCode",
         schemename  AS "schemeName",
         ownerid     AS "ownerId"
       FROM pms_clients_master
       WHERE clienttype = 'Discretionary'
         AND email IS NOT NULL
         AND email <> ''
         AND clientcode IS NOT NULL
         AND clientcode <> ''
       ORDER BY clientname ASC`,
      []
    )

    return NextResponse.json({ clients: result.rows })
  } catch (err) {
    console.error('[dev/clients] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
