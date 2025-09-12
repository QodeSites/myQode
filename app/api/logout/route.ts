// app/api/logout/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const cookieStore = await cookies()
    
    // Clear all auth cookies with explicit options to ensure they're properly removed
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