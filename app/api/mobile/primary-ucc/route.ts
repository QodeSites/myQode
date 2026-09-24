// GET /api/mobile/primary-ucc
// ----------------------------------------------------------------------------
// Mobile counterpart of /api/primary-ucc. Same resolution ladder (see
// lib/primaryUcc.ts), but authenticated by Bearer JWT rather than the web
// session cookie, so the mobile app can show the same notice.
//
// The client sends no identifiers: the groups come from the verified token,
// so one investor cannot request another family's primary code.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import {
  fetchSignoffRows,
  resolvePrimaryUccsByGroup,
  type ClientRow,
} from '@/lib/primaryUcc'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  // Virtual accounts (demo reviewer, admin) have no real family to resolve.
  if (user!.isReviewer || user!.isSuperAdmin) {
    return NextResponse.json({ success: true, dataAsOf: null, primaries: [] })
  }

  try {
    const email = (user!.email || '').trim()
    const codes = [user!.clientCode, ...(user!.accountCodes || [])]
      .map((c) => (c || '').trim())
      .filter(Boolean)

    if (!email && codes.length === 0) {
      return NextResponse.json({ success: true, primaries: [] })
    }

    // Find every group this investor belongs to — by email or by any account
    // code on the token — then every member of those groups, since the ladder
    // validates candidates against the family's full set of codes.
    const { rows: seed } = await query(
      `SELECT DISTINCT groupid FROM pms_clients_master
        WHERE clientcode IS NOT NULL
          AND groupid IS NOT NULL
          AND (lower(email) = lower($1) OR clientcode = ANY($2))`,
      [email, codes]
    )

    const groupIds = seed
      .map((r: any) => String(r.groupid).trim())
      .filter(Boolean)
    if (groupIds.length === 0) {
      return NextResponse.json({ success: true, primaries: [] })
    }

    const { rows: members } = await query(
      `SELECT clientcode, groupid, groupname, head_of_family
         FROM pms_clients_master
        WHERE groupid = ANY($1) AND clientcode IS NOT NULL`,
      [groupIds]
    )

    const signoff = await fetchSignoffRows()
    const primaries = resolvePrimaryUccsByGroup(members as ClientRow[], signoff)

    // Nuvama downtime means portfolio figures lag live markets, so the notice
    // states the date the data is current to. Non-fatal if this query fails.
    let dataAsOf: string | null = null
    try {
      const { rows } = await query(`SELECT to_char(max(report_date), 'YYYY-MM-DD') AS latest FROM pms_master_sheet`, [])
      if (rows?.[0]?.latest) dataAsOf = String(rows[0].latest)
    } catch {
      // Non-fatal: the notice simply omits the as-of line.
    }

    const nameByGroup = new Map<string, string>()
    for (const m of members as any[]) {
      const g = String(m.groupid || '').trim()
      if (g && !nameByGroup.has(g)) nameByGroup.set(g, m.groupname || '')
    }

    return NextResponse.json({
      success: true,
      dataAsOf,
      primaries: primaries.map((p) => ({
        uccCode: p.uccCode,
        strategy: p.strategy,
        groupName: nameByGroup.get(p.groupid) || null,
      })),
    })
  } catch (err) {
    // Advisory notice only — never break the dashboard because the feed is down.
    console.error('[mobile/primary-ucc]', err)
    return NextResponse.json({ success: false, primaries: [] })
  }
}
