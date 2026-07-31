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
      // Surface Zoho's own response. Without it "no access token" is a dead end
      // — the useful detail is always in the body, not the HTTP status.
      const zohoError = data.error ?? null
      const nextByError: Record<string, string> = {
        invalid_code:
          'The refresh token does not belong to this client id. Re-run /api/auth/zoho/authorize.',
        invalid_client:
          'The client id or secret is wrong, or belongs to a different Zoho data centre.',
        invalid_grant:
          'The refresh token has been revoked or superseded. Re-run /api/auth/zoho/authorize.',
        'Access Denied':
          'This Self Client is not permitted to issue CRM tokens. Create the Self Client from Zoho CRM.',
      }

      return NextResponse.json(
        {
          ok: false,
          stage: 'token_refresh',
          error: zohoError ?? 'No access token returned',
          zohoResponse: data,           // the actual payload Zoho sent back
          httpStatus: res.status,
          env,
          next:
            (zohoError && nextByError[zohoError]) ??
            'Check the client id and secret, and that they match the data centre above.',
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

    // A REST read succeeding does NOT mean the fee lookup works: that uses
    // COQL, a different endpoint with its own scope. Testing only REST is what
    // let this route report ok:true while the fee lookup silently fell back to
    // legacy rates. Exercise the exact query the calculator runs.
    let coqlOk = false
    let coqlError: string | null = null
    let shareCategoryRows = 0
    let sampleShare: { name: string | null; email: string | null; secondary: string | null; category: string | null } | null =
      null

    try {
      const coqlRes = await fetch(`https://www.zohoapis.${dataCenter}/crm/v3/coql`, {
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${data.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          select_query:
            'select Email, Secondary_Email, Name, Distributor_Share_Category, Base_Distributor_Share ' +
            'from Distributor where Distributor_Share_Category is not null limit 0, 200',
        }),
        cache: 'no-store',
      })

      if (coqlRes.status === 204) {
        coqlOk = true                       // valid query, simply no rows
      } else if (coqlRes.ok) {
        coqlOk = true
        const coqlBody = await coqlRes.json().catch(() => ({}) as any)
        const rows: any[] = coqlBody?.data ?? []
        shareCategoryRows = rows.length
        const first = rows[0]
        if (first) {
          sampleShare = {
            name: first.Name ?? null,
            email: first.Email ?? null,
            secondary: first.Secondary_Email ?? null,
            category: first.Distributor_Share_Category ?? null,
          }
        }
      } else {
        coqlError = `HTTP ${coqlRes.status}: ${(await coqlRes.text()).slice(0, 200)}`
      }
    } catch (err) {
      coqlError = err instanceof Error ? err.message : String(err)
    }

    return NextResponse.json({
      ok: coqlOk,
      grantedScope: scope,
      accessTokenExpiresIn: data.expires_in,
      distributorModuleReadable: true,
      sampleDistributor: sample ? { name: sample.Name ?? null } : null,
      // The part that actually drives distributor fee rates.
      coqlWorking: coqlOk,
      coqlError,
      distributorsWithShareCategory: shareCategoryRows,
      sampleShare,
      env,
      next: !coqlOk
        ? 'COQL is failing — distributor fee rates will fall back to legacy values. Re-run /api/auth/zoho/authorize to grant ZohoCRM.coql.READ.'
        : shareCategoryRows === 0
          ? 'COQL works but no distributor has Distributor_Share_Category set in Zoho.'
          : orgId
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
