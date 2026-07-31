// GET /api/auth/zoho/status
//
// Verifies the stored Zoho credentials actually work: refreshes a token, checks
// the granted scope is CRM (not Recruit), and performs one real read against
// the Distributor module.
//
// This exists because the failure mode is quiet — a Recruit-scoped token
// refreshes happily and only fails later, at query time, with an opaque
// OAUTH_SCOPE_MISMATCH. One endpoint that answers "is this configured
// correctly, yes or no" is worth more than the sum of its parts here.
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)

  const setupSecret = process.env.ADMIN_SETUP_SECRET
  if (setupSecret) {
    const provided = url.searchParams.get('secret') ?? request.headers.get('x-setup-secret')
    if (provided !== setupSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'ADMIN_SETUP_SECRET is not configured.' }, { status: 503 })
  }

  const clientId = process.env.ZOHO_CRM_CLIENT_ID
  const clientSecret = process.env.ZOHO_CRM_CLIENT_SECRET
  const refreshToken = process.env.ZOHO_CRM_REFRESH_TOKEN
  const orgId = process.env.ZOHO_CRM_ORG_ID
  const dataCenter = process.env.ZOHO_CRM_DATA_CENTER || process.env.ZOHO_DATA_CENTER || 'in'
  const redirectUri = process.env.ZOHO_CRM_REDIRECT_URI

  // Report presence, never values.
  const env = {
    ZOHO_CRM_CLIENT_ID: Boolean(clientId),
    ZOHO_CRM_CLIENT_SECRET: Boolean(clientSecret),
    ZOHO_CRM_REFRESH_TOKEN: Boolean(refreshToken),
    ZOHO_CRM_ORG_ID: Boolean(orgId),
    ZOHO_CRM_REDIRECT_URI: redirectUri ?? null,
    dataCenter,
  }

  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'environment',
        error: 'Missing credentials.',
        env,
        next: 'Run /api/auth/zoho/authorize to mint a refresh token.',
      },
      { status: 503 },
    )
  }

  try {
    const res = await fetch(`https://accounts.zoho.${dataCenter}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}) as any)

    if (!data.access_token) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'token_refresh',
          error: data.error ?? 'No access token returned',
          env,
          next:
            data.error === 'invalid_code'
              ? 'The refresh token does not belong to this client id. Re-run /api/auth/zoho/authorize.'
              : 'Check the client id and secret.',
        },
        { status: 502 },
      )
    }

    const scope: string = data.scope ?? ''
    if (!/ZohoCRM/i.test(scope)) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'scope',
          error: 'Token is not CRM-scoped.',
          grantedScope: scope,
          env,
          next: 'Create the Self Client from Zoho CRM and re-run /api/auth/zoho/authorize.',
        },
        { status: 502 },
      )
    }

    // One real read — proves the whole chain, not just the token.
    const probe = await fetch(
      `https://www.zohoapis.${dataCenter}/crm/v2/Distributor?fields=Name,Email&per_page=1`,
      { headers: { Authorization: `Zoho-oauthtoken ${data.access_token}` }, cache: 'no-store' },
    )

    if (!probe.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'crm_read',
          error: `Distributor read returned HTTP ${probe.status}`,
          detail: (await probe.text()).slice(0, 300),
          grantedScope: scope,
          env,
        },
        { status: 502 },
      )
    }

    const body = await probe.json().catch(() => ({}) as any)
    const sample = body?.data?.[0]

    return NextResponse.json({
      ok: true,
      grantedScope: scope,
      accessTokenExpiresIn: data.expires_in,
      distributorModuleReadable: true,
      sampleDistributor: sample ? { name: sample.Name ?? null } : null,
      env,
      next: orgId
        ? 'Zoho is fully configured.'
        : 'Working. Add ZOHO_CRM_ORG_ID (CRM → Setup → Company Details) to enable record links.',
    })
  } catch (err) {
    console.error('[zoho/status] error:', err)
    return NextResponse.json(
      {
        ok: false,
        stage: 'network',
        error: err instanceof Error ? err.message : String(err),
        env,
      },
      { status: 500 },
    )
  }
}
