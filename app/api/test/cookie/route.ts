// app/api/debug/test-cookie/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  console.log('🧪 Testing cookie setting mechanism...')
  
  // Test data similar to your session
  const testSessionData = {
    user: {
      id: 'test-id-123',
      email: 'test@example.com',
      name: 'Test User',
    },
    accessToken: 'test-token',
    expiresAt: Date.now() + (3600 * 1000), // 1 hour
  }

  console.log('📦 Test session data size:', JSON.stringify(testSessionData).length, 'characters')
  
  // Method 1: Try NextResponse.json with cookie
  const response = NextResponse.json({ 
    message: 'Testing cookie setting',
    timestamp: new Date().toISOString(),
    method: 'NextResponse.json + cookie'
  })

  // Set cookie on response object
  response.cookies.set('test-admin-session', JSON.stringify(testSessionData), {
    httpOnly: true,
    secure: false, // Force false for localhost testing
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  })

  console.log('🍪 Test cookie set via response.cookies.set()')
  console.log('📝 Cookie value length:', JSON.stringify(testSessionData).length)
  
  return response
}

export async function POST(request: NextRequest) {
  console.log('🔍 Checking if test cookie was received...')
  
  // Check if we can read the test cookie
  const testCookie = request.cookies.get('test-admin-session')
  
  console.log('📋 Cookie check result:', {
    hasCookie: !!testCookie,
    cookieLength: testCookie?.value?.length || 0,
    firstChars: testCookie?.value?.substring(0, 50) || 'none'
  })
  
  let parsedData = null
  if (testCookie) {
    try {
      parsedData = JSON.parse(testCookie.value)
    } catch (e) {
      console.error('❌ Cookie parse error:', e.message)
    }
  }
  
  return NextResponse.json({
    success: !!testCookie,
    hasCookie: !!testCookie,
    cookieLength: testCookie?.value?.length || 0,
    parsedData,
    message: testCookie ? 'Cookie found and parsed' : 'No cookie found'
  })
}