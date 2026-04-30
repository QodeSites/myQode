// GET /api/mobile/payments/verify?orderId=qode_1760325214059_sd8bbx
// Fetches live order + payment status from Cashfree and syncs it to DB.
// Called by the mobile app after the Cashfree React Native SDK completes.
import { NextRequest, NextResponse } from 'next/server'
import { Cashfree, CFEnvironment } from 'cashfree-pg'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import pool from '@/lib/db'

function initCashfree() {
  const clientId = process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID
  const clientSecret = process.env.CASHFREE_SECRET_KEY
  const environment =
    process.env.CASHFREE_ENVIRONMENT === 'production'
      ? CFEnvironment.PRODUCTION
      : CFEnvironment.SANDBOX
  if (!clientId || !clientSecret) throw new Error('Cashfree credentials not configured')
  return new Cashfree(environment, clientId, clientSecret)
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('orderId')

  if (!orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  try {
    // Verify the order belongs to this user
    const txRes = await pool.query(
      `SELECT nuvama_code, client_id, amount, payment_type, payment_status
       FROM payment_transactions WHERE order_id = $1 LIMIT 1`,
      [orderId]
    )
    if (txRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    const tx = txRes.rows[0]
    if (!user!.accountCodes?.includes(tx.nuvama_code)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch live status from Cashfree
    const cashfree = initCashfree()
    const orderResp = await cashfree.PGFetchOrder(orderId)
    const cfOrder: any = orderResp.data

    // Fetch payments for this order
    const paymentsResp = await cashfree.PGOrderFetchPayments(orderId)
    const payments: any[] = paymentsResp.data ?? []

    // Latest payment (highest cf_payment_id or most recent)
    const latestPayment = payments.sort((a: any, b: any) =>
      Number(b.cf_payment_id) - Number(a.cf_payment_id)
    )[0] ?? null

    const paymentStatus: string = (latestPayment?.payment_status ?? cfOrder.order_status ?? 'UNKNOWN').toUpperCase()

    // Map Cashfree payment_status → Qode investment_status (mirrors webhook logic)
    function toInvestmentStatus(ps: string): string {
      switch (ps) {
        case 'SUCCESS':      return 'PAYMENT_SUCCESS'
        case 'FAILED':
        case 'FLAGGED':      return 'PAYMENT_FAILED'
        case 'USER_DROPPED':
        case 'PENDING':      return 'PENDING_PAYMENT'
        case 'CANCELLED':
        case 'VOID':         return 'CANCELLED'
        default:             return 'PENDING_PAYMENT'
      }
    }
    const investStatus = toInvestmentStatus(paymentStatus)

    // Sync status back to DB if changed — never downgrade terminal states
    if (latestPayment && tx.payment_status !== paymentStatus) {
      await pool.query(
        `UPDATE payment_transactions
         SET payment_status    = $1,
             investment_status = CASE
               WHEN investment_status IN ('DEPLOYED','SETTLED','CANCELLED','PAYMENT_FAILED','EXPIRED')
                 THEN investment_status
               ELSE $2
             END,
             cf_payment_id  = $3,
             payment_time   = $4,
             bank_reference = $5,
             payment_method = $6,
             payment_message= $7,
             updated_at     = NOW()
         WHERE order_id = $8`,
        [
          paymentStatus,
          investStatus,
          latestPayment.cf_payment_id ?? null,
          latestPayment.payment_time ? new Date(latestPayment.payment_time) : null,
          latestPayment.bank_reference ?? null,
          latestPayment.payment_method ? JSON.stringify(latestPayment.payment_method) : null,
          latestPayment.payment_message ?? null,
          orderId,
        ]
      )
    }

    return NextResponse.json({
      orderId,
      orderStatus: cfOrder.order_status,
      orderAmount: cfOrder.order_amount,
      orderCurrency: cfOrder.order_currency ?? 'INR',
      paymentStatus,                          // SUCCESS | FAILED | PENDING | USER_DROPPED
      isSuccess: paymentStatus === 'SUCCESS',
      payment: latestPayment
        ? {
            cfPaymentId: latestPayment.cf_payment_id,
            amount: latestPayment.payment_amount,
            time: latestPayment.payment_time,
            method: latestPayment.payment_group ?? null,   // upi | card | netbanking
            bankReference: latestPayment.bank_reference ?? null,
            message: latestPayment.payment_message ?? null,
          }
        : null,
    })
  } catch (err: any) {
    console.error('[mobile/payments/verify]', err)
    const details = err.response?.data ?? err.message ?? String(err)
    return NextResponse.json(
      { error: 'Payment verification failed', details },
      { status: 500 }
    )
  }
}
