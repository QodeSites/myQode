// Validation for client-submitted bank details.
//
// This is the data the SIP payer check compares against. TPV is disabled on the
// Razorpay account, so that check is the only control stopping a client funding
// a portfolio from an account that is not theirs — which makes a typo here a
// real failure, not a cosmetic one. A wrong account number means the mandate is
// authorised and then permanently rejected at verification, after the client
// has already been through bank authentication.
//
// So the rules below are deliberately strict: reject at entry, where the client
// can still fix it, rather than at mandate time where they cannot.

/** IFSC: 4 letters, then '0', then 6 alphanumerics. Fixed by RBI. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/

/**
 * Indian bank account numbers vary by bank (9–18 digits) and have no checksum,
 * so length and digits are all that can be checked offline. The confirm-entry
 * field in the UI catches transposition, which a regex cannot.
 */
const ACCOUNT_RE = /^\d{9,18}$/

export interface BankDetailsInput {
  accountNumber: string
  confirmAccountNumber: string
  ifsc: string
  accountHolderName: string
}

export interface ValidationResult {
  valid: boolean
  errors: Record<string, string>
  /** Present only when valid — normalised, ready to store. */
  normalised?: {
    accountNumber: string
    ifsc: string
    accountHolderName: string
  }
}

/** Strips spaces and hyphens, which clients copy from passbooks and statements. */
function cleanAccountNumber(value: string): string {
  return String(value ?? '').replace(/[\s-]/g, '')
}

export function validateBankDetails(input: BankDetailsInput): ValidationResult {
  const errors: Record<string, string> = {}

  const account = cleanAccountNumber(input.accountNumber)
  const confirm = cleanAccountNumber(input.confirmAccountNumber)
  const ifsc = String(input.ifsc ?? '').trim().toUpperCase()
  const name = String(input.accountHolderName ?? '').trim()

  if (!account) {
    errors.accountNumber = 'Enter your bank account number'
  } else if (!ACCOUNT_RE.test(account)) {
    errors.accountNumber = 'An account number is 9 to 18 digits, with no letters'
  }

  // Checked separately from the format so the client is told which field is
  // wrong, rather than a single "details do not match".
  if (!confirm) {
    errors.confirmAccountNumber = 'Re-enter your account number'
  } else if (account && confirm !== account) {
    errors.confirmAccountNumber = 'The two account numbers do not match'
  }

  if (!ifsc) {
    errors.ifsc = 'Enter your branch IFSC code'
  } else if (!IFSC_RE.test(ifsc)) {
    errors.ifsc = 'An IFSC is 11 characters, e.g. HDFC0000060'
  }

  if (!name) {
    errors.accountHolderName = 'Enter the name on the account'
  } else if (name.length < 3) {
    errors.accountHolderName = 'Enter the full name as it appears on the account'
  }

  if (Object.keys(errors).length) return { valid: false, errors }

  return {
    valid: true,
    errors: {},
    normalised: { accountNumber: account, ifsc, accountHolderName: name },
  }
}

/**
 * Masks an account number for display, logs and the audit trail.
 *
 * The audit trail records that a change happened; it is not a second copy of
 * the account number, so only the last four digits are kept.
 */
export function maskAccountNumber(value: string | null | undefined): string {
  const v = cleanAccountNumber(String(value ?? ''))
  if (!v) return ''
  if (v.length <= 4) return '*'.repeat(v.length)
  return '*'.repeat(v.length - 4) + v.slice(-4)
}

/** The bank code embedded in an IFSC — useful for display and support. */
export function bankFromIfsc(ifsc: string): string | null {
  const v = String(ifsc ?? '').trim().toUpperCase()
  return IFSC_RE.test(v) ? v.slice(0, 4) : null
}
