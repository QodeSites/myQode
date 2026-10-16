// GET /api/mobile/requests — the signed-in client's requests (strategy questions, queries, account / family requests,
// referrals, strategy switches) with their live status in Zoho: lib/requestTracking.ts.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { listRequests } from '@/lib/requestTracking'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer) return NextResponse.json({ requests: [] })
  try {
    const requests = await listRequests(user!.email, user!.accountCodes || [])
    return NextResponse.json({ requests })
  } catch (err) {
    console.error('[mobile/requests]', err)
    return NextResponse.json({ error: 'Could not load your requests' }, { status: 502 })
  }
}
