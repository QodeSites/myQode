// Distributor fee engine — rack-rate-first calculation.
//
// Implements Part 4 of the Distributor Portal Fee Calculation Revamp plan
// (July 2026). Pure functions, no I/O: callers supply the inputs, so the
// arithmetic can be tested against the plan's worked examples directly.
//
// ── THE RULE THIS ENFORCES ───────────────────────────────────────────────────
// The split applies to the fee ACTUALLY BILLED to the client. Both sides take
// their agreed percentage of that one figure:
//
//     Distributor share = Billed Fee × Split %
//     Qode share        = Billed Fee × (100 − Split %)
//
// So on a 2.5% agreement discounted to 1.6% at 50/50, each side takes half of
// the 1.6% actually charged. Nothing is grossed up to the rack rate, and
// `discountAmount` is always zero — the reduction is already inside the billed
// figure, and deducting it again would double-count it.
//
// ── WHY THIS CHANGED ─────────────────────────────────────────────────────────
// Part 4 of the July 2026 plan specified the opposite: split the RACK rate, so
// a distributor's discount came entirely out of their own share and Qode's
// revenue never moved. That was implemented and verified, then reversed on
// 03 Aug 2026 at the user's direction, for legibility — the rack-rate figure is
// derived rather than billed, so a distributor could not check their share
// against any number in front of them.
//
// The cost is real and was measured before the change: Qode now funds its share
// of every discount, ₹10,752/quarter (₹43,007/year) across the six discounted
// accounts billed in Q1 FY2026-27. `Rack_Rate_Fixed_Fee` is still read from the
// CRM and still reported, but no longer drives the split.

/** GST rate applied to fees. */
export const GST_RATE = 18

/** The three fee structures an investor picks at onboarding. */
export type FeeOption = 'hybrid' | 'pure_performance' | 'pure_fixed' | 'zero' | 'unknown'

export interface FeeEngineInput {
  /** Daily average AUM for the period, in rupees. */
  averageAum: number

  /** Contractual rack rate fixed fee %, per the signed agreement. */
  rackFixedFeePct: number | null
  /** Contractual rack rate performance fee %. */
  rackPerfFeePct: number | null

  /**
   * Discounted performance fee %, where the distributor reduced it.
   *
   * `actualFeeChargedPct` covers only the fixed leg, so a performance-fee
   * discount cannot be expressed through it. Null means the performance fee
   * was not discounted — which is the case for every account currently on
   * file, since the one hybrid discount reduced the fixed leg alone.
   */
  discountedPerfFeePct?: number | null

  /**
   * Fee % actually charged to the investor. Equals the rack rate unless the
   * distributor discounted. Null when Zoho has no value — treated as "no
   * discount" rather than "charged nothing", since a null must never silently
   * become a 100% discount absorbed by the distributor.
   */
  actualFeeChargedPct: number | null
  /** Zoho's explicit discount flag, used as a cross-check on the above. */
  discountApplied: boolean

  /**
   * Fixed fee actually billed in this period, from the portfolio system.
   * Preferred over recomputing from AUM: it reflects mid-period entry and exit,
   * which a flat AUM × rate calculation cannot.
   */
  billedFixedFee?: number | null
  /** Performance fee actually billed in this period. */
  billedPerfFee?: number | null

  /** Distributor's agreed share of the rack rate fee, as a percentage. */
  distributorSharePct: number | null

  /** Fraction of a year this period covers. A quarter is 0.25. */
  periodFraction?: number
}

export interface FeeEngineResult {
  // ── Rack rate (the contractual basis) ──────────────────────────────────
  rackFixedFee: number
  rackPerfFee: number
  totalRackFee: number

  // ── What the investor was actually billed ──────────────────────────────
  actualFixedFee: number
  actualPerfFee: number
  totalActualFee: number

  /**
   * Always 0. The split is taken on the billed fee, which is already net of
   * any discount, so nothing further is deducted. Retained for a stable shape.
   */
  discountAmount: number
  /**
   * The CRM records this client as discounted — i.e. paying below the standard
   * rate. Does not imply any deduction from the distributor's share.
   */
  hasDiscount: boolean

  // ── The split, on the fee actually billed ──────────────────────────────
  distributorSharePct: number
  qodeSharePct: number

  /** Distributor's share of the billed fee. */
  distributorGrossShare: number
  /** Identical to `distributorGrossShare` — there is no further deduction. */
  netDistributorPayout: number

  /** Qode's share — internal only, never shown under a distributor login. */
  qodeShare: number

  // ── GST ────────────────────────────────────────────────────────────────
  /** GST on the total rack rate fee. */
  gstOnRackFee: number
  /** Rack fee plus GST. */
  totalWithGst: number
  /** Proportionate GST on the distributor's net payout. */
  gstOnDistributorPayout: number
  /** What the distributor invoices in total, including their GST. */
  netInvoiceAmount: number

  /** Derived from the rack rates — drives per-option display. */
  feeOption: FeeOption

  /**
   * Anything that needs a human before invoicing. Empty means the row is safe
   * to bill from.
   */
  warnings: string[]
}

/** Rounds to paise. Money must not carry floating-point dust into an invoice. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const clampPct = (n: number) => Math.min(100, Math.max(0, n))

/**
 * Classifies an account by its rack rates.
 *
 * Derived rather than read from a Fee_Option field, because that field does
 * not exist in Zoho — `Fees_Structure` is a free-text multiselect, so the
 * rates themselves are the more reliable signal.
 */
export function deriveFeeOption(rackFixedPct: number, rackPerfPct: number): FeeOption {
  if (rackFixedPct > 0 && rackPerfPct > 0) return 'hybrid'
  if (rackFixedPct === 0 && rackPerfPct > 0) return 'pure_performance'
  if (rackFixedPct > 0 && rackPerfPct === 0) return 'pure_fixed'
  if (rackFixedPct === 0 && rackPerfPct === 0) return 'zero'
  return 'unknown'
}

/**
 * Calculates one account's fees for a period.
 *
 * Follows Part 4 steps 1–5 in order, so the code reads in the same sequence as
 * the specification it implements.
 */
export function calculateFees(input: FeeEngineInput): FeeEngineResult {
  const warnings: string[] = []

  const rackFixedPct = input.rackFixedFeePct ?? 0
  const rackPerfPct = input.rackPerfFeePct ?? 0
  const periodFraction = input.periodFraction ?? 0.25   // quarterly by default

  if (input.rackFixedFeePct === null && input.rackPerfFeePct === null) {
    warnings.push('No rack rate on file in the CRM — fees cannot be verified.')
  }

  // ── Step 2: rack rate fees ────────────────────────────────────────────
  //
  // Where the portfolio system has billed a figure, that is authoritative: it
  // accounts for mid-period entry, exit and cashflows. AUM × rate is only a
  // fallback for accounts with no billing record yet.
  const billedFixed = input.billedFixedFee ?? null
  const billedPerf = input.billedPerfFee ?? null

  // Whether the CRM records a discount. No longer affects the arithmetic — the
  // split follows the billed fee either way — but it still tells the UI that
  // the client is paying below the standard rate, which is worth showing.
  const actualChargedPct = input.actualFeeChargedPct ?? rackFixedPct
  const isDiscounted =
    input.discountApplied || (input.actualFeeChargedPct !== null && actualChargedPct < rackFixedPct)

  let rackFixedFee: number
  let actualFixedFee: number

  if (billedFixed !== null && billedFixed > 0) {
    // ── The split basis ──────────────────────────────────────────────────
    // The fee actually billed IS the basis for the split. No gross-up to a
    // notional rack-rate figure: the number the distributor is shown is the
    // number their percentage applies to, so the arithmetic is checkable on
    // the row without a derived intermediate.
    //
    // This is a deliberate reversal of the plan's Part 4 rack-rate rule,
    // chosen on 03 Aug 2026 for legibility. The consequence is that Qode
    // funds its share of every discount rather than the distributor bearing
    // it alone — measured at ₹10,752/quarter (₹43,007/year) across the six
    // discounted accounts billed in Q1 FY2026-27. `discountAmount` therefore
    // reports zero: nothing is deducted from the distributor's share.
    actualFixedFee = billedFixed
    rackFixedFee = billedFixed
  } else {
    // No billing record yet: fall back to the rate actually charged, for the
    // same reason — the split follows what the client pays.
    rackFixedFee = input.averageAum * (actualChargedPct / 100) * periodFraction
    actualFixedFee = rackFixedFee
  }

  // Performance fees are billed annually against gains over the hurdle, with a
  // high-watermark check the portfolio system performs. There is no reliable
  // way to recompute that here, so the billed figure is authoritative.
  //
  // A performance-fee discount needs no separate handling: like the fixed leg,
  // the billed figure already reflects whatever rate was charged, and that is
  // what gets split.
  const actualPerfFee = billedPerf ?? 0
  const rackPerfFee = actualPerfFee

  const totalRackFee = rackFixedFee + rackPerfFee
  const totalActualFee = actualFixedFee + actualPerfFee

  // ── The discount ──────────────────────────────────────────────────────
  // Always zero. The split is taken on the billed fee, which is already net of
  // any discount, so there is nothing further to deduct — subtracting it again
  // would charge the distributor for it twice.
  //
  // The field is retained rather than removed so callers and the UI keep a
  // stable shape; the discount is still visible as the gap between
  // `Rack_Rate_Fixed_Fee` and `Actual_Fee_Charged` in the CRM.
  const discountAmount = 0

  // ── The split, on the fee actually billed ─────────────────────────────
  const distributorSharePct = clampPct(input.distributorSharePct ?? 0)
  const qodeSharePct = 100 - distributorSharePct

  if (input.distributorSharePct === null) {
    warnings.push('No revenue share on file in the CRM — showing zero.')
  }

  const distributorGrossShare = totalRackFee * (distributorSharePct / 100)
  const qodeShare = totalRackFee * (qodeSharePct / 100)

  // Gross and net are the same figure: with the split taken on the billed fee,
  // there is no further deduction. Both are returned so callers that report a
  // "before" and "after" keep working, and so this reads as deliberate rather
  // than as a missing subtraction.
  const netDistributorPayout = distributorGrossShare

  // ── GST ───────────────────────────────────────────────────────────────
  //
  // On the fee the split was taken from, which is the fee actually billed.
  const gstOnRackFee = totalRackFee * (GST_RATE / 100)
  const totalWithGst = totalRackFee + gstOnRackFee
  const gstOnDistributorPayout = netDistributorPayout * (GST_RATE / 100)
  const netInvoiceAmount = netDistributorPayout + gstOnDistributorPayout

  return {
    rackFixedFee: round2(rackFixedFee),
    rackPerfFee: round2(rackPerfFee),
    totalRackFee: round2(totalRackFee),

    actualFixedFee: round2(actualFixedFee),
    actualPerfFee: round2(actualPerfFee),
    totalActualFee: round2(totalActualFee),

    discountAmount: round2(discountAmount),
    // The CRM records a discount for this client. Says nothing about a
    // deduction from the share — there isn't one — only that the client pays
    // below the standard rate.
    hasDiscount: isDiscounted,

    distributorSharePct,
    qodeSharePct,
    distributorGrossShare: round2(distributorGrossShare),
    netDistributorPayout: round2(netDistributorPayout),
    qodeShare: round2(qodeShare),

    gstOnRackFee: round2(gstOnRackFee),
    totalWithGst: round2(totalWithGst),
    gstOnDistributorPayout: round2(gstOnDistributorPayout),
    netInvoiceAmount: round2(netInvoiceAmount),

    feeOption: deriveFeeOption(rackFixedPct, rackPerfPct),
    warnings,
  }
}
