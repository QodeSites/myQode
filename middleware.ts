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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }

  // Admin route protection (existing behaviour)
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (
      request.nextUrl.pathname === '/admin/login' ||
      request.nextUrl.pathname.startsWith('/api/auth/')
    ) {
      return NextResponse.next();
    }

    const sessionId = request.cookies.get('admin-session')?.value;
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