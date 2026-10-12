// GET /api/auth/zoho/desk-status?secret=<ADMIN_SETUP_SECRET>
// Setup check for Zoho Desk tickets (lib/zohoDesk.ts): whether the Desk token is set and works, whether tickets are
// created on this server, and the Desk organisations and departments it sees, so ZOHO_DESK_ORG_ID and
// ZOHO_DESK_DEPARTMENT_ID can be chosen. Read-only.
import { NextRequest, NextResponse } from 'next/server'
import { deskConfigured, deskLive, deskDirectory } from '@/lib/zohoDesk'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const setupSecret = process.env.ADMIN_SETUP_SECRET
  if (setupSecret) {
    const provided = url.searchParams.get('secret') ?? request.headers.get('x-setup-secret')
    if (provided !== setupSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'ADMIN_SETUP_SECRET is not configured.' }, { status: 503 })
  }
  if (!deskConfigured()) {
    return NextResponse.json({
      configured: false,
      next: 'Open /api/auth/zoho/authorize?desk=1 (with ?secret=… when ADMIN_SETUP_SECRET is set), signed in to Zoho as a Desk agent, then set ZOHO_DESK_REFRESH_TOKEN in .env and restart.',
    })
  }
  try {
    const dir = await deskDirectory()
    return NextResponse.json({
      configured: true, createsTickets: deskLive(),
      orgId: process.env.ZOHO_DESK_ORG_ID || '(first organisation)',
      department: process.env.ZOHO_DESK_DEPARTMENT_ID || process.env.ZOHO_DESK_DEPARTMENT || '(first department)',
      ...dir,
    })
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: e?.message || 'Zoho Desk did not answer' }, { status: 502 })
  }
}
