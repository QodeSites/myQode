// app/api/logout/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { tokenStore } from '@/lib/api/token-store'

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    tokenStore.clear()
    const clientType = req.headers.get("x-client-type");

    let refreshToken: string | undefined;

    if (clientType === "web") {
      refreshToken = cookieStore.get("refresh_token")?.value;
      cookieStore.set({
        name: "refresh_token",
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh",
        maxAge: 0,
      });

      cookieStore.set('qode-auth', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: new Date(0) // Set to past date to expire immediately
      })
      
      cookieStore.set('qode-clients', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: new Date(0) // Set to past date to expire immediately
      })
    } else {
      const body = await req.json();
      refreshToken = body.refreshToken;
    }
    
    console.log('Successfully cleared auth cookies')
    
    return NextResponse.json({ 
      success: true,
      message: 'Logged out successfully'
    })
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    )
  }
}