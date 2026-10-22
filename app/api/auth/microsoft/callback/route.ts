// app/api/auth/microsoft/callback/route.ts
import { isAdminEmail } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { microsoftAuthConfig } from '@/lib/auth-config'
import { MS_STATE_COOKIE, safeAdminPath, sameNonce } from '@/lib/oauthState'
import { saveSession } from '@/lib/session-store'
import { v4 as uuidv4 } from 'uuid';
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  console.log('🔐 Microsoft OAuth Callback Debug:', {
    hasCode: !!code,
    hasState: !!state,
    error,
    errorDescription,
    fullUrl: request.url
  })

  if (error) {
    console.error('❌ Microsoft OAuth error:', error, errorDescription)
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=oauth_error&details=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    console.error('❌ Missing code or state:', { code: !!code, state: !!state })
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=missing_code`)
  }

  try {
    // Verify and parse state
    console.log('🔍 Parsing state:', state)
    let stateData
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
      console.log('✅ State parsed successfully:', stateData)
    } catch (stateError) {
      console.error('❌ State parsing failed:', stateError)
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=invalid_state`)
    }

    // The sign-in must have been started by this browser (nonce in the state = nonce in its cookie).
    if (!sameNonce(stateData?.nonce, request.cookies.get(MS_STATE_COOKIE)?.value)) {
      console.error('❌ State nonce does not match this browser')
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=invalid_state`)
    }

    const redirectTo = safeAdminPath(stateData.redirect)

    // Exchange code for token
    console.log('🔄 Exchanging code for token...')
    const tokenParams = new URLSearchParams({
      client_id: microsoftAuthConfig.clientId,
      client_secret: microsoftAuthConfig.clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: microsoftAuthConfig.redirectUri,
    })

    console.log('🌐 Token request URL:', microsoftAuthConfig.tokenUrl)
    console.log('📝 Token request params:', {
      client_id: microsoftAuthConfig.clientId,
      redirect_uri: microsoftAuthConfig.redirectUri,
      grant_type: 'authorization_code',
      hasCode: !!code,
      hasSecret: !!microsoftAuthConfig.clientSecret
    })

    const tokenResponse = await fetch(microsoftAuthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenParams.toString(),
    })

    console.log('📡 Token response status:', tokenResponse.status)

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('❌ Token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        body: errorText
      })
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=token_exchange_failed`)
    }

    const tokenData = await tokenResponse.json()
    console.log('✅ Token received successfully:', {
      hasAccessToken: !!tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in
    })

    // Get user profile
    console.log('👤 Fetching user profile...')
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json'
      },
    })

    console.log('👤 Profile response status:', profileResponse.status)

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text()
      console.error('❌ Profile fetch failed:', {
        status: profileResponse.status,
        statusText: profileResponse.statusText,
        body: errorText
      })
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=profile_fetch_failed`)
    }

    const profile = await profileResponse.json()
    console.log('✅ Profile fetched successfully:', {
      id: profile.id,
      email: profile.mail || profile.userPrincipalName,
      name: profile.displayName
    })

    // Verify user is authorized admin (optional)
    const userEmail = profile.mail || profile.userPrincipalName
    // Only people on the Admins page (admin_users.role) may sign in; an empty list no longer lets everyone in.
    const authorized = await isAdminEmail(userEmail)
    console.log('🔒 Authorization check:', { userEmail, isAuthorized: authorized })

    if (!authorized) {
      console.error('❌ User not authorized:', userEmail)
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=unauthorized&email=${encodeURIComponent(userEmail)}`)
    }

    const sessionId = uuidv4();
    const sessionData = {
      user: {
        id: profile.id,
        email: userEmail,
        name: profile.displayName,
        preferred_username: profile.userPrincipalName,
        tenant_id: microsoftAuthConfig.tenantId,
      },
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
    };

    await saveSession(sessionId, sessionData);

    const redirectUrl = `${process.env.NEXTAUTH_URL}${redirectTo}`;
    const redirectResponse = NextResponse.redirect(redirectUrl);
    const cookieHeader = `admin-session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; Max-Age=${tokenData.expires_in}; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
    redirectResponse.headers.set('Set-Cookie', cookieHeader);
    redirectResponse.headers.append('Set-Cookie', `${MS_STATE_COOKIE}=; Path=/api/auth/microsoft; Max-Age=0; HttpOnly; SameSite=Lax`);
    console.log('🍪 Cookie set in response:', { sessionId, cookieHeader });
    console.log('📤 Manually Set-Cookie Header:', cookieHeader);
    console.log('📤 Full Response Headers:', Object.fromEntries(redirectResponse.headers.entries()));
    return redirectResponse;

  } catch (error) {
    console.error('💥 Microsoft OAuth callback error:', error)
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/admin/login?error=callback_error&details=${encodeURIComponent(error.message)}`)
  }
}