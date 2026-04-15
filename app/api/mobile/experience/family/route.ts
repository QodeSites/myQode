// GET /api/mobile/experience/family
// Returns the full family tree structure for the logged-in user.
// Includes group, owner, account levels with relations, contacts, and status.
// Used by the Family Account / Account Management screen.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'

function sanitizeName(name: string | null | undefined): string {
  if (!name || name === 'null' || name.includes('null')) {
    return name?.replace(/\s*null\s*/g, '').trim() || 'Unknown'
  }
  return name.trim()
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const email = user!.email

    // Fetch all client codes for this email
    const clientCodesResult = await query(
      `SELECT clientcode FROM pms_clients_master WHERE email = $1`,
      [email]
    )

    const clientCodes = clientCodesResult.rows.map((r: any) => r.clientcode)

    if (!clientCodes.length) {
      return NextResponse.json({
        isHeadOfFamily: false,
        groupId: null,
        groupName: null,
        tree: [],
        flatMembers: [],
        totalMembers: 0,
      })
    }

    // Fetch full details for all accounts belonging to this email
    const allClientDetailsResult = await query(
      `SELECT id, clientid, clientcode, email, mobile,
              groupid, groupname, ownerid, ownername,
              salutation, firstname, middlename, lastname,
              address1, city, state, pannumber,
              head_of_family, onboarding_status
       FROM pms_clients_master
       WHERE clientcode = ANY($1::text[])`,
      [clientCodes]
    )

    const allClientDetails: any[] = allClientDetailsResult.rows

    // Overall HoF flag (used for response metadata)
    const finalIsHeadOfFamily = allClientDetails.some((c: any) => c.head_of_family === true)

    // Collect all distinct groupIds this email belongs to
    const groupIds = Array.from(
      new Set(allClientDetails.map((c: any) => c.groupid).filter(Boolean))
    )

    // For each group, apply per-group HoF logic to collect visible members
    const familyMemberRows: any[] = []
    for (const gid of groupIds) {
      const emailRowsForGroup = allClientDetails.filter((c: any) => c.groupid === gid)
      const canSeeFullGroup = emailRowsForGroup.some((c: any) => c.head_of_family === true)

      if (!canSeeFullGroup) {
        // Not HoF in this group — only include the user's own accounts
        familyMemberRows.push(...emailRowsForGroup)
        continue
      }

      // HoF — fetch all members of this group
      const familyClientCodesResult = await query(
        `SELECT clientcode
         FROM pms_clients_master
         WHERE groupid = $1
         ORDER BY head_of_family DESC, firstname ASC`,
        [gid]
      )

      const familyCodes = familyClientCodesResult.rows.map((r: any) => r.clientcode)
      if (!familyCodes.length) continue

      const familyResult = await query(
        `SELECT id, clientid, clientcode, email, mobile,
                groupid, groupname, ownerid, ownername,
                salutation, firstname, middlename, lastname,
                address1, city, state, pannumber,
                head_of_family, onboarding_status
         FROM pms_clients_master
         WHERE clientcode = ANY($1::text[])`,
        [familyCodes]
      )

      const familyMap = new Map(familyResult.rows.map((m: any) => [m.clientcode, m]))
      const ordered = familyCodes.map((code: string) => familyMap.get(code)).filter(Boolean)
      familyMemberRows.push(...ordered)
    }

    // Dedup by clientcode (a member may appear in multiple groups' results)
    const seenCodes = new Set<string>()
    const uniqueMembers = familyMemberRows.filter((m: any) => {
      if (seenCodes.has(m.clientcode)) return false
      seenCodes.add(m.clientcode)
      return true
    })

    const uniqueMemberCodes = uniqueMembers.map((m: any) => m.clientcode)

    // Fetch latest portfolio_value to determine Active/Closed status
    const portfolioMap = new Map<string, number>()
    if (uniqueMemberCodes.length > 0) {
      const pmsResult = await query(
        `SELECT DISTINCT ON (account_code)
                account_code,
                portfolio_value
         FROM public.pms_master_sheet
         WHERE account_code = ANY($1::text[])
         ORDER BY account_code, id DESC`,
        [uniqueMemberCodes]
      )
      ;(pmsResult.rows || []).forEach((row: any) => {
        portfolioMap.set(row.account_code, Number(row.portfolio_value) || 0)
      })
    }

    // Map each member to the mobile response shape
    const mapped = uniqueMembers.map((m: any) => {
      const nameParts = [m.firstname, m.middlename, m.lastname]
        .filter((part: any) => typeof part === 'string' && part.trim().length > 0)
        .map((part: any) => part.trim())
      const holderName = sanitizeName(nameParts.join(' ') || m.clientcode)
      const salutation = typeof m.salutation === 'string' ? m.salutation.trim() : ''
      const fullName = [salutation, holderName].filter(Boolean).join(' ').trim()

      const relation = m.head_of_family ? 'Primary' : (finalIsHeadOfFamily ? 'Family Member' : 'Individual Account')

      // Status: Closed if portfolio_value is 0 or missing, Active otherwise
      const portfolioValue = portfolioMap.get(m.clientcode) ?? 0
      const status: 'Active' | 'Closed' = portfolioValue === 0 ? 'Closed' : 'Active'

      // Mask PAN — show only last 4 chars (e.g. "ABCDE1234F" → "••••••1234F").
      const maskedPan = m.pannumber
        ? '•'.repeat(Math.max(0, m.pannumber.length - 4)) + m.pannumber.slice(-4)
        : null

      return {
        clientid: m.clientid,
        clientcode: m.clientcode,
        holderName,
        fullName,
        relation,
        status,
        portfolioValue,
        head_of_family: !!m.head_of_family,
        groupid: m.groupid,
        groupname: sanitizeName(m.groupname),
        groupemailid: email,
        ownerid: m.ownerid,
        ownername: sanitizeName(m.ownername || holderName),
        email: m.email,
        mobile: m.mobile,
        address: m.address1,
        city: m.city,
        state: m.state,
        pannumber: maskedPan,
      }
    })

    // Group by groupname → ownerid → accounts (3-level tree)
    const groups: Record<string, {
      groupName: string
      groupId: string
      groupEmail: string
      owners: Record<string, {
        ownerId: string
        ownerName: string
        ownerEmail: string
        accounts: typeof mapped
      }>
    }> = {}

    mapped.forEach((member) => {
      const groupKey = member.groupname || 'My Account'
      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupName: groupKey,
          groupId: member.groupid,
          groupEmail: member.groupemailid,
          owners: {},
        }
      }

      const ownerKey = member.ownerid || member.clientid
      if (!groups[groupKey].owners[ownerKey]) {
        groups[groupKey].owners[ownerKey] = {
          ownerId: ownerKey,
          ownerName: member.ownername,
          ownerEmail: member.email,
          accounts: [],
        }
      }

      groups[groupKey].owners[ownerKey].accounts.push(member)
    })

    const tree = Object.values(groups).map((group) => ({
      ...group,
      owners: Object.values(group.owners).map((owner) => ({
        ...owner,
        accountCount: owner.accounts.length,
      })),
      totalAccounts: Object.values(group.owners).reduce(
        (sum, o) => sum + o.accounts.length, 0
      ),
    }))

    return NextResponse.json({
      isHeadOfFamily: finalIsHeadOfFamily,
      groupId: allClientDetails[0]?.groupid ?? null,
      groupName: sanitizeName(allClientDetails[0]?.groupname),
      tree,
      flatMembers: mapped,
      totalMembers: mapped.length,
    })
  } catch (err) {
    console.error('[mobile/experience/family]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
