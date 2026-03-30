// GET /api/mobile/admin/clients?search=&page=1&limit=50
// Returns all client owner groups for the super-admin master view.
// RESTRICTED: only accessible to karan@qodeinvest.com (isSuperAdmin in JWT).
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth, requireSuperAdmin } from '@/lib/mobileAuth'
import { query } from '@/lib/db'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const adminError = requireSuperAdmin(user!)
  if (adminError) return adminError

  const { searchParams } = new URL(request.url)
  const search = (searchParams.get('search') || '').toLowerCase().trim()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = parseInt(searchParams.get('limit') || '10000')   // default: return all
  const offset = (page - 1) * limit

  try {
    // Fetch all PMS clients (not distributors)
    const result = await query(
      `SELECT
         clientid, clientcode, email, mobile,
         groupid, groupname, ownerid,
         salutation, firstname, middlename, lastname,
         head_of_family, onboarding_status, password_set_at,
         login_count, last_login_at, created_at
       FROM pms_clients_master
       WHERE ownerid IS NOT NULL
         AND (clienttype IS NULL OR clienttype != 'DISTRIBUTORS')
       ORDER BY created_at DESC`,
      []
    )

    const allClients: any[] = result.rows.map((r: any) => ({
      ...r,
      fullName: [r.salutation, r.firstname, r.middlename, r.lastname]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    }))

    // Group by ownerid
    const ownerMap = new Map<string, any[]>()
    for (const c of allClients) {
      const key = c.ownerid
      if (!ownerMap.has(key)) ownerMap.set(key, [])
      ownerMap.get(key)!.push(c)
    }

    // Build owner groups
    let groups: any[] = Array.from(ownerMap.entries()).map(([ownerId, accounts]) => {
      const primary = accounts.find(a => a.head_of_family) || accounts[0]
      const allCodes = accounts.map(a => a.clientcode).filter(Boolean)
      const completed = accounts.filter(a => a.password_set_at != null).length
      const onboardingStatus =
        completed === accounts.length ? 'completed' :
        completed === 0 ? 'pending' : 'mixed'

      const lastLogin = accounts
        .map(a => a.last_login_at)
        .filter(Boolean)
        .sort()
        .pop() ?? null

      return {
        ownerId,
        ownerName: primary.fullName,
        email: primary.email,
        mobile: primary.mobile,
        groupId: primary.groupid,
        groupName: primary.groupname,
        headClientCode: primary.clientcode,   // use this for impersonation
        headClientId: primary.clientid,
        isHeadOfFamily: primary.head_of_family,
        accountCodes: allCodes,
        totalAccounts: accounts.length,
        onboardingStatus,
        loginCount: accounts.reduce((s: number, a: any) => s + (a.login_count || 0), 0),
        lastLogin,
        accounts: accounts.map((a: any) => ({
          clientId: a.clientid,
          clientCode: a.clientcode,
          name: a.fullName,
          onboardingStatus: a.password_set_at ? 'completed' : 'pending',
          isHeadOfFamily: a.head_of_family,
          loginCount: a.login_count || 0,
          lastLogin: a.last_login_at,
        })),
      }
    })

    // Search filter
    if (search) {
      groups = groups.filter(g =>
        g.ownerName.toLowerCase().includes(search) ||
        g.email.toLowerCase().includes(search) ||
        g.accountCodes.some((c: string) => c.toLowerCase().includes(search)) ||
        (g.groupName && g.groupName.toLowerCase().includes(search))
      )
    }

    const total = groups.length
    const paged = groups.slice(offset, offset + limit)

    return NextResponse.json({
      clients: paged,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error('[mobile/admin/clients]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
