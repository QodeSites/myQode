// GET /api/mobile/primary-ucc
// The "See all your schemes in one place on Nuvama's WealthSpectrum portal" notice, for the mobile app.
// Same logic and response as the web route (app/api/primary-ucc/route.ts), but the investor is identified
// by the verified JWT (email + clientCode) instead of the session cookie. Read-only; nothing is sent to the client.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { fetchSignoffRows, resolvePrimaryUccsByGroup, type ClientRow } from '@/lib/primaryUcc'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  if (user!.isReviewer) return NextResponse.json({ success: true, dataAsOf: null, primaries: [] })

  try {
    const email = String(user!.email || '').trim()
    const clientcode = String(user!.clientCode || '').trim()
    if (!email && !clientcode) return NextResponse.json({ success: true, primaries: [] })

    // Every group this investor belongs to, then every member of those groups —
    // the ladder needs the family's full code set to validate against.
    const { rows: seed } = await query(
      `SELECT DISTINCT groupid FROM pms_clients_master
        WHERE clientcode IS NOT NULL
          AND groupid IS NOT NULL
          AND (lower(email) = lower($1) OR clientcode = $2)`,
      [email, clientcode]
    )
    const groupIds = seed.map((r: any) => String(r.groupid).trim()).filter(Boolean)
    if (groupIds.length === 0) return NextResponse.json({ success: true, primaries: [] })

    const { rows: members } = await query(
      `SELECT clientcode, groupid, groupname, head_of_family
         FROM pms_clients_master
        WHERE groupid = ANY($1) AND clientcode IS NOT NULL`,
      [groupIds]
    )

    const signoff = await fetchSignoffRows()
    const primaries = resolvePrimaryUccsByGroup(members as ClientRow[], signoff)

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
