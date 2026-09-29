// app/api/logout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { logAuthEvent } from '@/lib/authEvents'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    // Analytics: who signed out (from the session's user-context cookie, read before it is cleared).
    let signedOutEmail: string | null = null
    try { signedOutEmail = JSON.parse(cookieStore.get('qode-user-context')?.value || '{}')?.email || null } catch {}
    void logAuthEvent(request, { email: signedOutEmail, event: 'logout', platform: 'web' })
    
    // Clear all auth cookies with explicit options to ensure they're properly removed
    cookieStore.set('qode-auth', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0) // Set to past date to expire immediately
    })
    
    cookieStore.set('qode-session', '', { httpOnly: true, sameSite: 'lax', path: '/', expires: new Date(0) })
    cookieStore.set('qode-clients', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0) // Set to past date to expire immediately
    })
    
    // Alternative: Use delete method (your original approach is also fine)
    // cookieStore.delete('qode-auth')
    // cookieStore.delete('qode-clients')
    
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