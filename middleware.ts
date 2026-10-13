import { NextRequest, NextResponse } from 'next/server';

// Origins that are allowed to call the mobile API.
// The React Native app itself doesn't need CORS (uses native HTTP client, not a browser),
// but the web admin panel and local dev environment do.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

// Fallback to a safe list if env var is not set (local dev only).
const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:19006']

function getCorsOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return ''
  const allowed = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_DEV_ORIGINS
  return allowed.includes(requestOrigin) ? requestOrigin : ''
}

// Phone apps below APP_MIN_VERSION get no data: the app's own "Update Required" screen (driven by
// /api/mobile/app-version) can be missing on very old builds, so the server refuses them as well.
// A phone app is told apart from a browser by its User-Agent (Android: okhttp, iPhone: CFNetwork/Darwin);
// the old app sends no x-app-version at all, which counts as below the minimum. Browsers (the website) are never
// blocked here, and /api/mobile/app-version stays open so the app can still show its update screen.
const MIN_APP_VERSION = process.env.APP_MIN_VERSION ?? '1.3.1'
const IOS_URL = process.env.APP_IOS_URL ?? 'https://apps.apple.com/in/app/myqode/id6761060137'
const ANDROID_URL = process.env.APP_ANDROID_URL ?? 'https://play.google.com/store/apps/details?id=com.qodeinvest.myqode'
const UPDATE_MESSAGE = 'This version of myQode is no longer supported. Please update the app from the App Store or Play Store to continue.'
const versionLt = (a: string, b: string) => {
  const x = a.split('.').map(n => parseInt(n, 10) || 0), y = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) }
  return false
}

function oldAppBlock(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname
  if (!path.startsWith('/api/mobile/') || path.startsWith('/api/mobile/app-version') || request.method === 'OPTIONS') return null
  // Signed links the current app opens outside its own requests (a partner's PDF download on Android, the payment
  // page) carry no version and no login: a GET without a Bearer token is let through. Every data call has one.
  if (request.method === 'GET' && !request.headers.get('authorization')) return null
  const ua = request.headers.get('user-agent') ?? ''
  if (!/^okhttp\/|CFNetwork\/|Darwin\//i.test(ua)) return null
  const version = (request.headers.get('x-app-version') ?? '').trim()
  if (version && !versionLt(version, MIN_APP_VERSION)) return null
  return NextResponse.json(
    { error: UPDATE_MESSAGE, message: UPDATE_MESSAGE, code: 'UPDATE_REQUIRED', minVersion: MIN_APP_VERSION, updateUrls: { ios: IOS_URL, android: ANDROID_URL } },
    { status: 426 },
  )
}

export async function middleware(request: NextRequest) {
  // Handle CORS preflight for all API routes
  if (request.method === 'OPTIONS' && request.nextUrl.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin')
    const corsOrigin = getCorsOrigin(origin)
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...(corsOrigin && { 'Access-Control-Allow-Origin': corsOrigin }),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Type, x-app-version, x-device',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }

  const blocked = oldAppBlock(request)
  if (blocked) return blocked

  // Admin route protection (existing behaviour)
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (
      request.nextUrl.pathname === '/admin/login' ||
      request.nextUrl.pathname.startsWith('/api/auth/')
    ) {
      return NextResponse.next();
    }

    // Either the Microsoft staff session or the backoffice `qode-admin` cookie lets the page load.
    // Presence check only; the real checks happen server-side (lib/adminAuth, /api/admin/auth/me).
    const sessionId =
      request.cookies.get('admin-session')?.value || request.cookies.get('qode-admin')?.value;
    console.log('🔒 Middleware check:', {
      path: request.nextUrl.pathname,
      hasCookie: !!sessionId,
      cookieValue: sessionId ? 'exists' : 'missing',
      userAgent: request.headers.get('user-agent')?.substring(0, 50),
      timestamp: new Date().toISOString(),
    });

    if (!sessionId) {
      console.log('❌ No admin session cookie found');
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Defer session validation to API route or page
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
};