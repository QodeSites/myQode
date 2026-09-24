// POST /api/razorpay/create-order — one-time investment ("Add Funds").
//
// Security posture, and how it differs from the Cashfree route it replaces:
//
//  1. The caller's identity comes from the session cookie, NOT the request body.
//     The Cashfree route accepted `client_id` from the browser, so a logged-in
//     user could create an order against someone else's account by editing the
//     payload. Here the nuvama_code is checked against the session's own list.
//  2. Customer name/email/phone are read from the database, not the body. They
//     end up on the payment record and in Razorpay's dashboard; letting the
//     browser set them makes the audit trail forgeable.
//  3. The amount is validated server-side and stored in paise before checkout.
//     /verify later re-checks the captured amount against this stored value, so
//     tampering with the amount in the browser cannot under-pay an order.
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

interface CreateOrderBody {
  amount:          number | string
  nuvama_code:     string
  is_new_strategy?: boolean
  strategy_type?:   string
}

interface SessionClient { clientid: string; clientcode: string }

/**
 * Resolves the authenticated user's client list from the session cookie.
 * Returns null when unauthenticated.
 */
async function getSessionClients(): Promise<SessionClient[] | null> {
  const cookieStore = await cookies()
  if (cookieStore.get('qode-auth')?.value !== '1') return null

  const raw = cookieStore.get('qode-clients')?.value
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    console.error('[razorpay/create-order] malformed qode-clients cookie')
    return []
  }
}

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate ──────────────────────────────────────────────────────
    const sessionClients = await getSessionClients()
    if (sessionClients === null) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated', error_code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    let body: CreateOrderBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', error_code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const { amount, nuvama_code, is_new_strategy = false, strategy_type } = body

    if (!nuvama_code || typeof nuvama_code !== 'string') {
      return NextResponse.json(
        { success: false, error: 'nuvama_code is required', error_code: 'MISSING_NUVAMA_CODE' },
        { status: 400 },
      )
    }

    // ── 2. Authorise: does this session actually own this account? ───────────
    // Without this check any authenticated user could fund an arbitrary account.
    const ownsAccount = sessionClients.some(
      (c) => c.clientcode === nuvama_code || c.clientid === nuvama_code,
    )
    if (!ownsAccount) {
      console.warn(
        `[razorpay/create-order] account mismatch — session=${JSON.stringify(
          sessionClients.map((c) => c.clientcode),
        )} requested=${nuvama_code}`,
      )
      return NextResponse.json(
        { success: false, error: 'This account is not linked to your login.', error_code: 'ACCOUNT_NOT_OWNED' },
        { status: 403 },
      )
    }

    // ── 3. Validate amount (throws RazorpayError with a client-safe message) ─
    const amountPaise = validateInvestmentAmount(amount)

    // ── 4. Customer identity from the DB, never from the browser ────────────
    // Two sources, in order of richness:
    //   1. pms_clients_bank_details — has name/email/phone, but only covers the
    //      subset of accounts whose bank mandate details have been captured.
    //   2. pms_clients_master — the same table the login reads, so every account
    //      the session can hold is present here.
    //
    // Bank details must NOT be a precondition for a one-time payment: they are
    // used here only to prefill the checkout, and most accounts do not have a
    // row yet. (They ARE required for SIP, where the payer account has to be
    // verified against the registered one — see subscriptions/create.)
    const { rows: bankRows } = await db1.query(
      `SELECT nuvama_code, client_name, phone_number, email
         FROM pms_clients_tracker.pms_clients_bank_details
        WHERE nuvama_code = $1
        LIMIT 1`,
      [nuvama_code],
    )

    let client: { client_name?: string | null; email?: string | null; phone_number?: string | null } | null =
      bankRows[0] ?? null

    if (!client) {
      const { rows: masterRows } = await pool.query(
        `SELECT clientcode, clientname AS client_name, email, mobile AS phone_number
           FROM pms_clients_master
          WHERE clientcode = $1
          LIMIT 1`,
        [nuvama_code],
      )
      client = masterRows[0] ?? null
    }

    if (!client) {
      // Neither source knows this account. Since ownership already passed, this
      // means the session holds a code that no longer exists — worth logging.
      console.error(
        `[razorpay/create-order] account ${nuvama_code} passed ownership but is in ` +
        `neither pms_clients_bank_details nor pms_clients_master`,
      )
      return NextResponse.json(
        {
          success: false,
          error: 'We could not find this account. Please contact support.',
          error_code: 'CLIENT_PROFILE_NOT_FOUND',
        },
        { status: 404 },
      )
    }

    const clientId = sessionClients.find(
      (c) => c.clientcode === nuvama_code,
    )?.clientid ?? nuvama_code

    // Razorpay rejects malformed contact fields; normalise to a 10-digit number
    // and fall back to omitting rather than sending something invalid.
    const rawPhone = String(client.phone_number ?? '').replace(/\D/g, '')
    const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone
    const contactValid = phone.length === 10

    // ── 5. Create the Razorpay order ────────────────────────────────────────
    const receipt = generateReceiptId()
    const razorpay = getRazorpayClient()
    const { keyId } = getRazorpayConfig()

    // Notes are surfaced in the Razorpay dashboard and echoed back on webhooks —
    // this is what lets ops reconcile a payment to an account without a DB lookup.
    const notes: Record<string, string> = {
      nuvama_code,
      client_id: String(clientId),
      client_name: String(client.client_name ?? ''),
      source: 'qode_investor_portal_web',
      order_type: is_new_strategy ? 'new_strategy' : 'one_time',
      is_new_strategy: is_new_strategy ? 'true' : 'false',
    }
    if (strategy_type) notes.strategy_type = String(strategy_type)

    let order: any
    try {
      order = await razorpay.orders.create({
        amount:   amountPaise,      // integer paise — never a float
        currency: 'INR',
        receipt,
        // Capture automatically on authorisation. With manual capture an
        // authorised-but-uncaptured payment silently expires after ~5 days and
        // the client's money is held the whole time for nothing.
        payment_capture: true,
        notes,
      } as any)
    } catch (err) {
      throw normaliseRazorpayError(err)
    }

    // ── 6. Persist before returning ─────────────────────────────────────────
    // Written before the browser opens checkout so that a webhook arriving
    // during checkout always finds a row to update. The reverse order would
    // create a race where a fast payment lands before the INSERT.
    const paymentType = is_new_strategy ? 'NEW_STRATEGY' : 'ONE_TIME'

    await pool.query(
      `INSERT INTO payment_transactions (
         order_id, gateway, razorpay_order_id, client_id, nuvama_code, client_name,
         amount, currency, payment_type, payment_status, investment_status,
         is_new_strategy, strategy_type, created_at, updated_at
       ) VALUES ($1,'razorpay',$2,$3,$4,$5,$6,'INR',$7,$8,'PENDING_PAYMENT',$9,$10,NOW(),NOW())`,
      [
        receipt,            // our own stable reference, unique across gateways
        order.id,           // razorpay_order_id
        clientId,
        nuvama_code,
        client.client_name ?? '',
        toRupees(amountPaise),
        paymentType,
        order.status ?? 'created',
        is_new_strategy,
        strategy_type ?? null,
      ],
    )

    console.log(
      `[razorpay/create-order] created order=${order.id} receipt=${receipt} ` +
      `nuvama=${nuvama_code} amount_paise=${amountPaise}`,
    )

    // key_id is returned here rather than exposed as NEXT_PUBLIC_* so that test
    // and production keys can never drift out of sync with the server.
    return NextResponse.json({
      success: true,
      key_id:            keyId,
      razorpay_order_id: order.id,
      order_id:          receipt,
      amount:            amountPaise,
      currency:          'INR',
      payment_type:      paymentType,
      is_new_strategy:   is_new_strategy,
      strategy_type:     strategy_type ?? null,
      prefill: {
        name:    client.client_name ?? '',
        email:   client.email ?? '',
        ...(contactValid && { contact: phone }),
      },
    })
  } catch (error: any) {
    // Domain errors carry a client-safe message; anything else is masked.
    if (error instanceof RazorpayError) {
      console.error(`[razorpay/create-order] ${error.code}: ${error.message}`)
      return NextResponse.json(
        { success: false, error: error.message, error_code: error.code },
        { status: error.statusCode },
      )
    }

    console.error('[razorpay/create-order] unhandled:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Could not start the payment. Please try again.',
        error_code: 'ORDER_CREATION_FAILED',
      },
      { status: 500 },
    )
  }
}
