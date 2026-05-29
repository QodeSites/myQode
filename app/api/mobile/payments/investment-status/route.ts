// GET /api/mobile/payments/investment-status?accountId=QAW0009
// Returns all investments (one-time + SIP) for an account with:
//  - Qode investment lifecycle status + human-readable label/message/color
//  - Timeline of completed steps (for the step-indicator UI)
//  - For SIPs: individual charge history from sip_charges table
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

// ── Status metadata ───────────────────────────────────────────────────────────
// Covers both ONE-TIME payment lifecycle AND SIP subscription lifecycle.
const STATUS_META: Record<string, {
  label:      string
  message:    string
  color:      string
  isTerminal: boolean
}> = {
  // ── One-time payment lifecycle ─────────────────────────────────────────────
  PENDING_PAYMENT: {
    label:      'Payment Pending',
    message:    'Your payment is being processed by the bank.',
    color:      '#F59E0B',
    isTerminal: false,
  },
  PAYMENT_SUCCESS: {
    label:      'Payment Confirmed',
    message:    'Your payment was successful. Funds are being settled to Qode (typically T+1 business day).',
    color:      '#3B82F6',
    isTerminal: false,
  },
  SETTLED: {
    label:      'Funds Received',
    message:    'Qode has received your funds. We are deploying them into your strategy.',
    color:      '#8B5CF6',
    isTerminal: false,
  },
  DEPLOYED: {
    label:      'Investment Live',
    message:    'Your funds have been deployed into your strategy. You can track performance in your portfolio.',
    color:      '#10B981',
    isTerminal: true,
  },
  PAYMENT_FAILED: {
    label:      'Payment Failed',
    message:    'Your payment could not be processed. Please try again.',
    color:      '#EF4444',
    isTerminal: true,
  },
  EXPIRED: {
    label:      'Order Expired',
    message:    'This payment order expired before completion. Please create a new investment.',
    color:      '#6B7280',
    isTerminal: true,
  },
  CANCELLED: {
    label:      'Cancelled',
    message:    'This transaction was cancelled and the amount has been reversed.',
    color:      '#6B7280',
    isTerminal: true,
  },

  // ── SIP subscription lifecycle ─────────────────────────────────────────────
  SIP_ACTIVE: {
    label:      'SIP Active',
    message:    'Your SIP mandate is active. Charges will be debited automatically on schedule.',
    color:      '#10B981',
    isTerminal: false,
  },
  SIP_PAUSED: {
    label:      'SIP Paused',
    message:    'Your SIP is paused. No charges will be made until you resume it.',
    color:      '#F59E0B',
    isTerminal: false,
  },
  SIP_MANDATE_FAILED: {
    label:      'Mandate Failed',
    message:    'The bank mandate for your SIP could not be authorized. Please set up a new SIP.',
    color:      '#EF4444',
    isTerminal: true,
  },
  SIP_CANCELLED: {
    label:      'SIP Cancelled',
    message:    'Your SIP has been cancelled. No further charges will be made.',
    color:      '#6B7280',
    isTerminal: true,
  },
  SIP_COMPLETED: {
    label:      'SIP Completed',
    message:    'All installments have been processed. Your SIP journey is complete.',
    color:      '#10B981',
    isTerminal: true,
  },
}

// Fallback for unknown or NULL status values
const UNKNOWN_META = STATUS_META['PENDING_PAYMENT']

function formatINR(amount: number): string {
  return `₹${Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

// ── Build timeline for one-time investments ───────────────────────────────────
function buildOneTimeTimeline(r: any, status: string) {
  return [
    {
      step:        'order_created',
      label:       'Order Created',
      completedAt: r.created_at,
      done:        true,
    },
    {
      step:        'payment_confirmed',
      label:       'Payment Confirmed',
      completedAt: r.payment_time ?? null,
      done:        ['PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED'].includes(status),
    },
    {
      step:        'funds_received',
      label:       'Funds Received by Qode',
      completedAt: r.settled_at ?? null,
      done:        ['SETTLED', 'DEPLOYED'].includes(status),
    },
    {
      step:        'deployed',
      label:       'Deployed into Strategy',
      completedAt: r.deployed_at ?? null,
      done:        status === 'DEPLOYED',
    },
  ]
}

// ── Build timeline for SIP subscriptions ─────────────────────────────────────
function buildSipTimeline(r: any, status: string) {
  const isActive    = status === 'SIP_ACTIVE'
  const isCancelled = ['SIP_CANCELLED', 'SIP_COMPLETED', 'SIP_MANDATE_FAILED', 'EXPIRED', 'CANCELLED'].includes(status)

  return [
    {
      step:        'sip_created',
      label:       'SIP Created',
      completedAt: r.created_at,
      done:        true,
    },
    {
      step:        'mandate_authorized',
      label:       'Mandate Authorized',
      completedAt: isActive ? r.updated_at : null,
      done:        isActive || isCancelled,
    },
    {
      step:        'first_charge',
      label:       'First Charge',
      completedAt: r.next_charge_date ?? r.start_date ?? null,
      done:        isActive && (r.charges_count ?? 0) > 0,
    },
  ]
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (!accountId) {
    return NextResponse.json(
      { error: 'accountId is required', available: user!.accountCodes },
      { status: 400 }
    )
  }
  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // ── Fetch all transactions ───────────────────────────────────────────────
    const { rows } = await pool.query(
      `SELECT
         pt.order_id, pt.payment_type, pt.amount, pt.currency,
         pt.payment_status, pt.investment_status,
         pt.cf_payment_id, pt.payment_time, pt.bank_reference,
         pt.payment_method, pt.payment_message,
         pt.settlement_amount, pt.transfer_utr,
         pt.settled_at, pt.deployed_at,
         pt.created_at, pt.updated_at,
         pt.is_new_strategy, pt.strategy_type,
         -- SIP-specific fields
         pt.frequency, pt.start_date, pt.end_date,
         pt.total_installments, pt.next_charge_date,
         pt.cf_subscription_id,
         -- SIP charge summary (count, last successful charge date)
         COUNT(sc.id)                                  AS charges_count,
         COUNT(sc.id) FILTER (WHERE sc.charge_status = 'SUCCESS')  AS successful_charges,
         COUNT(sc.id) FILTER (WHERE sc.charge_status = 'FAILED')   AS failed_charges,
         MAX(sc.payment_time) FILTER (WHERE sc.charge_status = 'SUCCESS') AS last_charge_time
       FROM payment_transactions pt
       LEFT JOIN sip_charges sc ON sc.subscription_id = pt.order_id
       WHERE pt.nuvama_code = $1
       GROUP BY pt.order_id, pt.payment_type, pt.amount, pt.currency,
                pt.payment_status, pt.investment_status,
                pt.cf_payment_id, pt.payment_time, pt.bank_reference,
                pt.payment_method, pt.payment_message,
                pt.settlement_amount, pt.transfer_utr,
                pt.settled_at, pt.deployed_at,
                pt.created_at, pt.updated_at,
                pt.is_new_strategy, pt.strategy_type,
                pt.frequency, pt.start_date, pt.end_date,
                pt.total_installments, pt.next_charge_date,
                pt.cf_subscription_id
       ORDER BY pt.created_at DESC`,
      [accountId]
    )

    // ── Fetch recent SIP charge history for each SIP subscription ───────────
    // Load the last 12 charges per SIP to show charge history in the app
    const sipOrders = rows.filter((r: any) => r.payment_type === 'SIP')
    let sipChargesMap: Record<string, any[]> = {}

    if (sipOrders.length > 0) {
      const subscriptionIds = sipOrders.map((r: any) => r.order_id)
      const { rows: chargeRows } = await pool.query(
        `SELECT
           subscription_id,
           installment_number,
           charge_amount,
           charge_status,
           cf_payment_id,
           payment_time,
           charge_date,
           failure_reason,
           retry_count
         FROM sip_charges
         WHERE subscription_id = ANY($1)
         ORDER BY charge_date DESC, created_at DESC`,
        [subscriptionIds]
      )
      // Group by subscription_id
      for (const charge of chargeRows) {
        if (!sipChargesMap[charge.subscription_id]) {
          sipChargesMap[charge.subscription_id] = []
        }
        sipChargesMap[charge.subscription_id].push({
          installmentNumber: charge.installment_number,
          amount:            parseFloat(charge.charge_amount),
          formattedAmount:   formatINR(parseFloat(charge.charge_amount)),
          status:            charge.charge_status,
          cfPaymentId:       charge.cf_payment_id,
          paidAt:            charge.payment_time,
          chargeDate:        charge.charge_date,
          failureReason:     charge.failure_reason,
          retryCount:        charge.retry_count,
        })
      }
    }

    // ── Map to response objects ──────────────────────────────────────────────
    const investments = rows.map((r: any) => {
      const status = r.investment_status ?? 'PENDING_PAYMENT'
      const meta   = STATUS_META[status] ?? UNKNOWN_META
      const amount = parseFloat(r.amount)
      const isSip  = r.payment_type === 'SIP'

      const timeline = isSip
        ? buildSipTimeline(r, status)
        : buildOneTimeTimeline(r, status)

      const base = {
        orderId:         r.order_id,
        amount,
        formattedAmount: formatINR(amount),
        currency:        r.currency ?? 'INR',
        paymentType:     r.payment_type,
        isNewStrategy:   r.is_new_strategy ?? false,
        strategyType:    r.strategy_type ?? null,
        // Cashfree-level status (raw)
        paymentStatus:   r.payment_status,
        // Qode lifecycle status
        investmentStatus: status,
        statusLabel:      meta.label,
        statusMessage:    meta.message,
        statusColor:      meta.color,
        isTerminal:       meta.isTerminal,
        // Timestamps
        createdAt:   r.created_at,
        updatedAt:   r.updated_at,
        paymentTime: r.payment_time  ?? null,
        settledAt:   r.settled_at    ?? null,
        deployedAt:  r.deployed_at   ?? null,
        // Settlement details (one-time)
        settlementAmount: r.settlement_amount ? parseFloat(r.settlement_amount) : null,
        transferUtr:      r.transfer_utr  ?? null,
        bankReference:    r.bank_reference ?? null,
        // UI timeline
        timeline,
      }

      if (isSip) {
        return {
          ...base,
          // SIP-specific fields
          frequency:          r.frequency,
          startDate:          r.start_date,
          endDate:            r.end_date ?? null,
          totalInstallments:  r.total_installments ?? null,
          nextChargeDate:     r.next_charge_date ?? null,
          cfSubscriptionId:   r.cf_subscription_id ?? null,
          // Charge summary
          chargesCount:       parseInt(r.charges_count ?? '0', 10),
          successfulCharges:  parseInt(r.successful_charges ?? '0', 10),
          failedCharges:      parseInt(r.failed_charges ?? '0', 10),
          lastChargeTime:     r.last_charge_time ?? null,
          // Individual charge history
          chargeHistory:      sipChargesMap[r.order_id] ?? [],
        }
      }

      return base
    })

    // ── Separate by type and terminal state ──────────────────────────────────
    const oneTimeActive    = investments.filter((i: any) => i.paymentType !== 'SIP' && !i.isTerminal)
    const oneTimeCompleted = investments.filter((i: any) => i.paymentType !== 'SIP' && i.isTerminal)
    const sipActive        = investments.filter((i: any) => i.paymentType === 'SIP' && !i.isTerminal)
    const sipCompleted     = investments.filter((i: any) => i.paymentType === 'SIP' && i.isTerminal)

    return NextResponse.json({
      accountId,
      // Backwards-compatible shape (active = all non-terminal, completed = all terminal)
      active:    [...oneTimeActive, ...sipActive],
      completed: [...oneTimeCompleted, ...sipCompleted],
      // Broken out by type for UIs that want separate sections
      oneTime: { active: oneTimeActive, completed: oneTimeCompleted },
      sip:     { active: sipActive,     completed: sipCompleted     },
      totalCount:  investments.length,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[mobile/payments/investment-status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
