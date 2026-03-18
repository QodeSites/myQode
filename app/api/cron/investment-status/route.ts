// GET /api/cron/investment-status
// Protected cron endpoint — call this from Vercel Cron, Railway cron, or any scheduler.
// Recommended schedule: "0 3,6 * * *" (9am and 12pm IST = 3:30am and 6:30am UTC)
//
// Protect with CRON_SECRET env var to prevent unauthorized calls.
import { NextRequest, NextResponse } from 'next/server'
import { runInvestmentStatusCron } from '@/lib/investmentStatusCron'

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
    ?? new URL(request.url).searchParams.get('secret')

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runInvestmentStatusCron()
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/investment-status]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
