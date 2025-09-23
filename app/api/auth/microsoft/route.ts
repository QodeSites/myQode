// app/api/auth/microsoft/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { microsoftAuthConfig } from '@/lib/auth-config'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const redirectTo = searchParams.get('redirect') || '/admin/onboarding'

  // Generate state parameter for security
  const state = Buffer.from(JSON.stringify({
    redirect: redirectTo,
    timestamp: Date.now()
  })).toString('base64url')

  const params = new URLSearchParams({
    client_id: microsoftAuthConfig.clientId,
    response_type: 'code',
    redirect_uri: microsoftAuthConfig.redirectUri,
    scope: microsoftAuthConfig.scope,
    state: state,
    response_mode: 'query'
  })

  const authUrl = `${microsoftAuthConfig.authorizeUrl}?${params.toString()}`
  
  return NextResponse.redirect(authUrl)
}
