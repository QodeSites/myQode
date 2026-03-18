// GET /api/mobile/payments/investment-status?accountId=QFH0008
// Returns all investments for an account with their current Qode-side lifecycle status
// and a human-readable message the mobile app can show the investor.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

// ── Human-readable status messages ───────────────────────────────────────────
const STATUS_META: Record<string, { label: string; message: string; color: string; isTerminal: boolean }> = {
  PENDING_PAYMENT: {
    label: 'Payment Pending',
    message: 'Your payment is being processed by the bank.',
    color: '#F59E0B',
    isTerminal: false,
  },
  PAYMENT_SUCCESS: {
    label: 'Payment Confirmed',
    message: 'Your payment was successful. Funds are being settled to Qode (typically T+1 business day).',
    color: '#3B82F6',
    isTerminal: false,
  },
  SETTLED: {
    label: 'Funds Received',
    message: 'Qode has received your funds. We are deploying them into your strategy.',
    color: '#8B5CF6',
    isTerminal: false,
  },
  DEPLOYED: {
    label: 'Investment Live',
    message: 'Your funds have been deployed into your strategy. You can track performance in your portfolio.',
    color: '#10B981',
    isTerminal: true,
  },
  PAYMENT_FAILED: {
    label: 'Payment Failed',
    message: 'Your payment could not be processed. Please try again.',
    color: '#EF4444',
    isTerminal: true,
  },
  EXPIRED: {
    label: 'Order Expired',
    message: 'This payment order expired before completion. Please create a new investment.',
    color: '#6B7280',
    isTerminal: true,
  },
  CANCELLED: {
    label: 'Cancelled',
    message: 'This transaction was cancelled and the amount has been reversed.',
    color: '#6B7280',
    isTerminal: true,
  },
}

function formatINR(amount: number): string {
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }
  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         order_id, payment_type, amount, currency,
         payment_status, investment_status,
         cf_payment_id, payment_time, bank_reference,
         payment_method, payment_message,
         settlement_amount, transfer_utr,
         settled_at, deployed_at,
         created_at, updated_at,
         is_new_strategy, strategy_type
       FROM payment_transactions
       WHERE nuvama_code = $1
       ORDER BY created_at DESC`,
      [accountId]
    )

    const investments = rows.map((r: any) => {
      const status = r.investment_status ?? 'PENDING_PAYMENT'
      const meta   = STATUS_META[status] ?? STATUS_META['PENDING_PAYMENT']
      const amount = parseFloat(r.amount)

      // Build a timeline of completed steps for the UI
      const timeline = [
        {
          step: 'order_created',
          label: 'Order Created',
          completedAt: r.created_at,
          done: true,
        },
        {
          step: 'payment_confirmed',
          label: 'Payment Confirmed',
          completedAt: r.payment_time ?? null,
          done: ['PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED'].includes(status),
        },
        {
          step: 'funds_received',
          label: 'Funds Received by Qode',
          completedAt: r.settled_at ?? null,
          done: ['SETTLED', 'DEPLOYED'].includes(status),
        },
        {
          step: 'deployed',
          label: 'Deployed into Strategy',
          completedAt: r.deployed_at ?? null,
          done: status === 'DEPLOYED',
        },
      ]

      return {
        orderId: r.order_id,
        amount,
        formattedAmount: formatINR(amount),
        currency: r.currency ?? 'INR',
        paymentType: r.payment_type,
        isNewStrategy: r.is_new_strategy ?? false,
        strategyType: r.strategy_type ?? null,
        // Cashfree-level status
        paymentStatus: r.payment_status,
        // Qode investment lifecycle status
        investmentStatus: status,
        statusLabel: meta.label,
        statusMessage: meta.message,
        statusColor: meta.color,
        isTerminal: meta.isTerminal,
        // Key timestamps
        createdAt: r.created_at,
        paymentTime: r.payment_time ?? null,
        settledAt: r.settled_at ?? null,
        deployedAt: r.deployed_at ?? null,
        // Settlement details
        settlementAmount: r.settlement_amount ? parseFloat(r.settlement_amount) : null,
        transferUtr: r.transfer_utr ?? null,
        bankReference: r.bank_reference ?? null,
        // Timeline for step-indicator UI
        timeline,
      }
    })

    // Separate active (non-terminal) from completed
    const active    = investments.filter((i: any) => !i.isTerminal)
    const completed = investments.filter((i: any) => i.isTerminal)

    return NextResponse.json({
      accountId,
      active,
      completed,
      totalCount: investments.length,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[mobile/payments/investment-status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
