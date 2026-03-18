import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

export interface MobileAuthUser {
  userId: string
  email: string
  clientCode: string
  clientId: string
  accountCodes: string[]   // all nuvama codes this user can access
  ownerIds: string[]
  groupId: string
  isHeadOfFamily: boolean
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
