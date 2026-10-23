// Microsoft admin sign-in (/api/auth/microsoft → /callback): where the admin may be sent back to, and the state
// nonce that ties the callback to the browser that started the sign-in (stops login CSRF).
import crypto from 'crypto'

export const MS_STATE_COOKIE = 'ms-oauth-state'
export const DEFAULT_ADMIN_PATH = '/admin/onboarding'

/** Only an /admin page on this site. Anything else ('.evil.com', '@evil.com', '//evil.com', full URLs) → the default. */
export function safeAdminPath(p: unknown): string {
  const s = typeof p === 'string' ? p : ''
  return /^\/admin(?:[/?#]|$)/.test(s) && !/[\\\s]/.test(s) ? s : DEFAULT_ADMIN_PATH
}

export const newStateNonce = () => crypto.randomBytes(16).toString('hex')

export function sameNonce(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
