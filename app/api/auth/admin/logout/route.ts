// app/api/auth/admin/logout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/session-store';

export async function POST(request: NextRequest) {
  try {
    const sessionId = (await cookies()).get('admin-session')?.value;
    if (sessionId) {
      await deleteSession(sessionId);
      console.log('🗑️ Session deleted:', { sessionId });
    } else {
      console.log('⚠️ No session cookie found for logout');
    }

    const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
    response.cookies.set('admin-session', '', { maxAge: 0, path: '/', httpOnly: true });
    console.log('🚪 Admin session cookie cleared');
    return response;
  } catch (error) {
    console.error('💥 Logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}