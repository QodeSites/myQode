// GET /api/mobile/experience/family
// Returns the full family tree structure for the logged-in user.
// Includes group, owner, account levels with relations, contacts, and status.
// Used by the Family Account / Account Management screen.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

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
    // Fetch the user's own record to get groupid, ownerid, head_of_family
    const selfRes = await pool.query(
      `SELECT clientid, clientcode, groupid, ownerid, head_of_family, groupname, ownername, email
       FROM pms_clients_master WHERE clientid = $1 LIMIT 1`,
      [user!.userId]
    )

    if (!selfRes.rows.length) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const self = selfRes.rows[0]
    const isHeadOfFamily: boolean = !!self.head_of_family

    // Fetch family members — HoF sees full group, others see only their own accounts
    const familyRes = await pool.query(
      isHeadOfFamily
        ? `SELECT
             clientid, clientcode, email, mobile,
             groupid, groupname,
             ownerid, ownername,
             salutation, firstname, middlename, lastname,
             address1, city, state, pannumber,
             head_of_family, onboarding_status
           FROM pms_clients_master
           WHERE groupid = $1
           ORDER BY head_of_family DESC, firstname ASC`
        : `SELECT
             clientid, clientcode, email, mobile,
             groupid, groupname,
             ownerid, ownername,
             salutation, firstname, middlename, lastname,
             address1, city, state, pannumber,
             head_of_family, onboarding_status
           FROM pms_clients_master
           WHERE ownerid = $1 OR clientid = $1
           ORDER BY head_of_family DESC, firstname ASC`,
      isHeadOfFamily ? [self.groupid] : [self.ownerid ?? self.clientid]
    )

    const members = familyRes.rows

    // Map each member
    const mapped = members.map((m: any) => {
      const holderName = sanitizeName(
        [m.salutation, m.firstname, m.middlename, m.lastname].filter(Boolean).join(' ')
      )
      const relation = m.head_of_family ? 'Primary' : 'Family Member'

      // Derive status from onboarding_status
      let status: 'Active' | 'Pending KYC' | 'Dormant' = 'Pending KYC'
      if (m.onboarding_status === 'completed') status = 'Active'
      else if (m.onboarding_status === 'dormant') status = 'Dormant'

      return {
        clientid: m.clientid,
        clientcode: m.clientcode,
        holderName,
        relation,
        status,
        head_of_family: !!m.head_of_family,
        groupid: m.groupid,
        groupname: sanitizeName(m.groupname),
        groupemailid: m.email, // group email is head-of-family's email
        ownerid: m.ownerid,
        ownername: sanitizeName(m.ownername || holderName),
        email: m.email,
        mobile: m.mobile,
        address: m.address1,
        city: m.city,
        state: m.state,
        pannumber: m.pannumber,
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

    // Convert to arrays for easier consumption
    const tree = Object.values(groups).map((group) => ({
      ...group,
      owners: Object.values(group.owners).map((owner) => ({
        ...owner,
        accounts: owner.accounts,
        accountCount: owner.accounts.length,
      })),
      totalAccounts: Object.values(group.owners).reduce(
        (sum, o) => sum + o.accounts.length, 0
      ),
    }))

    return NextResponse.json({
      isHeadOfFamily,
      groupId: self.groupid,
      groupName: sanitizeName(self.groupname),
      tree,
      flatMembers: mapped,
      totalMembers: mapped.length,
    })
  } catch (err) {
    console.error('[mobile/experience/family]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
