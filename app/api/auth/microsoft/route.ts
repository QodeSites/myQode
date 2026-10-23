// app/api/auth/microsoft/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { microsoftAuthConfig } from '@/lib/auth-config'
import { MS_STATE_COOKIE, safeAdminPath, newStateNonce } from '@/lib/oauthState'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const redirectTo = safeAdminPath(searchParams.get('redirect'))

  // State: where to return to, plus a nonce also kept in an httpOnly cookie; the callback accepts only a state whose
  // nonce matches this browser's cookie.
  const nonce = newStateNonce()
  const state = Buffer.from(JSON.stringify({
    redirect: redirectTo,
    nonce,
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
  
  const res = NextResponse.redirect(authUrl)
  res.cookies.set(MS_STATE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', path: '/api/auth/microsoft', maxAge: 10 * 60, secure: process.env.NODE_ENV === 'production' })
  return res
}
