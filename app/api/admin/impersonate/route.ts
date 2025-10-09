// app/api/admin/impersonate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
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

    // FIX: Get the correct host from request headers for ngrok support
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;
    
    // Redirect to dashboard with correct base URL
    return NextResponse.redirect(`${baseUrl}/portfolio/performance`);

  } catch (error) {
    console.error('Impersonation error:', error);
    return NextResponse.json({ error: 'Impersonation failed' }, { status: 500 });
  }
}