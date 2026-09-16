// GST treatment for a distributor's invoice to Qode.
//
// Two things decide how the tax appears:
//
//   1. Whether the distributor is GST-registered at all. Below the threshold
//      they legitimately have no GSTIN, and their invoice carries no tax.
//   2. Whether their state matches Qode's. Same state is an intra-state supply
//      (CGST + SGST, half each); a different state is inter-state (IGST at the
//      full rate). Same total either way — but the split is not cosmetic, it
//      determines which ledger the credit lands in.
//
// The rate itself comes from lib/feeEngine.ts so the invoice and the fee
// calculation can never disagree about what 18% means.
import { GST_RATE } from '@/lib/feeEngine'

export type TaxTreatment = 'intra_state' | 'inter_state' | 'unregistered'

export interface TaxBreakdown {
  treatment: TaxTreatment
  /** Amount the tax is charged on. */
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  /** cgst + sgst + igst. */
  totalTax: number
  /** taxableValue + totalTax. */
  total: number
  /** Half the GST rate for intra-state, the full rate otherwise. */
  cgstRate: number
  sgstRate: number
  igstRate: number
}

/** Rounds to paise — an invoice must not carry floating-point dust. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Splits a taxable value into its GST components.
 *
 * @param taxableValue  The distributor's fee share, exclusive of GST.
 * @param supplierStateCode  The distributor's GST state code.
 * @param recipientStateCode  Qode's GST state code.
 * @param supplierHasGstin  False when the distributor is not GST-registered.
 */
export function computeTax(
  taxableValue: number,
  supplierStateCode: string | null | undefined,
  recipientStateCode: string | null | undefined,
  supplierHasGstin: boolean,
): TaxBreakdown {
  const base = round2(Math.max(0, taxableValue))

  // No GSTIN means no tax on the invoice. Charging GST without a registration
  // is not a rounding difference, it is an invalid invoice.
  if (!supplierHasGstin) {
    return {
      treatment: 'unregistered',
      taxableValue: base,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      total: base,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
    }
  }

  // Both codes must be known to claim the supply is intra-state. An unknown
  // state falls back to IGST: it is the treatment that does not wrongly split
  // tax across two state ledgers, and the total is identical either way.
  const sameState =
    Boolean(supplierStateCode) &&
    Boolean(recipientStateCode) &&
    String(supplierStateCode).padStart(2, '0') === String(recipientStateCode).padStart(2, '0')

  if (sameState) {
    const half = round2((base * (GST_RATE / 2)) / 100)
    return {
      treatment: 'intra_state',
      taxableValue: base,
      cgst: half,
      sgst: half,
      igst: 0,
      totalTax: round2(half * 2),
      total: round2(base + half * 2),
      cgstRate: GST_RATE / 2,
      sgstRate: GST_RATE / 2,
      igstRate: 0,
    }
  }

  const igst = round2((base * GST_RATE) / 100)
  return {
    treatment: 'inter_state',
    taxableValue: base,
    cgst: 0,
    sgst: 0,
    igst,
    totalTax: igst,
    total: round2(base + igst),
    cgstRate: 0,
    sgstRate: 0,
    igstRate: GST_RATE,
  }
}

/** GST state codes, for the state picker and for validating a GSTIN. */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
}

/**
 * Checks a GSTIN's shape and internal consistency.
 *
 * Validates the format, that the state code is real, and the check digit —
 * which catches transposed characters that a format check alone would pass.
 * It cannot confirm the number is actually allotted; only the GST portal can.
 */
export function validateGstin(gstin: string): { valid: boolean; reason?: string } {
  const value = gstin.trim().toUpperCase()
  if (!value) return { valid: false, reason: 'Enter your GSTIN' }
  if (value.length !== 15) {
    return { valid: false, reason: 'A GSTIN is 15 characters' }
  }
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(value)) {
    return { valid: false, reason: "That doesn't look like a valid GSTIN" }
  }
  if (!GST_STATE_CODES[value.slice(0, 2)]) {
    return { valid: false, reason: `${value.slice(0, 2)} is not a valid state code` }
  }

  // Check digit: weights alternate 1,2 across the first 14 characters, each
  // product folded (quotient + remainder) in base 36.
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const code = chars.indexOf(value[i])
    if (code < 0) return { valid: false, reason: "That doesn't look like a valid GSTIN" }
    const product = code * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  const expected = chars[(36 - (sum % 36)) % 36]
  if (expected !== value[14]) {
    return { valid: false, reason: 'That GSTIN fails its check digit — please re-check it' }
  }
  return { valid: true }
}

/** Checks a PAN's shape. PAN is optional, so an empty value is not an error. */
export function validatePan(pan: string): { valid: boolean; reason?: string } {
  const value = pan.trim().toUpperCase()
  if (!value) return { valid: true }
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value)) {
    return { valid: false, reason: "That doesn't look like a valid PAN" }
  }
  return { valid: true }
}

/**
 * The PAN embedded in a GSTIN, which is characters 3–12.
 *
 * Used to check the two agree — a mismatch means one of them was mistyped, and
 * catching it here is cheaper than having the invoice rejected.
 */
export function panFromGstin(gstin: string): string | null {
  const value = gstin.trim().toUpperCase()
  return value.length === 15 ? value.slice(2, 12) : null
}
