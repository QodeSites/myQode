// Signed web session for data the unsigned qode-clients cookie must not unlock on its own (the web Reports
// page: capital gains, expenses, holdings, transactions). Set at web login next to qode-clients, httpOnly,
// signed with JWT_SECRET — a browser can read neither it nor forge a different list of account codes.
import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

export const WEB_SESSION_COOKIE = 'qode-session'
const MAX_AGE = 60 * 60 * 24   // same lifetime as qode-auth / qode-clients

export const webSessionCookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE, secure: process.env.NODE_ENV === 'production' }

export function signWebSession(clientCodes: string[]): string {
  return jwt.sign({ kind: 'web', codes: clientCodes.filter(Boolean) }, process.env.JWT_SECRET!, { expiresIn: MAX_AGE })
}

/** Account codes the signed web session may read, or null when there is no valid session. */
export async function webSessionCodes(): Promise<string[] | null> {
  const token = (await cookies()).get(WEB_SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET!) as { kind?: string; codes?: string[] }
    return p.kind === 'web' && Array.isArray(p.codes) ? p.codes : null
  } catch { return null }
}
