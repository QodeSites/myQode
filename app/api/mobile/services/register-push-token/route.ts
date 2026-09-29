// POST /api/mobile/services/register-push-token
// Stores or updates the user's Expo push token.
// Called by the mobile app on login and when the push token changes.
//
// The token is stored in client_push_tokens and used by lib/notifications.ts
// to deliver investment status updates (payment confirmed, deployed, SIP events, etc.)
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'
import { registerDevice, unregisterDevice } from '@/lib/appNotify'

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // The myQode app reports what happened on the phone when setting up popups (permission, token, server call).
  if (body?.app === 'myqode' && body?.diag) {
    console.log('[push diag]', user!.email, JSON.stringify(body.diag).slice(0, 600))
    return NextResponse.json({ success: true })
  }

  const { pushToken, platform } = body

  if (!pushToken || typeof pushToken !== 'string') {
    return NextResponse.json({ error: 'pushToken is required' }, { status: 400 })
  }

  // Validate Expo push token format
  const isValidExpoToken =
    pushToken.startsWith('ExponentPushToken[') ||
    pushToken.startsWith('ExpoPushToken[')

  if (!isValidExpoToken) {
    return NextResponse.json(
      { error: 'Invalid push token format. Expected ExponentPushToken[...] or ExpoPushToken[...]' },
      { status: 400 }
    )
  }

  if (platform && !['ios', 'android'].includes(platform)) {
    return NextResponse.json(
      { error: 'platform must be "ios" or "android"' },
      { status: 400 }
    )
  }

  // The myQode app sends app: 'myqode'. Its devices live in app_push_devices (lib/appNotify.ts), keyed by login
  // email: client_push_tokens holds the older Qode app's tokens, and Expo rejects a send that mixes two projects.
  // The store reviewer never registers. Admin viewing a client registers the phone under the ADMIN (the person
  // holding it, from the token's impersonatedBy), never under the client, so the client's popups can't reach it.
  if (body.app === 'myqode') {
    if (user!.isReviewer) return NextResponse.json({ success: true, skipped: true })
    const owner = user!.isImpersonated ? user!.impersonatedBy : user!.email
    if (!owner) return NextResponse.json({ success: true, skipped: true })
    try {
      await registerDevice(owner, pushToken, platform ?? null, typeof body.appVersion === 'string' ? body.appVersion.slice(0, 20) : null)
      return NextResponse.json({ success: true, registeredAs: user!.isImpersonated ? 'admin' : 'self' })
    } catch (err) {
      console.error('[mobile/services/register-push-token myqode]', err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }

  try {
    // Upsert: insert new token or reactivate existing one
    // UNIQUE constraint on (client_id, push_token) prevents duplicates
    await pool.query(
      `INSERT INTO client_push_tokens (client_id, nuvama_code, push_token, platform, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (client_id, push_token) DO UPDATE SET
         is_active   = TRUE,
         platform    = COALESCE(EXCLUDED.platform, client_push_tokens.platform),
         nuvama_code = COALESCE(EXCLUDED.nuvama_code, client_push_tokens.nuvama_code),
         updated_at  = NOW()`,
      [
        user!.clientId ?? user!.userId,
        user!.accountCodes?.[0] ?? null,
        pushToken,
        platform ?? null,
      ]
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[mobile/services/register-push-token]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/mobile/services/register-push-token
// Deregisters a push token (called on logout or when user disables notifications)
export async function DELETE(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { pushToken } = body

  if (!pushToken) {
    return NextResponse.json({ error: 'pushToken is required' }, { status: 400 })
  }

  if (body.app === 'myqode') {
    try { await unregisterDevice(String(pushToken)); return NextResponse.json({ success: true }) }
    catch (err) { console.error('[mobile/services/register-push-token DELETE myqode]', err); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }) }
  }

  try {
    await pool.query(
      `UPDATE client_push_tokens
       SET is_active = FALSE, updated_at = NOW()
       WHERE client_id = $1 AND push_token = $2`,
      [user!.clientId ?? user!.userId, pushToken]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[mobile/services/register-push-token DELETE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
