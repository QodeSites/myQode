import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  // Handle CORS preflight for all API routes
  if (request.method === 'OPTIONS' && request.nextUrl.pathname.startsWith('/api/')) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Type',
        'Access-Control-Max-Age': '86400',
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