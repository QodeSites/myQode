// app/api/admin/impersonate/route.ts
// Opens a one-time portal impersonation link (see lib/impersonation.ts). Only a JWT signed with JWT_SECRET
// (`kind: 'imp'`, at most 5 minutes old, never used before) is accepted. The link itself is the credential,
// so this handler has no requireAdmin guard: whoever generated it was checked when it was issued.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { verifyImpersonationToken } from '@/lib/impersonation';
import { signWebSession, WEB_SESSION_COOKIE, webSessionCookieOptions } from '@/lib/webSession';
import { audit, ensureAdminTables } from '@/lib/adminAuth';

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 };

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Invalid impersonation token' }, { status: 400 });
    }

    const { payload: tokenData, error } = verifyImpersonationToken(token);
    if (!tokenData) {
      return NextResponse.json({ error }, { status: 400 });
    }

    // One-time: a link that was already opened is refused (the audit row below records its jti).
    await ensureAdminTables();
    const used = await query(
      `SELECT 1 FROM admin_audit_log WHERE action = 'impersonate.open' AND details->>'jti' = $1 LIMIT 1`,
      [tokenData.jti]
    );
    if (used.rows.length > 0) {
      return NextResponse.json({ error: 'This link was already used. Please generate a new one.' }, { status: 400 });
    }
    await audit(request, { email: tokenData.by }, 'impersonate.open', tokenData.userContext.email || tokenData.clientCode, {
      jti: tokenData.jti,
      via: tokenData.via,
      clientCode: tokenData.clientCode,
      clientType: tokenData.clientType || 'INVESTOR',
    });

    const cookieStore = await cookies();

    // Same cookies as a regular login.
    cookieStore.set('qode-auth', '1', cookieOpts);
    cookieStore.set(
      WEB_SESSION_COOKIE,
      signWebSession(tokenData.clientData.map(c => c.clientcode).filter((c): c is string => !!c)),
      webSessionCookieOptions
    );
    cookieStore.set('qode-clients', JSON.stringify(tokenData.clientData), cookieOpts);
    cookieStore.set('qode-head-of-family', tokenData.userContext.head_of_family ? 'true' : 'false', cookieOpts);
    cookieStore.set('qode-user-context', JSON.stringify(tokenData.userContext), cookieOpts);

    // Impersonation flag for UI indicators.
    cookieStore.set('qode-admin-impersonation', JSON.stringify({
      isImpersonating: true,
      targetClient: tokenData.clientCode,
      targetClientName: tokenData.targetClientName,
      isHeadOfFamily: tokenData.userContext.head_of_family,
      impersonatedAt: new Date().toISOString(),
      impersonatedBy: tokenData.by,
      viewedByDistributor: tokenData.via === 'distributor',
      adminSession: tokenData.via === 'admin',
    }), cookieOpts);

    // Use the request's host so tunnels / proxies redirect back to themselves.
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;

    const redirectPath = tokenData.clientType === 'DISTRIBUTORS'
      ? '/distributor/fees-distribution'
      : '/portfolio/performance';

    return NextResponse.redirect(`${baseUrl}${redirectPath}`);
  } catch (error) {
    console.error('Impersonation error:', error);
    return NextResponse.json({ error: 'Impersonation failed' }, { status: 500 });
  }
}
