// One row per distinct onboarded client (password set, i.e. not the default
// 'Qode@123') — used by the App Analytics tab's contact list.
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
              groupid
       FROM pms_clients_master
       WHERE password IS NOT NULL AND password <> 'Qode@123'
       ORDER BY email, head_of_family DESC NULLS LAST, clientcode ASC`
    )

    return NextResponse.json({ clients: result.rows, total: result.rows.length })
  } catch (err: any) {
    console.error('[admin/onboarded-clients]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
