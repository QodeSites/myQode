import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, deleteSession } from '@/lib/session-store';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('admin-session')?.value;

    console.log('🔍 Session validation:', {
      hasCookie: !!sessionId,
      cookieExists: sessionId ? 'yes' : 'no',
      timestamp: new Date().toISOString(),
    });

    if (!sessionId) {
      console.log('❌ No session cookie found in validation');
      return NextResponse.json(
        { success: false, error: 'No session found', authenticated: false },
        { status: 401 }
      );
    }

    const sessionData = await getSession(sessionId);
    if (!sessionData || !sessionData.user || !sessionData.expiresAt || !sessionData.accessToken) {
      console.log('❌ Invalid session structure');
      const response = NextResponse.json(
        { success: false, error: 'Invalid session structure', authenticated: false },
        { status: 401 }
      );
      response.cookies.set('admin-session', '', { maxAge: 0, path: '/', httpOnly: true });
      return response;
    }

    if (Date.now() > sessionData.expiresAt) {
      console.log('❌ Session expired');
      const response = NextResponse.json(
        { success: false, error: 'Session expired', authenticated: false },
        { status: 401 }
      );
      response.cookies.set('admin-session', '', { maxAge: 0, path: '/', httpOnly: true });
      await deleteSession(sessionId);
      return response;
    }

    console.log('✅ Session validation successful for:', sessionData.user.email);
    return NextResponse.json({
      success: true,
      authenticated: true,
      user: {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
      },
      expiresAt: sessionData.expiresAt,
      expiresIn: Math.max(0, sessionData.expiresAt - Date.now()),
    });

  } catch (error) {
    console.error('💥 Session validation error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', authenticated: false },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const sessionId = (await cookies()).get('admin-session')?.value;
  if (sessionId) {
    await deleteSession(sessionId);
  }
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  response.cookies.set('admin-session', '', { maxAge: 0, path: '/', httpOnly: true });
  console.log('🚪 Admin session cleared');
  return response;
}