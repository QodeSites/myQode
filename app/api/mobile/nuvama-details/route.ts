// GET /api/mobile/nuvama-details
// What Nuvama (the custodian) holds for the signed-in investor, so they can check it: the primary UCC to sign in
// to WealthSpectrum with, each account (UCC, scheme, type, dates, RM, distributor), the registered contact details
// and the registered bank account. Only the accounts on the token; PAN, mobile and bank account are masked.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { query as query1 } from '@/lib/db1'
import { fetchSignoffRows, resolvePrimaryUccsByGroup, type ClientRow } from '@/lib/primaryUcc'

const WEALTHSPECTRUM_URL = 'https://eclientreporting.nuvamaassetservices.com/wealthspectrum/app/'

const tail = (v: unknown, keep = 4) => {
  const s = String(v ?? '').trim()
  if (!s) return null
  return s.length <= keep ? s : '•'.repeat(Math.min(6, s.length - keep)) + s.slice(-keep)
}
const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null)
const name = (r: any) => [r.salutation, r.firstname, r.middlename, r.lastname].filter(Boolean).join(' ').trim() || r.clientname || r.ownername || null

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer || user!.isSuperAdmin || user!.isDistributor) {
    return NextResponse.json({ success: true, portalUrl: WEALTHSPECTRUM_URL, primary: null, dataAsOf: null, accounts: [], holders: [], banks: [] })
  }

  try {
    const codes = [user!.clientCode, ...(user!.accountCodes || [])].map(c => String(c || '').trim()).filter(Boolean)
    const { rows } = await query(
      `SELECT clientcode, clientname, clienttype, accounttype, account_open_date, inceptiondate, maturity_date,
              schemename, advisorname, intermediaryname, groupid, groupname, ownername, head_of_family,
              salutation, firstname, middlename, lastname, email, mobile, city, state, pincode, pannumber
         FROM pms_clients_master
        WHERE clientcode = ANY($1::text[])
        ORDER BY head_of_family DESC NULLS LAST, clientcode`, [codes])

    const accounts = rows.map((r: any) => ({
      code: r.clientcode,
      holder: name(r),
      scheme: r.schemename || null,
      accountType: r.accounttype || r.clienttype || null,
      openedOn: day(r.account_open_date),
      inceptionDate: day(r.inceptiondate),
      maturityDate: day(r.maturity_date),
      active: !r.maturity_date || new Date(r.maturity_date) > new Date(),
      rm: r.advisorname || null,
      distributor: r.intermediaryname || null,
      family: r.groupname || null,
    }))

    // One entry per holder (PAN, or name when PAN is missing): the contact details Nuvama has on record.
    const byHolder = new Map<string, any>()
    for (const r of rows as any[]) {
      const key = String(r.pannumber || name(r) || r.clientcode).toUpperCase()
      const h = byHolder.get(key) || {
        name: name(r), pan: tail(r.pannumber), email: r.email || null, mobile: tail(r.mobile),
        city: r.city || null, state: r.state || null, pincode: r.pincode || null, accounts: [] as string[],
      }
      h.accounts.push(r.clientcode)
      byHolder.set(key, h)
    }

    // Registered bank accounts (db1), masked.
    let banks: any[] = []
    try {
      const b = await query1(
        `SELECT nuvama_code, account_number, ifsc_code, verification_status, updated_at
           FROM pms_clients_tracker.pms_clients_bank_details WHERE nuvama_code = ANY($1::text[])`, [rows.map((r: any) => r.clientcode)])
      banks = b.rows.map((x: any) => ({ code: x.nuvama_code, account: tail(x.account_number), ifsc: x.ifsc_code || null, status: x.verification_status || null, updatedAt: day(x.updated_at) }))
    } catch { /* bank details are optional */ }

    // Primary UCC for WealthSpectrum (same rule as /api/mobile/primary-ucc).
    let primary: { uccCode: string; strategy: string | null; groupName: string | null } | null = null
    let dataAsOf: string | null = null
    try {
      const groupIds = [...new Set(rows.map((r: any) => String(r.groupid || '').trim()).filter(Boolean))]
      if (groupIds.length) {
        const { rows: members } = await query(
          `SELECT clientcode, groupid, groupname, head_of_family FROM pms_clients_master WHERE groupid = ANY($1) AND clientcode IS NOT NULL`, [groupIds])
        const p = resolvePrimaryUccsByGroup(members as ClientRow[], await fetchSignoffRows())[0]
        if (p) primary = { uccCode: p.uccCode, strategy: p.strategy || null, groupName: (members as any[]).find(m => String(m.groupid) === String(p.groupid))?.groupname || null }
      }
      const d = await query(`SELECT to_char(max(report_date), 'YYYY-MM-DD') AS latest FROM pms_master_sheet`, [])
      dataAsOf = d.rows?.[0]?.latest || null
    } catch { /* advisory only */ }

    return NextResponse.json({ success: true, portalUrl: WEALTHSPECTRUM_URL, primary, dataAsOf, accounts, holders: [...byHolder.values()], banks })
  } catch (err) {
    console.error('[mobile/nuvama-details]', err)
    return NextResponse.json({ error: 'Could not load your Nuvama details' }, { status: 500 })
  }
}
