// POST /api/razorpay/subscriptions/create — start a SIP (recurring mandate).
//
// Razorpay's model differs from Cashfree's in a way that shapes this route:
// Cashfree accepts inline plan details on the subscription; Razorpay requires a
// Plan entity to exist first, and a plan is immutable once created. Since each
// client picks their own SIP amount, a plan is created per (amount, frequency)
// combination and reused via a local cache table lookup.
//
// TPV IS DISABLED on this account, so nothing here can stop a client
// authorising the mandate from a third-party bank account. Activation is
// therefore gated on the post-authorisation check in ./verify-payer.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import pool from '@/lib/db'
import db1 from '@/lib/db1'
import {
  getRazorpayClient,
  getRazorpayConfig,
  validateInvestmentAmount,
  toRupees,
  generateReceiptId,
  normaliseRazorpayError,
  RazorpayError,
} from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

type Frequency = 'monthly' | 'quarterly' | 'yearly' | 'weekly' | 'daily'

interface CreateSubscriptionBody {
  amount:       number | string
  nuvama_code:  string
  frequency:    Frequency
  start_date?:  string   // YYYY-MM-DD
  total_installments?: number
  strategy_type?: string
}

interface SessionClient { clientid: string; clientcode: string }

/** Maps a business frequency to Razorpay plan period/interval. */
function toPlanPeriod(frequency: Frequency): { period: string; interval: number } {
  switch (frequency) {
    case 'daily':     return { period: 'daily',   interval: 1 }
    case 'weekly':    return { period: 'weekly',  interval: 1 }
    case 'monthly':   return { period: 'monthly', interval: 1 }
    case 'quarterly': return { period: 'monthly', interval: 3 }
    case 'yearly':    return { period: 'yearly',  interval: 1 }
    default:          return { period: 'monthly', interval: 1 }
  }
}

/** Razorpay caps total_count by period; keep well inside the limits. */
function maxCycles(period: string): number {
  switch (period) {
    case 'daily':   return 365
    case 'weekly':  return 520      // ~10 years
    case 'yearly':  return 10
    default:        return 120      // monthly — 10 years
  }
}

async function getSessionClients(): Promise<SessionClient[] | null> {
  const cookieStore = await cookies()
  if (cookieStore.get('qode-auth')?.value !== '1') return null
  const raw = cookieStore.get('qode-clients')?.value
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Finds or creates a Razorpay plan for this (amount, period, interval) triple.
 *
 * Plans are immutable and accumulate in the Razorpay dashboard, so they are
 * cached in razorpay_plans to avoid creating a duplicate on every SIP signup.
 */
async function getOrCreatePlan(
  amountPaise: number,
  period: string,
  interval: number,
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT razorpay_plan_id FROM razorpay_plans
      WHERE amount_paise = $1 AND period = $2 AND interval_count = $3
      LIMIT 1`,
    [amountPaise, period, interval],
  )
  if (rows.length) return rows[0].razorpay_plan_id

  let plan: any
  try {
    plan = await getRazorpayClient().plans.create({
      period: period as any,
      interval,
      item: {
        name: `Qode SIP ${period} x${interval} - ${toRupees(amountPaise)}`,
        amount: amountPaise,
        currency: 'INR',
        description: `Qode systematic investment plan, ${toRupees(amountPaise)} ${period}`,
      },
    } as any)
  } catch (err) {
    throw normaliseRazorpayError(err)
  }

  // ON CONFLICT handles two concurrent signups racing to create the same plan;
  // the loser reuses the winner's plan rather than erroring.
  const { rows: saved } = await pool.query(
    `INSERT INTO razorpay_plans (razorpay_plan_id, amount_paise, period, interval_count, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (amount_paise, period, interval_count)
       DO UPDATE SET razorpay_plan_id = razorpay_plans.razorpay_plan_id
     RETURNING razorpay_plan_id`,
    [plan.id, amountPaise, period, interval],
  )

  return saved[0].razorpay_plan_id
}

export async function POST(request: NextRequest) {
  try {
    const sessionClients = await getSessionClients()
    if (sessionClients === null) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated', error_code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    let body: CreateSubscriptionBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', error_code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const { amount, nuvama_code, frequency = 'monthly', start_date, total_installments, strategy_type } = body

    if (!nuvama_code) {
      return NextResponse.json(
        { success: false, error: 'nuvama_code is required', error_code: 'MISSING_NUVAMA_CODE' },
        { status: 400 },
      )
    }

    const validFrequencies: Frequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    if (!validFrequencies.includes(frequency)) {
      return NextResponse.json(
        { success: false, error: `Invalid frequency. Expected one of: ${validFrequencies.join(', ')}`, error_code: 'INVALID_FREQUENCY' },
        { status: 400 },
      )
    }

    // Authorise the account against the session, as in create-order.
    const ownsAccount = sessionClients.some(
      (c) => c.clientcode === nuvama_code || c.clientid === nuvama_code,
    )
    if (!ownsAccount) {
      return NextResponse.json(
        { success: false, error: 'This account is not linked to your login.', error_code: 'ACCOUNT_NOT_OWNED' },
        { status: 403 },
      )
    }

    const amountPaise = validateInvestmentAmount(amount)

    // Registered profile — also the reference the payer check will compare to.
    const { rows: bankRows } = await db1.query(
      `SELECT nuvama_code, client_name, phone_number, email, account_number, ifsc_code
         FROM pms_clients_tracker.pms_clients_bank_details
        WHERE nuvama_code = $1
        LIMIT 1`,
      [nuvama_code],
    )

    if (!bankRows.length) {
      return NextResponse.json(
        { success: false, error: 'No registered profile found for this account.', error_code: 'CLIENT_PROFILE_NOT_FOUND' },
        { status: 404 },
      )
    }

    const client = bankRows[0]

    // Refuse up front if there is no registered account to verify against —
    // the mandate would be permanently stuck in UNVERIFIABLE otherwise.
    if (!client.account_number) {
      return NextResponse.json(
        {
          success: false,
          error: 'No registered bank account is on file for this account. Please contact support before starting a SIP.',
          error_code: 'NO_REGISTERED_BANK_ACCOUNT',
        },
        { status: 409 },
      )
    }

    const clientId = sessionClients.find((c) => c.clientcode === nuvama_code)?.clientid ?? nuvama_code

    const { period, interval } = toPlanPeriod(frequency)
    const planId = await getOrCreatePlan(amountPaise, period, interval)

    // start_at must be in the future. Razorpay rejects a past timestamp, and a
    // same-day start races the mandate authorisation, so default to tomorrow.
    let startAt: number | undefined
    if (start_date) {
      const parsed = new Date(`${start_date}T00:00:00+05:30`)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { success: false, error: 'Invalid start_date. Use YYYY-MM-DD.', error_code: 'INVALID_START_DATE' },
          { status: 400 },
        )
      }
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      startAt = Math.floor((parsed > tomorrow ? parsed : tomorrow).getTime() / 1000)
    }

    const receipt = generateReceiptId('qsip')
    const totalCount = Math.min(total_installments ?? maxCycles(period), maxCycles(period))

    let subscription: any
    try {
      subscription = await getRazorpayClient().subscriptions.create({
        plan_id:     planId,
        total_count: totalCount,
        quantity:    1,
        customer_notify: 1,
        ...(startAt && { start_at: startAt }),
        notes: {
          nuvama_code,
          client_id: String(clientId),
          client_name: String(client.client_name ?? ''),
          receipt,
          frequency,
          source: 'qode_investor_portal_web',
          ...(strategy_type && { strategy_type: String(strategy_type) }),
        },
      } as any)
    } catch (err) {
      throw normaliseRazorpayError(err)
    }

    const startDateStr = subscription.start_at
      ? new Date(subscription.start_at * 1000).toISOString().split('T')[0]
      : null
    const nextChargeStr = subscription.charge_at
      ? new Date(subscription.charge_at * 1000).toISOString().split('T')[0]
      : startDateStr

    await pool.query(
      `INSERT INTO payment_transactions (
         order_id, gateway, razorpay_subscription_id, client_id, nuvama_code, client_name,
         amount, currency, payment_type, payment_status, investment_status,
         frequency, start_date, total_installments, next_charge_date,
         account_number, ifsc_code, strategy_type,
         payer_verification_status, created_at, updated_at
       ) VALUES ($1,'razorpay',$2,$3,$4,$5,$6,'INR','SIP',$7,'PENDING_PAYMENT',
                 $8,$9,$10,$11,$12,$13,$14,'PENDING',NOW(),NOW())`,
      [
        receipt,
        subscription.id,
        clientId,
        nuvama_code,
        client.client_name ?? '',
        toRupees(amountPaise),
        subscription.status ?? 'created',
        frequency,
        startDateStr,
        totalCount,
        nextChargeStr,
        client.account_number ?? null,
        client.ifsc_code ?? null,
        strategy_type ?? null,
      ],
    )

    const { keyId } = getRazorpayConfig()
    const rawPhone = String(client.phone_number ?? '').replace(/\D/g, '')
    const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone

    console.log(
      `[razorpay/subscriptions/create] subscription=${subscription.id} receipt=${receipt} ` +
      `nuvama=${nuvama_code} amount_paise=${amountPaise} freq=${frequency}`,
    )

    return NextResponse.json({
      success: true,
      key_id:                   keyId,
      razorpay_subscription_id: subscription.id,
      order_id:                 receipt,
      subscription_status:      subscription.status,
      amount:                   amountPaise,
      currency:                 'INR',
      frequency,
      start_date:               startDateStr,
      next_charge_date:         nextChargeStr,
      total_installments:       totalCount,
      short_url:                subscription.short_url ?? null,
      prefill: {
        name:  client.client_name ?? '',
        email: client.email ?? '',
        ...(phone.length === 10 && { contact: phone }),
      },
      // Surfaced so the UI can set expectations before the user authorises.
      registered_account_last4: client.account_number
        ? String(client.account_number).replace(/\D/g, '').slice(-4)
        : null,
    })
  } catch (error: any) {
    if (error instanceof RazorpayError) {
      console.error(`[razorpay/subscriptions/create] ${error.code}: ${error.message}`)
      return NextResponse.json(
        { success: false, error: error.message, error_code: error.code },
        { status: error.statusCode },
      )
    }
    console.error('[razorpay/subscriptions/create] unhandled:', error)
    return NextResponse.json(
      { success: false, error: 'Could not start the SIP setup. Please try again.', error_code: 'SUBSCRIPTION_CREATION_FAILED' },
      { status: 500 },
    )
  }
}
