// Payer-account verification — the compensating control for disabled TPV.
//
// WHY THIS EXISTS
// Cashfree's SIP flow passed the client's registered bank account to the gateway,
// which then refused any mandate authorised from a different account (TPV —
// Third Party Validation). TPV is not enabled on this Razorpay merchant account,
// so Razorpay will happily authorise a mandate from ANY account the customer
// controls. SEBI expects PMS funds to originate from the client's registered
// account, so we check after the fact and refuse to activate on a mismatch.
//
// This is a DETECTIVE control, not a preventive one. It cannot stop the
// authorisation from happening; it can only stop us from acting on a bad one.
// That is precisely why it must fail closed — see decide() below.
import crypto from 'crypto'

export type PayerVerificationStatus =
  | 'MATCHED'       // payer account provably equals the registered account
  | 'MISMATCH'      // payer account provably differs — must not activate
  | 'UNVERIFIABLE'  // gateway gave us nothing to compare — needs a human
  | 'PENDING'       // not yet checked

export interface RegisteredAccount {
  accountNumber: string | null
  ifsc:          string | null
  holderName:    string | null
}

/** What Razorpay reported about the account that authorised the mandate. */
export interface PayerAccount {
  accountNumber: string | null
  ifsc:          string | null
  holderName:    string | null
  /** e.g. 'emandate' | 'upi' | 'card' | 'nach' */
  method:        string | null
}

export interface PayerVerificationResult {
  status:     PayerVerificationStatus
  /** Human-readable explanation, stored for the ops audit trail. */
  note:       string
  /** Masked last 4 of whatever the payer account was, for display. */
  payerLast4: string | null
  /** True only when it is safe to activate the SIP without human review. */
  canActivate: boolean
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Normalises a bank account number for comparison.
 *
 * Banks and gateways disagree about leading zeros and separators for the same
 * account — "0001234567", "1234567" and "0001-234-567" are one account. Strip
 * everything non-numeric and drop leading zeros so the comparison is on the
 * significant digits only.
 */
export function normaliseAccountNumber(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = String(value).replace(/\D/g, '').replace(/^0+/, '')
  return digits.length ? digits : null
}

/** Normalises an IFSC code: uppercase, no whitespace. */
export function normaliseIfsc(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = String(value).toUpperCase().replace(/\s/g, '')
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleaned) ? cleaned : null
}

/** Last 4 significant digits, for display and for the audit trail. */
export function last4(value: string | null | undefined): string | null {
  const n = normaliseAccountNumber(value)
  return n && n.length >= 4 ? n.slice(-4) : n
}

/**
 * Constant-time comparison of two account numbers.
 *
 * Account numbers are not secrets in the way a key is, but a timing-variable
 * comparison here would let an attacker probe for a registered account number
 * one digit at a time by watching response latency.
 */
function accountsEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// ── Decision ──────────────────────────────────────────────────────────────────

/**
 * Decides whether a mandate may be activated.
 *
 * FAIL-CLOSED BY DESIGN. There are three outcomes and only one of them permits
 * automatic activation:
 *
 *   MATCHED      → activate. Account numbers match exactly.
 *   MISMATCH     → never activate. Verified third-party account.
 *   UNVERIFIABLE → hold for ops. The gateway told us nothing usable.
 *
 * UNVERIFIABLE is the common case for UPI Autopay, which returns a VPA
 * (user@bank) rather than an account number. A VPA cannot be mapped back to an
 * account number, so there is genuinely nothing to compare. Treating that as
 * "probably fine" would quietly reduce this control to a no-op for the single
 * most popular mandate method in India — which is exactly the failure mode this
 * function exists to prevent.
 */
export function decide(
  registered: RegisteredAccount,
  payer: PayerAccount,
): PayerVerificationResult {
  const regAcc   = normaliseAccountNumber(registered.accountNumber)
  const payerAcc = normaliseAccountNumber(payer.accountNumber)
  const payerL4  = last4(payer.accountNumber)

  // We have no registered account on file — cannot verify anything.
  if (!regAcc) {
    return {
      status: 'UNVERIFIABLE',
      note: 'No registered bank account on file for this client; payer account could not be validated.',
      payerLast4: payerL4,
      canActivate: false,
    }
  }

  // The gateway did not give us an account number to compare against.
  if (!payerAcc) {
    const method = payer.method ?? 'unknown'
    const reason =
      method === 'upi'
        ? `UPI Autopay mandate returned a VPA (${payer.holderName ?? 'unknown'}) instead of a bank account number, so the payer account cannot be matched against the registered account.`
        : `Gateway returned no bank account number for a '${method}' mandate, so the payer account cannot be matched.`

    return {
      status: 'UNVERIFIABLE',
      note: `${reason} Manual verification required before activation.`,
      payerLast4: payerL4,
      canActivate: false,
    }
  }

  if (!accountsEqual(regAcc, payerAcc)) {
    return {
      status: 'MISMATCH',
      note:
        `Mandate was authorised from an account ending ${payerL4 ?? '????'} but the registered ` +
        `account ends ${last4(registered.accountNumber) ?? '????'}. Third-party funding is not permitted.`,
      payerLast4: payerL4,
      canActivate: false,
    }
  }

  // Account matched. IFSC is a secondary signal: a mismatch here usually means a
  // bank merger or a branch change rather than fraud, so it is recorded but does
  // not block, since the account number is the stronger identifier.
  const regIfsc   = normaliseIfsc(registered.ifsc)
  const payerIfsc = normaliseIfsc(payer.ifsc)
  const ifscNote =
    regIfsc && payerIfsc && regIfsc !== payerIfsc
      ? ` (Note: IFSC differs — registered ${regIfsc}, payer ${payerIfsc}; likely a branch or bank-merger change.)`
      : ''

  return {
    status: 'MATCHED',
    note: `Payer account ending ${payerL4} matches the registered account.${ifscNote}`,
    payerLast4: payerL4,
    canActivate: true,
  }
}

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Pulls payer bank details out of a Razorpay payment/token entity.
 *
 * Razorpay puts these in different places depending on the mandate method, and
 * omits them entirely for UPI. Returning nulls here is expected and is what
 * drives the UNVERIFIABLE path — it is not an error condition.
 */
export function extractPayerAccount(payment: any, token?: any): PayerAccount {
  const bankDetails =
    token?.bank_details ??
    payment?.bank_details ??
    payment?.token?.bank_details ??
    null

  return {
    accountNumber:
      bankDetails?.account_number ??
      payment?.bank_account?.account_number ??
      null,
    ifsc:
      bankDetails?.ifsc ??
      payment?.bank_account?.ifsc ??
      null,
    holderName:
      bankDetails?.beneficiary_name ??
      payment?.bank_account?.name ??
      payment?.vpa ??
      null,
    method: payment?.method ?? token?.method ?? null,
  }
}
