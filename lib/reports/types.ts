/**
 * Shared types for client statement generation.
 *
 * Reports are assembled from two sources: the Nuvama GAM APIs (current
 * snapshot, all clients) and the local Postgres history tables (deep history,
 * limited client coverage). Every report declares its own `coverage` so the
 * rendered statement is explicit about which source answered and what is
 * missing — a report with no data must say so rather than render as zero.
 */

export type ReportKind =
  | "holding"
  | "factsheet"
  | "transactions"
  | "capital-gains"
  | "expenses"
  | "dividends"

export const REPORT_LABELS: Record<ReportKind, string> = {
  holding: "Holding Statement",
  factsheet: "Portfolio Factsheet",
  transactions: "Transactions Statement",
  "capital-gains": "Statement of Capital Gains — Realised",
  expenses: "Statement of Expenses — Fees",
  dividends: "Statement of Dividends",
}

/** Where a report's numbers came from, surfaced in the statement footer. */
export type DataSource = "nuvama-api" | "database" | "none"

export type Coverage = {
  source: DataSource
  /** Human-readable note rendered when data is partial or absent. */
  note?: string
  /** True when the period genuinely has no activity (vs. no data source). */
  emptyPeriod?: boolean
  /** Set when the underlying feed cannot support this report at all. */
  unavailable?: boolean
}

export type ClientIdentity = {
  /** Nuvama numeric id, e.g. "14410003". */
  clientId: string
  /** Shared join key across API and DB, e.g. "QAW0007". */
  clientCode: string
  name: string
  schemeName: string
  pan?: string | null
  email?: string | null
  inceptionDate?: string | null
}

export type Period = {
  from: string
  to: string
}

export type HoldingRow = {
  symbol: string
  name: string
  isin: string | null
  sector: string | null
  assetClass: string | null
  quantity: number
  unitCost: number
  totalCost: number
  unitPrice: number
  marketValue: number
  gainLoss: number
  gainLossPercent: number
  weightPercent: number
}

export type HoldingReport = {
  kind: "holding"
  client: ClientIdentity
  period: Period
  coverage: Coverage
  rows: HoldingRow[]
  totals: {
    totalCost: number
    marketValue: number
    gainLoss: number
    gainLossPercent: number
    portfolioValue: number
  }
}

export type FactsheetReport = {
  kind: "factsheet"
  client: ClientIdentity
  period: Period
  coverage: Coverage
  returns: {
    irr: number | null
    modifiedDietz: number | null
    simple: number | null
    /** Period P&L in currency. */
    realisedGain: number | null
    unrealisedGain: number | null
  }
  valuation: {
    beginMarketValue: number | null
    endMarketValue: number | null
    nav: number | null
    capitalIn: number | null
    capitalOut: number | null
  }
  /** Current allocation, largest first. */
  allocation: { label: string; value: number; weightPercent: number }[]
  sectorAllocation: { label: string; value: number; weightPercent: number }[]
  /** NAV history when the client has rows in the local history tables. */
  navHistory: { date: string; nav: number }[]
}

export type TransactionRow = {
  date: string
  type: string
  typeDetail: string
  symbol: string
  symbolName: string
  isin: string | null
  quantity: number
  rate: number
  amount: number
  charges: number
}

export type TransactionsReport = {
  kind: "transactions"
  client: ClientIdentity
  period: Period
  coverage: Coverage
  rows: TransactionRow[]
  totals: { purchases: number; sales: number; charges: number; net: number }
}

export type CapitalGainRow = {
  symbol: string
  isin: string | null
  quantity: number
  acquiredOn: string | null
  soldOn: string | null
  cost: number
  proceeds: number
  gain: number
  /** Short/long term classification when holding period is known. */
  term: "short" | "long" | "unknown"
}

export type CapitalGainsReport = {
  kind: "capital-gains"
  client: ClientIdentity
  period: Period
  coverage: Coverage
  /** Itemised lots when transaction history supports it; empty otherwise. */
  rows: CapitalGainRow[]
  /** Always available from daily performance, even when rows are empty. */
  summary: {
    realisedGain: number | null
    unrealisedGain: number | null
    shortTermGain: number | null
    longTermGain: number | null
    /** Proceeds from disposals with no matched acquisition; term unknown. */
    unmatchedGain: number | null
    shortTermTax: number | null
    longTermTax: number | null
  }
}

export type ExpenseRow = {
  date: string
  description: string
  amount: number
}

export type ExpensesReport = {
  kind: "expenses"
  client: ClientIdentity
  period: Period
  coverage: Coverage
  rows: ExpenseRow[]
  totals: {
    managementFees: number | null
    otherFees: number | null
    expenses: number | null
    total: number | null
  }
}

export type DividendRow = {
  date: string
  symbol: string
  symbolName: string
  quantity: number | null
  amountPerUnit: number | null
  amount: number
}

export type DividendsReport = {
  kind: "dividends"
  client: ClientIdentity
  period: Period
  coverage: Coverage
  rows: DividendRow[]
  totals: { dividend: number | null; interest: number | null; total: number | null }
}

export type AnyReport =
  | HoldingReport
  | FactsheetReport
  | TransactionsReport
  | CapitalGainsReport
  | ExpensesReport
  | DividendsReport

/** Strategy accent colours, keyed by the CLIENTCODE prefix. */
export const STRATEGY_COLORS: Record<string, string> = {
  QAW: "#008455",
  QGF: "#0A3452",
  QTF: "#550E0E",
}

export function strategyColor(clientCode: string): string {
  return STRATEGY_COLORS[clientCode.slice(0, 3).toUpperCase()] ?? "#02422B"
}

export function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0
  const n = typeof value === "number" ? value : Number(String(value))
  return Number.isFinite(n) ? n : 0
}

/** Returns null rather than 0 so "no data" stays distinguishable from zero. */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(String(value))
  return Number.isFinite(n) ? n : null
}
