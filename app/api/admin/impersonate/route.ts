// app/api/admin/impersonate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";

export async function GET(request: NextRequest) {
  // Admin-only. middleware.ts checks the cookie exists but defers
  // validation, so a forged cookie passes it — this validates the session.
  const __admin = await requireAdmin(request);
  if (!isAdminUser(__admin)) return __admin;

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Invalid impersonation token' }, { status: 400 });
    }

    // Decode and validate the impersonation token
    let tokenData;
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64').toString());
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 400 });
    }

    // Verify it's a valid admin impersonation token
    if (!tokenData.adminImpersonation || !tokenData.clientData || !tokenData.timestamp || !tokenData.userContext) {
      return NextResponse.json({ error: 'Invalid impersonation data' }, { status: 400 });
    }

    // Check token age (expire after 5 minutes for security)
    const tokenAge = Date.now() - tokenData.timestamp;
    if (tokenAge > 5 * 60 * 1000) { // 5 minutes
      return NextResponse.json({ error: 'Impersonation token expired' }, { status: 400 });
    }

    const cookieStore = await cookies();
    
    // Set authentication cookies (same as regular login)
    cookieStore.set('qode-auth', '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 // 24 hours
    });
    
    cookieStore.set('qode-clients', JSON.stringify(tokenData.clientData), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    });

    // Set head of family status cookie (role-based logic)
    cookieStore.set('qode-head-of-family', tokenData.userContext.head_of_family ? 'true' : 'false', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    });

    // Set user context cookie for easy access (role-based logic)
    cookieStore.set('qode-user-context', JSON.stringify(tokenData.userContext), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    });

    // Set admin impersonation flag for UI indicators
    cookieStore.set('qode-admin-impersonation', JSON.stringify({
      isImpersonating: true,
      targetClient: tokenData.clientCode,
      targetClientName: tokenData.targetClientName,
      isHeadOfFamily: tokenData.userContext.head_of_family,
      impersonatedAt: new Date().toISOString(),
      adminSession: true
    }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    });

    // Redirect distributors to their own page, all others to portfolio
    const redirectPath = tokenData.clientType === 'DISTRIBUTORS'
      ? '/distributor/fees-distribution'
      : '/portfolio/performance';

    // A RELATIVE Location, deliberately.
    //
    // This used to rebuild an absolute URL from the Host header. Behind a dev
    // tunnel that lands the admin back on localhost: the tunnel forwards to
    // 127.0.0.1, so `host` is the local address rather than the tunnel's, and
    // the browser is sent somewhere it cannot reach. The same would happen
    // behind any proxy that rewrites Host.
    //
    // A relative Location is resolved by the browser against the origin it
    // actually used, so it is correct on localhost, on a tunnel and in
    // production without any of them having to be configured. NextResponse
    // .redirect() requires an absolute URL, hence the plain Response.
    return new NextResponse(null, {
      status: 302,
      headers: { Location: redirectPath },
    });

  } catch (error) {
    console.error('Impersonation error:', error);
    return NextResponse.json({ error: 'Impersonation failed' }, { status: 500 });
  }
}