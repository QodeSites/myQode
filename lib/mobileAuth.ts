import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { query } from '@/lib/db'

// Qode Liquid Fund (QLF) accounts are shown like every other strategy. Logins issued before that (tokens last 30
// days) were signed without them, so each request adds the QLF accounts of the owners on the token. Cached briefly.
const qlfCache = new Map<string, { at: number; codes: string[] }>()
async function qlfAccountsOf(owners: string[]): Promise<string[]> {
  if (!owners.length) return []
  const key = owners.slice().sort().join(',')
  const hit = qlfCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.codes
  try {
    const r = await query(`SELECT DISTINCT clientcode FROM pms_clients_master WHERE ownerid = ANY($1) AND clientcode ~* '^QLF'`, [owners])
    const codes = r.rows.map((x: any) => x.clientcode)
    if (qlfCache.size > 5000) qlfCache.clear()
    qlfCache.set(key, { at: Date.now(), codes })
    return codes
  } catch { return [] }
}

// Validate JWT_SECRET at module load time — fail loudly rather than silently
// issuing or accepting tokens with an undefined secret.
if (!process.env.JWT_SECRET) {
  throw new Error('[mobileAuth] JWT_SECRET environment variable is not set. ' +
    'Set it in .env.local (development) or the production environment before starting the server.')
}

export interface MobileAuthUser {
  userId: string
  email: string
  clientCode: string
  clientId: string
  accountCodes: string[]   // all nuvama codes this user can access
  ownerIds: string[]
  groupId: string
  isHeadOfFamily: boolean
  isSuperAdmin?: boolean          // true for karan@qodeinvest.com and admin@qodeinvest.com
  isImpersonated?: boolean        // true when super admin is viewing as a client
  impersonatedBy?: string         // email of the super admin who is impersonating
  isReviewer?: boolean            // Play Store / App Store reviewer — served mock data
  // Distributor (partner) login: a pms_clients_master row with clientcode IS NULL, the same rule as the
  // web (lib/distributorIdentity.ts). accountCodes is empty — a distributor reads their book only through
  // /api/mobile/distributor/*, which re-resolve the distributor from the email on every call.
  isDistributor?: boolean
  distributorName?: string        // pms_clients_master.clientname — the intermediaryname key of their clients
  // A partner viewing one of their investors (/api/mobile/distributor/view-account): read-only — every non-GET
  // request made with such a token is refused below.
  viewOnly?: boolean
  viewedByDistributor?: boolean
}

export async function verifyMobileAuth(request: NextRequest): Promise<{
  user: MobileAuthUser | null
  error: NextResponse | null
}> {
  const authHeader = request.headers.get('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      user: null,
      error: NextResponse.json(
        { error: 'Unauthorized', code: 'NO_TOKEN' },
        { status: 401 }
      ),
    }
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as MobileAuthUser
    if (decoded.viewOnly && request.method !== 'GET' && request.method !== 'HEAD') {
      return {
        user: null,
        error: NextResponse.json(
          { error: 'You are viewing this account — changes are not available.', code: 'VIEW_ONLY' },
          { status: 403 }
        ),
      }
    }
    const codes = decoded.accountCodes || []
    if (codes.length && !decoded.isReviewer && !decoded.isDistributor) {
      const extra = (await qlfAccountsOf(codes.filter(c => /^\d+(\.0)?$/.test(c)))).filter(c => !codes.includes(c))
      if (extra.length) decoded.accountCodes = [...codes, ...extra]
    }
    return { user: decoded, error: null }
  } catch {
    return {
      user: null,
      error: NextResponse.json(
        { error: 'Token expired or invalid', code: 'TOKEN_INVALID' },
        { status: 401 }
      ),
    }
  }
}

/** Guard: reject requests that don't have isSuperAdmin=true in the JWT.
 *  Also rejects impersonation tokens — admin actions must use the original JWT. */
export function requireSuperAdmin(user: MobileAuthUser): NextResponse | null {
  if (user.isImpersonated) {
    return NextResponse.json(
      { error: 'Admin actions require the original token. Exit impersonation first.', code: 'IMPERSONATION_TOKEN' },
      { status: 403 }
    )
  }
  if (!user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
