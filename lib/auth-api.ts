import { NextRequest } from 'next/server'
import { verifyJWT } from './jwt'

/**
 * Server-side auth for API routes: verify the access token from login (auth service).
 * Requires JWT_PUBLIC_KEY in .env to match the auth service's public key (RS256).
 *
 * JWT payload from auth service (RS256 access token).
 * sub = user_id, app_id / user_app_id when present.
 */
export interface AuthPayload {
  sub: string
  type: string
  jti: string
  iat: number
  exp: number
  app_id?: number
  user_app_id?: number
}

/**
 * Get and verify the access token from the request.
 * Reads from cookie `qode-access-token` or Authorization: Bearer <token>.
 * Returns the JWT payload if valid, null otherwise.
 */
export async function getAuthPayload(request: NextRequest): Promise<AuthPayload | null> {
  const token =
    request.cookies.get('qode-access-token')?.value ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()

  if (!token) return null

  try {
    const payload = (await verifyJWT(token)) as unknown as AuthPayload
    return payload
  } catch {
    return null
  }
}
