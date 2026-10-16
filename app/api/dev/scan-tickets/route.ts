// GET /api/dev/scan-tickets — runs the ticket-status scan once, right now (lib/appNotifyTriggers.ts scanTickets), so a
// developer can test ticket notifications without the notification worker (which runs only on the production server,
// every 5 minutes). Development servers only: on production this route does not exist (404).
// Note: dev and production share the database, so a notification written here also shows in that client's inbox there.
import { NextResponse } from 'next/server'
import { scanTickets } from '@/lib/appNotifyTriggers'

export async function GET() {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const sent = await scanTickets()
    return NextResponse.json({ ok: true, notificationsWritten: sent })
  } catch (err: any) {
    console.error('[api/dev/scan-tickets]', err?.message)
    return NextResponse.json({ error: err?.message || 'Scan failed' }, { status: 500 })
  }
}
