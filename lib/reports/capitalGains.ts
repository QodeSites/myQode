import type { CapitalGainRow } from "./types"

/**
 * FIFO lot matching for realised capital gains.
 *
 * Indian tax treatment for listed equity: holdings sold more than 12 months
 * after acquisition are long-term, otherwise short-term. Lots are consumed
 * oldest-first, which is both the statutory default and how the custodian
 * reports it.
 *
 * Cost and proceeds are taken from `net_amount` where available, since that is
 * the settled figure inclusive of brokerage — falling back to qty × rate when
 * the ledger has no net amount.
 */

export type LedgerRow = {
  trandate: string
  tranType: string
  isin: string | null
  securityName: string
  qty: number
  rate: number
  netAmount: number
  stt: number
  brokerage: number
}

type OpenLot = {
  date: string
  qty: number
  /** Cost for the remaining quantity in this lot. */
  costPerUnit: number
}

const LONG_TERM_DAYS = 365

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.floor(ms / 86_400_000)
}

/** Buys open a lot; sells close one. Options legs are handled the same way. */
const BUY_TYPES = new Set(["BY-", "OBY", "OPI", "SII", "PSI"])
const SELL_TYPES = new Set(["SL+", "CSL", "OPO", "SOO", "PSO"])

export function isBuy(tranType: string): boolean {
  return BUY_TYPES.has(tranType)
}

export function isSell(tranType: string): boolean {
  return SELL_TYPES.has(tranType)
}

function unitCost(row: LedgerRow): number {
  if (row.qty === 0) return 0
  const gross = row.netAmount !== 0 ? Math.abs(row.netAmount) : Math.abs(row.qty * row.rate)
  return gross / Math.abs(row.qty)
}

/**
 * Matches sells against prior buys per security and returns one row per
 * realised parcel. Rows are grouped by ISIN when present, falling back to the
 * security name so instruments without an ISIN still match against themselves.
 */
export function computeRealisedGains(
  ledger: LedgerRow[],
  period: { from: string; to: string },
): { rows: CapitalGainRow[]; unmatchedSells: number } {
  const bySecurity = new Map<string, LedgerRow[]>()
  for (const row of ledger) {
    if (!isBuy(row.tranType) && !isSell(row.tranType)) continue
    const key = row.isin || row.securityName
    const list = bySecurity.get(key)
    if (list) list.push(row)
    else bySecurity.set(key, [row])
  }

  const rows: CapitalGainRow[] = []
  let unmatchedSells = 0

  for (const [, entries] of bySecurity) {
    // Chronological order is what makes FIFO correct; ties keep buys first so a
    // same-day buy can cover a same-day sell.
    entries.sort((a, b) => {
      const d = a.trandate.localeCompare(b.trandate)
      if (d !== 0) return d
      return isBuy(a.tranType) === isBuy(b.tranType) ? 0 : isBuy(a.tranType) ? -1 : 1
    })

    const open: OpenLot[] = []

    for (const entry of entries) {
      const qty = Math.abs(entry.qty)
      if (qty === 0) continue

      if (isBuy(entry.tranType)) {
        open.push({ date: entry.trandate, qty, costPerUnit: unitCost(entry) })
        continue
      }

      // Sell: consume open lots oldest-first.
      let remaining = qty
      const proceedsPerUnit = unitCost(entry)
      const chargesPerUnit = qty === 0 ? 0 : (Math.abs(entry.stt) + Math.abs(entry.brokerage)) / qty

      while (remaining > 0 && open.length > 0) {
        const lot = open[0]
        const take = Math.min(remaining, lot.qty)

        const cost = take * lot.costPerUnit
        const proceeds = take * proceedsPerUnit - take * chargesPerUnit
        const held = daysBetween(lot.date, entry.trandate)

        // Only report parcels realised inside the requested window; earlier
        // sells still consume lots so later matching stays correct.
        if (entry.trandate >= period.from && entry.trandate <= period.to) {
          rows.push({
            symbol: entry.securityName,
            isin: entry.isin,
            quantity: take,
            acquiredOn: lot.date,
            soldOn: entry.trandate,
            cost,
            proceeds,
            gain: proceeds - cost,
            term: held > LONG_TERM_DAYS ? "long" : "short",
          })
        }

        lot.qty -= take
        remaining -= take
        if (lot.qty <= 1e-9) open.shift()
      }

      if (remaining > 1e-9 && entry.trandate >= period.from && entry.trandate <= period.to) {
        // Sold without a matching buy in the window — usually an opening
        // position transferred in before the ledger starts. Report it with an
        // unknown acquisition rather than silently dropping the proceeds.
        unmatchedSells += 1
        const proceeds = remaining * proceedsPerUnit
        rows.push({
          symbol: entry.securityName,
          isin: entry.isin,
          quantity: remaining,
          acquiredOn: null,
          soldOn: entry.trandate,
          cost: 0,
          proceeds,
          gain: proceeds,
          term: "unknown",
        })
      }
    }
  }

  rows.sort((a, b) => (a.soldOn ?? "").localeCompare(b.soldOn ?? ""))
  return { rows, unmatchedSells }
}

/**
 * Parcels with no matched acquisition are kept out of the short/long split —
 * their holding period is unknown, so classifying them either way would
 * misstate a tax-adjacent figure. They are reported on their own line and
 * still counted in the realised total.
 */
export function summariseGains(rows: CapitalGainRow[]) {
  let shortTermGain = 0
  let longTermGain = 0
  let unmatchedGain = 0
  for (const row of rows) {
    if (row.term === "long") longTermGain += row.gain
    else if (row.term === "short") shortTermGain += row.gain
    else unmatchedGain += row.gain
  }
  return {
    shortTermGain,
    longTermGain,
    unmatchedGain,
    realisedGain: shortTermGain + longTermGain + unmatchedGain,
  }
}
