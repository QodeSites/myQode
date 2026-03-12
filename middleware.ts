import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/jwt';

function isAppClient(request: NextRequest) {
  const ua = request.headers.get('user-agent') || '';
  return (
    ua.includes('ReactNative') ||
    ua.includes('Expo') ||
    request.headers.get('x-client-type') === 'native'
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Public: admin login and auth APIs (except client-data) — no auth required
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/auth/') && !pathname.includes('client-data')) {
    return NextResponse.next();
  }

  // /api/auth/client-data → require investor auth (JWT cookie), not admin session
  if (pathname.includes('client-data')) {
    const accessToken = request.cookies.get('qode-access-token')?.value;
    if (accessToken) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // /admin/* (other than login) → require admin session
  const isApp = isAppClient(request);

  try {
    if (isApp) {
      const authHeader = request.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');
      if (!token) throw new Error('Missing token');
      await verifyJWT(token);
      return NextResponse.next();
    }

    const sessionId = request.cookies.get('admin-session')?.value;
    if (!sessionId) throw new Error('Missing session');
    return NextResponse.next();
  } catch (err) {
    if (isApp) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/admin/:path*','/api/auth/client-data'],
};
