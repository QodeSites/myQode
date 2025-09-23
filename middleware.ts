import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
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
  matcher: ['/admin/:path*'],
};