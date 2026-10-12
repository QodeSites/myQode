// Where an app request came from: the myQode web (/app in a browser) or the phone app. Both call the same mobile API;
// the client sends x-device on every call (myqode-native src/api/device.js): "Web - Chrome" from a browser,
// "iPhone 15 Pro - iOS 18.2" / "Pixel 8 - Android 15" from the phone. Null when the header is missing.
export type RequestChannel = 'Web' | 'App'
export function requestChannel(request: Request): RequestChannel | null {
  const d = String(request.headers.get('x-device') || '').trim()
  if (!d) return null
  return /^web\b/i.test(d) ? 'Web' : 'App'
}
