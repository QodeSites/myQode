// app/api/logout/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const cookieStore = await cookies()

    // Clear auth-related cookies (JWT + client mapping)
    cookieStore.set('qode-access-token', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0)
    })

    cookieStore.set('qode-refresh-token', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0)
    })

    cookieStore.set('qode-clients', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0)
    })

    cookieStore.set('qode-user-context', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0)
    })
    
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