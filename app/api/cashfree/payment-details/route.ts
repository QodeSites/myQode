// GET /api/cashfree/payment-details?order_id=qode_xxx
// Internal endpoint used by the web dashboard to fetch payment details.
// Auth: session cookie (web users only — not mobile JWT).
// Security: never expose other clients' data in error responses.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

// Fields safe to return — excludes raw payment_session_id and sensitive bank details
const SAFE_FIELDS = `
  id, order_id, cf_order_id, cf_subscription_id,
  client_id, nuvama_code, client_name,
  amount, currency, payment_type, payment_status, investment_status,
  account_number, ifsc_code, frequency, start_date, end_date,
  total_installments, next_charge_date,
  created_at, updated_at, canceled_at,
  is_new_strategy, strategy_type,
  settlement_amount, transfer_utr, settled_at, deployed_at
`

function mapTransaction(tx: any) {
  return {
    id:                tx.id,
    order_id:          tx.order_id,
    cf_order_id:       tx.cf_order_id,
    cf_subscription_id: tx.cf_subscription_id,
    client_id:         tx.client_id,
    nuvama_code:       tx.nuvama_code,
    client_name:       tx.client_name,
    amount:            tx.amount,
    currency:          tx.currency,
    payment_type:      tx.payment_type,
    payment_status:    tx.payment_status,
    investment_status: tx.investment_status,
    account_number:    tx.account_number,
    ifsc_code:         tx.ifsc_code,
    frequency:         tx.frequency,
    start_date:        tx.start_date,
    end_date:          tx.end_date,
    total_installments: tx.total_installments,
    next_charge_date:  tx.next_charge_date,
    created_at:        tx.created_at,
    updated_at:        tx.updated_at,
    canceled_at:       tx.canceled_at,
    is_new_strategy:   tx.is_new_strategy ?? false,
    strategy_type:     tx.strategy_type,
    settlement_amount: tx.settlement_amount,
    transfer_utr:      tx.transfer_utr,
    settled_at:        tx.settled_at,
    deployed_at:       tx.deployed_at,
    // Derived field for convenience
    transaction_type:  tx.payment_type ?? (tx.frequency ? 'SIP' : 'ONE_TIME'),
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('order_id')?.trim()

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'order_id is required' },
        { status: 400 }
      )
    }

    // Exact match first (order_id, cf_order_id, or cf_subscription_id)
    const result = await query(
      `SELECT ${SAFE_FIELDS}
       FROM payment_transactions
       WHERE order_id = $1
          OR cf_order_id = $1
          OR cf_subscription_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId]
    )

    if (result.rows.length > 0) {
      return NextResponse.json({
        success: true,
        payment: mapTransaction(result.rows[0]),
      })
    }

    // Strict 404 — no debugging info, no other clients' data in the response
    return NextResponse.json(
      { success: false, error: 'Payment not found' },
      { status: 404 }
    )
  } catch (error: any) {
    console.error('[payment-details] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
