import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/jwt';


function isAppClient(request: NextRequest) {
  const ua = request.headers.get('user-agent') || '';
  return (
    ua.includes('ReactNative') ||
    ua.includes('Expo') ||
    request.headers.get('x-client-type') === 'app'
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow login & auth routes
  if (
    pathname === '/admin/login' ||
    pathname.startsWith('/api/auth/')
  ) {
    return NextResponse.next();
  }

  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const isApp = isAppClient(request);

  try {
    // 📱 APP → JWT via Authorization header
    if (isApp) {
      const authHeader = request.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');

      if (!token) throw new Error('Missing token');

      const payload = await verifyJWT(token);

      console.log('📱 App authenticated', {
        user: payload.sub,
        appId: payload.app_id,
      });

      return NextResponse.next();
    }

    // 🌐 WEB → Cookie-based session
    const sessionId = request.cookies.get('admin-session')?.value;

    if (!sessionId) {
      throw new Error('Missing session');
    }

    console.log('🌐 Web authenticated via cookie');

    return NextResponse.next();
  } catch (err) {
    console.error('❌ Auth failed:', err);

    // App → 401 JSON
    if (isApp) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Web → redirect
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/admin/:path*'],
};
