import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

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
  isSuperAdmin?: boolean          // only true for karan@qodeinvest.com
  isImpersonated?: boolean        // true when super admin is viewing as a client
  impersonatedBy?: string         // email of the super admin who is impersonating
  isReviewer?: boolean            // Play Store / App Store reviewer — served mock data
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

/** Guard: reject requests that don't come from karan@qodeinvest.com.
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
