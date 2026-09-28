// GET /api/cron/notifications (x-cron-secret header): runs every app-notification job now (lib/appNotifyWorker.ts).
// A backup for the in-process worker; refuses to run unless CRON_SECRET is set.
import { NextRequest, NextResponse } from 'next/server'
import { tick } from '@/lib/appNotifyWorker'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ success: true, ...(await tick(true)), timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/notifications]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
