// Signed web session — the only thing the web API trusts about who is signed in.
//
// The portal also sets plain cookies (qode-auth, qode-clients, qode-user-context, qode-head-of-family). They are
// httpOnly but NOT signed: anyone can send any value with curl. They stay for the pages that read them, but no API
// route may authorise anything with them. This cookie is set next to them at every login and impersonation,
// httpOnly and signed with JWT_SECRET, and carries the same account codes and user context.
import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

export const WEB_SESSION_COOKIE = 'qode-session'
const MAX_AGE = 60 * 60 * 24   // same lifetime as qode-auth / qode-clients

export const webSessionCookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE, secure: process.env.NODE_ENV === 'production' }

/** What the signed session holds: the codes from login and the same object the qode-user-context cookie carries. */
export interface WebSession {
  codes: string[]
  ctx: { email?: string | null; clientid?: string | null; clientcode?: string | null; groupid?: string | null; head_of_family?: boolean | null; [k: string]: unknown } | null
}

export function signWebSession(clientCodes: string[], ctx?: WebSession['ctx']): string {
  return jwt.sign({ kind: 'web', codes: clientCodes.filter(Boolean), ...(ctx ? { ctx } : {}) }, process.env.JWT_SECRET!, { expiresIn: MAX_AGE })
}

export function verifyWebSession(token: string | undefined | null): WebSession | null {
  if (!token) return null
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET!) as { kind?: string; codes?: string[]; ctx?: WebSession['ctx'] }
    if (p.kind !== 'web' || !Array.isArray(p.codes)) return null
    return { codes: p.codes, ctx: p.ctx && typeof p.ctx === 'object' ? p.ctx : null }
  } catch { return null }
}

/** The signed session of this request, or null. */
export async function webSession(): Promise<WebSession | null> {
  return verifyWebSession((await cookies()).get(WEB_SESSION_COOKIE)?.value)
}

/** Account codes the signed web session may read, or null when there is no valid session. */
export async function webSessionCodes(): Promise<string[] | null> {
  return (await webSession())?.codes ?? null
}

/**
 * Drop-in replacement for `cookieStore.get('qode-user-context')`: the user context from the SIGNED session, shaped
 * like a cookie ({ value: JSON }) so existing parsing code keeps working. Undefined when there is no valid session
 * (or it predates this change — the user signs in again).
 */
export async function signedUserContext(): Promise<{ value: string } | undefined> {
  const s = await webSession()
  return s?.ctx ? { value: JSON.stringify(s.ctx) } : undefined
}
