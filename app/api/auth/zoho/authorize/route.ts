// GET /api/auth/zoho/authorize
//
// Starts the Zoho OAuth consent flow. Visit this in a browser while signed in
// to Zoho as an admin; it redirects to Zoho, you approve, and Zoho sends you
// back to /api/auth/zoho/callback with a one-time code.
//
// This exists because the refresh token is issued PER APP: a client id/secret
// from a new Self Client cannot reuse a refresh token minted for a different
// app (Zoho answers `invalid_code`). The token must be generated through this
// flow, using these exact credentials.
//
// Protected by ADMIN_SETUP_SECRET — anyone who can reach an unprotected
// version of this route can begin an OAuth grant against your CRM.
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Scopes requested.
 *
 * Read-only on purpose: this integration reads distributor and investor fee
 * data. It has no reason to be able to modify records in the CRM, and a token
 * that cannot write is a token that cannot damage anything if it leaks.
 *
 *  - ZohoCRM.modules.READ          record data (Distributor, Investors, the link)
 *  - ZohoCRM.settings.modules.READ module + field metadata
 *  - ZohoCRM.coql.READ             the COQL query endpoint used for the joins
 */
const SCOPES = [
  'ZohoCRM.modules.READ',
  'ZohoCRM.settings.modules.READ',
  'ZohoCRM.coql.READ',
].join(',')

export async function GET(request: NextRequest) {
  const url = new URL(request.url)

  // ── Gate ────────────────────────────────────────────────────────────────
  const setupSecret = process.env.ADMIN_SETUP_SECRET
  if (setupSecret) {
    const provided = url.searchParams.get('secret') ?? request.headers.get('x-setup-secret')
    if (provided !== setupSecret) {
      return NextResponse.json(
        { error: 'Unauthorized. Append ?secret=<ADMIN_SETUP_SECRET>.' },
        { status: 401 },
      )
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Refuse rather than expose an open OAuth initiator in production.
    return NextResponse.json(
      {
        error: 'ADMIN_SETUP_SECRET is not configured.',
        hint: 'Set ADMIN_SETUP_SECRET in the environment before using this route in production.',
      },
      { status: 503 },
    )
  }

  const clientId = process.env.ZOHO_CRM_CLIENT_ID
  const dataCenter = process.env.ZOHO_CRM_DATA_CENTER || process.env.ZOHO_DATA_CENTER || 'in'
  const redirectUri =
    process.env.ZOHO_CRM_REDIRECT_URI || `${url.origin}/api/auth/zoho/callback`

  if (!clientId) {
    return NextResponse.json(
      { error: 'ZOHO_CRM_CLIENT_ID is not set in the environment.' },
      { status: 500 },
    )
  }

  const authUrl = new URL(`https://accounts.zoho.${dataCenter}/oauth/v2/auth`)
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  // Zoho drops any extra query params we add, but echoes `state` back verbatim.
  // That is the only way to carry `reveal` through the redirect, so someone
  // without server-log access can still retrieve the token from the callback.
  if (url.searchParams.get('reveal') === '1') {
    authUrl.searchParams.set('state', 'reveal')
  }
  // offline is what makes Zoho return a refresh_token rather than only an
  // access token — without it the callback succeeds but yields nothing durable.
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  // Forces the consent screen even if this app was approved before, so a
  // re-run reliably mints a new refresh token instead of silently skipping.
  authUrl.searchParams.set('prompt', 'consent')

  console.log(
    `[zoho/authorize] redirecting to Zoho consent — dc=${dataCenter} redirect_uri=${redirectUri}`,
  )

  return NextResponse.redirect(authUrl.toString())
}
