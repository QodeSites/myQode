// POST /api/mobile/auth/logout  { os? } → { ok: true }
// The app calls this when the user signs out, so sign-outs appear in analytics (auth_events). The token itself
// is stateless (JWT): signing out is done on the phone; this only records it. Always answers 200.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { logAuthEvent, osFrom } from '@/lib/authEvents'

export async function POST(request: NextRequest) {
  const { user } = await verifyMobileAuth(request)
  let body: any = {}
  try { body = await request.json() } catch {}
  // Admin viewing a client is not the client signing out; the reviewer is not a person.
  if (user && !user.isReviewer && !user.isImpersonated) {
    void logAuthEvent(request, {
      email: user.email, event: 'logout', platform: (user as any).isAdmin ? 'admin' : 'app', os: osFrom(body),
      meta: user.isDistributor ? { role: 'distributor' } : undefined,
    })
  }
  return NextResponse.json({ ok: true })
}
