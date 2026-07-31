// GET /api/auth/zoho/callback
//
// Zoho redirects here after consent with a one-time `code`, which this route
// exchanges for a refresh token. This is a one-off setup step, not part of any
// user flow: run it once, copy the refresh token into the environment, done.
//
// Register this exact URL as the redirect URI in the Zoho API console —
// Zoho matches it character for character:
//   https://myqode.qodeinvest.com/api/auth/zoho/callback
//
// SECURITY — why this differs from the equivalent route in new-qode-website:
// a Zoho refresh token does not expire. Rendering it into an HTML page puts a
// permanent CRM credential into browser history, any proxy log, and the
// browser cache. Here it is written to the server log (which you already
// control) and only a masked form is shown in the page. The full value is
// available via ?reveal=1 for the case where you have no log access, but that
// has to be asked for deliberately.
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Minimal HTML escaping — everything interpolated below is server-derived,
 *  but Zoho's error strings pass through and should not be trusted as markup. */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function page(title: string, bodyHtml: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  :root{--bg:#efecd3;--card:#f7f5e9;--fg:#002017;--muted:#37584f;--primary:#02422b;
        --gold:#dabd38;--danger:#ef4444;--rail:rgba(55,88,79,.2)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);padding:40px 20px;
       font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55}
  .wrap{max-width:660px;margin:0 auto}
  .card{background:var(--card);border:1px solid var(--rail);border-radius:16px;
        padding:28px;box-shadow:0 1px 2px rgba(0,32,23,.06)}
  h1{margin:0 0 6px;font-size:1.35rem}
  .sub{color:var(--muted);font-size:.92rem;margin:0 0 22px}
  .ok{color:var(--primary);font-weight:700}
  .bad{color:var(--danger);font-weight:700}
  .label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
         color:var(--muted);margin:20px 0 6px}
  .box{background:var(--bg);border:1px solid var(--rail);border-radius:10px;padding:12px 14px;
       font-family:ui-monospace,Menlo,monospace;font-size:12.5px;word-break:break-all}
  ol{padding-left:20px;margin:10px 0 0}
  li{margin-bottom:8px}
  code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
  pre{background:var(--bg);border:1px solid var(--rail);border-radius:10px;padding:12px 14px;
      overflow-x:auto;font-size:12.5px;margin:8px 0 0}
  .note{border-left:3px solid var(--gold);padding:10px 0 10px 14px;margin-top:22px;
        color:var(--muted);font-size:.9rem}
</style></head><body><div class="wrap"><div class="card">${bodyHtml}</div></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')
  // `reveal` may arrive directly, or via the `state` Zoho echoes back from
  // /authorize — Zoho discards any other params we try to pass through.
  const reveal =
    url.searchParams.get('reveal') === '1' || url.searchParams.get('state') === 'reveal'

  // ── Gate: same secret as /authorize ─────────────────────────────────────
  // Zoho does not forward our query params, so the secret is only enforced
  // when supplied — the real protection is that a `code` is single-use and
  // meaningless without the client secret held server-side.
  const setupSecret = process.env.ADMIN_SETUP_SECRET
  const provided = url.searchParams.get('secret') ?? request.headers.get('x-setup-secret')
  if (setupSecret && provided && provided !== setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (oauthError) {
    return page(
      'Zoho authorisation failed',
      `<h1 class="bad">Authorisation failed</h1>
       <p class="sub">Zoho declined the request.</p>
       <div class="label">Reason</div><div class="box">${esc(oauthError)}</div>
       <div class="note">If this says <code>invalid_scope</code>, the Self Client was most
       likely created under Zoho Recruit rather than CRM. Create it from the CRM side and
       try again.</div>`,
      400,
    )
  }

  if (!code) {
    return page(
      'Zoho authorisation',
      `<h1>No authorisation code</h1>
       <p class="sub">This URL is the OAuth redirect target — it is not meant to be opened directly.</p>
       <div class="note">Start the flow at
       <code>/api/auth/zoho/authorize?secret=&lt;ADMIN_SETUP_SECRET&gt;</code>.</div>`,
      400,
    )
  }

  const clientId = process.env.ZOHO_CRM_CLIENT_ID
  const clientSecret = process.env.ZOHO_CRM_CLIENT_SECRET
  const dataCenter = process.env.ZOHO_CRM_DATA_CENTER || process.env.ZOHO_DATA_CENTER || 'in'
  const redirectUri =
    process.env.ZOHO_CRM_REDIRECT_URI || `${url.origin}/api/auth/zoho/callback`

  if (!clientId || !clientSecret) {
    return page(
      'Zoho authorisation',
      `<h1 class="bad">Missing credentials</h1>
       <p class="sub">ZOHO_CRM_CLIENT_ID and ZOHO_CRM_CLIENT_SECRET must be set on the server.</p>`,
      500,
    )
  }

  try {
    // Zoho expects these as query parameters on a POST, not as a form body.
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })

    const res = await fetch(
      `https://accounts.zoho.${dataCenter}/oauth/v2/token?${params.toString()}`,
      { method: 'POST', cache: 'no-store' },
    )
    const data = await res.json().catch(() => ({}) as any)

    // Zoho returns HTTP 200 with an `error` field on failure, so status alone
    // is not a reliable success check.
    if (!res.ok || data.error) {
      const hint =
        data.error === 'invalid_code'
          ? 'The code was already used, expired (they last ~2 minutes), or was issued to a different client id. Start again at /api/auth/zoho/authorize.'
          : data.error === 'redirect_uri_mismatch'
            ? `The redirect URI must match the API console exactly. This server sent: ${redirectUri}`
            : 'Check the client id, secret and data centre.'
      return page(
        'Zoho authorisation failed',
        `<h1 class="bad">Token exchange failed</h1>
         <p class="sub">Zoho rejected the authorisation code.</p>
         <div class="label">Response</div><div class="box">${esc(JSON.stringify(data))}</div>
         <div class="note">${esc(hint)}</div>`,
        400,
      )
    }

    const refreshToken: string | undefined = data.refresh_token
    const scope: string = data.scope ?? ''
    const isCrmScoped = /ZohoCRM/i.test(scope)

    // The whole point of the exercise: a Recruit-scoped token cannot read CRM,
    // so say so plainly rather than letting it fail later at query time.
    if (!isCrmScoped) {
      return page(
        'Wrong scope granted',
        `<h1 class="bad">This token cannot read CRM</h1>
         <p class="sub">Zoho granted a token, but not for CRM.</p>
         <div class="label">Granted scope</div><div class="box">${esc(scope)}</div>
         <div class="note">The Self Client is registered against a different Zoho product.
         Create one from Zoho <strong>CRM</strong> and request
         <code>ZohoCRM.modules.READ</code>.</div>`,
        400,
      )
    }

    if (!refreshToken) {
      return page(
        'No refresh token returned',
        `<h1 class="bad">No refresh token</h1>
         <p class="sub">Zoho returned an access token but no refresh token.</p>
         <div class="note">This happens when <code>access_type=offline</code> was missing, or the
         app was already authorised. Retry via <code>/api/auth/zoho/authorize</code>, which forces
         a fresh consent.</div>`,
        400,
      )
    }

    // Log the credential server-side. This is the intended delivery channel —
    // it keeps the token out of browser history and any intermediary cache.
    console.log(
      '\n========================================================\n' +
      '[zoho/callback] REFRESH TOKEN — copy into .env, then remove\n' +
      `ZOHO_CRM_REFRESH_TOKEN=${refreshToken}\n` +
      `scope=${scope}\n` +
      '========================================================\n',
    )

    const masked = `${refreshToken.slice(0, 12)}${'•'.repeat(24)}${refreshToken.slice(-6)}`

    return page(
      'Zoho connected',
      `<h1 class="ok">Authorisation successful</h1>
       <p class="sub">A CRM-scoped refresh token has been issued.</p>

       <div class="label">Granted scope</div>
       <div class="box">${esc(scope)}</div>

       <div class="label">Refresh token</div>
       <div class="box">${esc(reveal ? refreshToken : masked)}</div>

       ${
         reveal
           ? ''
           : `<div class="note">The full token has been written to the <strong>server log</strong>
              rather than shown here — it never expires, so keeping it out of browser history is
              worth the extra step. If you cannot reach the logs, reload this page with
              <code>&amp;reveal=1</code>.</div>`
       }

       <div class="label">Next steps</div>
       <ol>
         <li>Copy the token from the server log into <code>.env</code>:
           <pre>ZOHO_CRM_REFRESH_TOKEN=&lt;token&gt;</pre></li>
         <li>Add <code>ZOHO_CRM_ORG_ID</code> — Zoho CRM → Setup → General → Company Details.</li>
         <li>Restart the server, then verify with
           <code>/api/auth/zoho/status?secret=&lt;ADMIN_SETUP_SECRET&gt;</code>.</li>
       </ol>

       <div class="note">The token grants read access to your CRM and does not expire.
       Treat it like a password: never commit it, and revoke it in the API console if exposed.</div>`,
    )
  } catch (err) {
    console.error('[zoho/callback] exchange error:', err)
    return page(
      'Zoho authorisation failed',
      `<h1 class="bad">Could not reach Zoho</h1>
       <p class="sub">The token exchange did not complete.</p>
       <div class="label">Error</div>
       <div class="box">${esc(err instanceof Error ? err.message : String(err))}</div>`,
      500,
    )
  }
}
