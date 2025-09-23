// app/api/auth/admin/complete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // Decode and validate token
    const tokenData = JSON.parse(Buffer.from(token, 'base64url').toString())
    
    // Check token age (should be very recent)
    if (Date.now() - tokenData.timestamp > 60000) { // 1 minute
      return NextResponse.json({ error: 'Token expired' }, { status: 400 })
    }

    const cookieStore = await cookies()
    
    // Set the session cookie
    cookieStore.set('admin-session', JSON.stringify(tokenData.sessionData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    })

    console.log('✅ Admin session cookie set via completion endpoint')

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Auth completion error:', error)
    return NextResponse.json({ error: 'Failed to complete auth' }, { status: 500 })
  }
}