// GET /api/mobile/services/transactions?accountId=QFH0008
// Returns Cashfree payment transactions (one-time + SIP) for the given account.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  try {
    const result = await pool.query(
      `SELECT
         order_id, payment_type, amount, currency,
         payment_status, created_at, frequency, start_date
       FROM payment_transactions
       WHERE nuvama_code = $1
       ORDER BY created_at DESC`,
      [accountId]
    )

    const transactions = result.rows.map((r: any) => ({
      orderId: r.order_id,
      type: r.payment_type,           // ONE_TIME | SIP
      amount: parseFloat(r.amount),
      currency: r.currency || 'INR',
      status: r.payment_status,       // PAID | EXPIRED | PENDING | PROCESSING
      date: r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : null,
      frequency: r.frequency ? capitalise(r.frequency) : 'One-time',
      startDate: r.start_date ?? null,
    }))

    return NextResponse.json({
      transactions,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[mobile/services/transactions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
