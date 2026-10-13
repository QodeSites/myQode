// Where an app request came from: the myQode web (/app in a browser) or the phone app. Both call the same mobile API;
// the client sends x-device on every call (myqode-native src/api/device.js): "Web - Chrome" from a browser,
// "iPhone 15 Pro - iOS 18.2" / "Pixel 8 - Android 15" from the phone. Null when the header is missing.
export type RequestChannel = 'Web' | 'App'
/** "myQode Web" / "myQode App" for the Investor Relations emails' "Submitted via" line; "myQode" when unknown. */
export const submittedVia = (channel: RequestChannel | null | undefined) => (channel === 'Web' ? 'myQode Web' : channel === 'App' ? 'myQode App' : 'myQode')
export function requestChannel(request: Request): RequestChannel | null {
  const d = String(request.headers.get('x-device') || '').trim()
  if (!d) return null
  return /^web\b/i.test(d) ? 'Web' : 'App'
}

/**
 * Where the server reaches its own routes (/api/send-email): INTERNAL_API_BASE when set — a dev server must call
 * ITSELF, not the public site (13 Oct 2026: with only NEXT_PUBLIC_BASE_URL set, a dev server's request emails went
 * through production's route, which still sent them) — else the public base.
 */
export const internalBase = () => String(process.env.INTERNAL_API_BASE || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:2069').trim().replace(/\/$/, '')
