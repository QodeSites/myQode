// GET /api/cron/razorpay-reconcile
// Recovers payments whose webhook never arrived, expires genuinely stale orders,
// and reports SIP mandates held for payer verification.
//
// Recommended schedule: every 30 minutes. More frequent than the Cashfree
// settlement cron because this is the only backstop for a missed webhook, and
// a client staring at a "pending" payment they already made will call support.
//
// Protected by CRON_SECRET, matching /api/cron/investment-status.
import { NextRequest, NextResponse } from 'next/server'
import { runRazorpayReconcile } from '@/lib/razorpayReconcile'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
    ?? new URL(request.url).searchParams.get('secret')

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRazorpayReconcile()
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/razorpay-reconcile]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
