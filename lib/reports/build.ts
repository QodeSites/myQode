import { query as queryTracker } from "@/lib/db1"
import { query as queryPortal } from "@/lib/db"
import { computeRealisedGains, summariseGains, type LedgerRow } from "./capitalGains"
import {
  type CapitalGainsReport,
  type ClientIdentity,
  type DividendsReport,
  type ExpensesReport,
  type FactsheetReport,
  type HoldingReport,
  type HoldingRow,
  type Period,
  type TransactionsReport,
  num,
  numOrNull,
} from "./types"

/**
 * Report builders.
 *
 * Source of record is `pms_clients_tracker` on db1 — 827k transactions across
 * 514 accounts back to 2018, which is the only feed deep enough for capital
 * gains, dividends and fee history. Client identity comes from
 * `pms_clients_master` on the portal DB; NAV history from `pms_master_sheet`.
 *
 * All queries are keyed on the account code (CLIENTCODE / nuvama_code /
 * ws_account_code are the same identifier across systems).
 */

/** Transaction types that represent fees and charges. */
const FEE_TYPES = ["MGF", "PRF", "CUS", "E01", "E09", "E10", "E12", "E20", "E21", "E03"] as const

/** Dividend and income transaction types. */
const INCOME_TYPES = ["RD0", "IN1", "CSI"] as const

export async function listClients(search?: string, limit = 100) {
  const params: unknown[] = []
  let where = "where clientcode is not null"
  if (search && search.trim()) {
    params.push(`%${search.trim()}%`)
    where += ` and (clientname ilike $1 or clientcode ilike $1)`
  }
  params.push(limit)
  const { rows } = await queryPortal(
    `select clientid, clientcode, clientname, schemename, pannumber, email, inceptiondate
     from pms_clients_master ${where}
     order by clientname
     limit $${params.length}`,
    params,
  )
  return rows.map((r: Record<string, unknown>) => ({
    clientId: String(r.clientid ?? ""),
    clientCode: String(r.clientcode ?? ""),
    name: String(r.clientname ?? ""),
    schemeName: String(r.schemename ?? ""),
  }))
}

export async function getClient(clientCode: string): Promise<ClientIdentity | null> {
  const { rows } = await queryPortal(
    `select clientid, clientcode, clientname, schemename, pannumber, email, inceptiondate
     from pms_clients_master where clientcode = $1 limit 1`,
    [clientCode],
  )
  if (rows.length === 0) return null
  const r = rows[0] as Record<string, unknown>
  return {
    clientId: String(r.clientid ?? ""),
    clientCode: String(r.clientcode ?? ""),
    name: String(r.clientname ?? ""),
    schemeName: String(r.schemename ?? ""),
    pan: (r.pannumber as string) ?? null,
    email: (r.email as string) ?? null,
    inceptionDate: r.inceptiondate ? String(r.inceptiondate) : null,
  }
}

/** Fetches the raw ledger once; several reports derive from the same rows. */
async function fetchLedger(clientCode: string, period: Period): Promise<LedgerRow[]> {
  const { rows } = await queryTracker(
    `select trandate, tran_type, tran_desc, isin, security_name,
            qty, rate, net_amount, stt, brokerage
     from pms_clients_tracker.pms_transactions
     where ws_account_code = $1 and trandate <= $2
     order by trandate`,
    [clientCode, period.to],
  )
  return rows.map((r: Record<string, unknown>) => ({
    trandate: String(r.trandate).slice(0, 10),
    tranType: String(r.tran_type ?? ""),
    isin: (r.isin as string) || null,
    securityName: String(r.security_name ?? ""),
    qty: num(r.qty),
    rate: num(r.rate),
    netAmount: num(r.net_amount),
    stt: num(r.stt),
    brokerage: num(r.brokerage),
  }))
}

export async function buildHoldingReport(
  client: ClientIdentity,
  period: Period,
): Promise<HoldingReport> {
  // The holdings feed carries cost and quantity directly, so gain/loss is the
  // custodian's own figure rather than something re-derived from the ledger.
  const { rows } = await queryTracker(
    `select security_name, security_code, security_type_description, astclsname,
            holding_qty, unitcost, cost, mktprice, mktvalue, holding_date
     from pms_clients_tracker.pms_holdings
     where ws_account_code = $1
       and holding_date = (
         select max(holding_date) from pms_clients_tracker.pms_holdings
         where ws_account_code = $1 and holding_date <= $2
       )
       and coalesce(holding_qty, 0) <> 0
     order by mktvalue desc nulls last`,
    [client.clientCode, period.to],
  )

  const holdings = rows as Record<string, unknown>[]
  const portfolioValue = holdings.reduce((s, r) => s + num(r.mktvalue), 0)

  const reportRows: HoldingRow[] = holdings.map((r) => {
    const name = String(r.security_name ?? "")
    const marketValue = num(r.mktvalue)
    const totalCost = num(r.cost)
    const gainLoss = marketValue - totalCost
    return {
      symbol: name,
      name,
      isin: (r.security_code as string) || null,
      sector: (r.astclsname as string) ?? null,
      assetClass: (r.security_type_description as string) ?? null,
      quantity: num(r.holding_qty),
      unitCost: num(r.unitcost),
      totalCost,
      unitPrice: num(r.mktprice),
      marketValue,
      gainLoss: totalCost !== 0 ? gainLoss : 0,
      gainLossPercent: totalCost !== 0 ? (gainLoss / totalCost) * 100 : 0,
      weightPercent: portfolioValue !== 0 ? (marketValue / portfolioValue) * 100 : 0,
    }
  })

  const totalCost = reportRows.reduce((s, r) => s + r.totalCost, 0)
  const marketValue = reportRows.reduce((s, r) => s + r.marketValue, 0)

  return {
    kind: "holding",
    client,
    period,
    coverage: {
      source: reportRows.length > 0 ? "database" : "none",
      emptyPeriod: reportRows.length === 0,
      note:
        reportRows.length === 0
          ? "No holdings snapshot on or before this date."
          : holdings[0]?.holding_date
            ? `Position as at ${String(holdings[0].holding_date).slice(0, 10)}.`
            : undefined,
    },
    rows: reportRows,
    totals: {
      totalCost,
      marketValue,
      gainLoss: marketValue - totalCost,
      gainLossPercent: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
      portfolioValue,
    },
  }
}

export async function buildTransactionsReport(
  client: ClientIdentity,
  period: Period,
): Promise<TransactionsReport> {
  const { rows } = await queryTracker(
    `select trandate, tran_type, tran_desc, isin, security_name,
            qty, rate, net_amount, stt, brokerage, total_trxnfee
     from pms_clients_tracker.pms_transactions
     where ws_account_code = $1 and trandate between $2 and $3
     order by trandate, id`,
    [client.clientCode, period.from, period.to],
  )

  const reportRows = (rows as Record<string, unknown>[]).map((r) => ({
    date: String(r.trandate).slice(0, 10),
    type: String(r.tran_type ?? ""),
    typeDetail: String(r.tran_desc ?? ""),
    symbol: String(r.security_name ?? ""),
    symbolName: String(r.security_name ?? ""),
    isin: (r.isin as string) || null,
    quantity: num(r.qty),
    rate: num(r.rate),
    amount: num(r.net_amount),
    charges: num(r.stt) + num(r.brokerage) + num(r.total_trxnfee),
  }))

  const purchases = reportRows
    .filter((r) => ["BY-", "OBY", "OPI"].includes(r.type))
    .reduce((s, r) => s + Math.abs(r.amount), 0)
  const sales = reportRows
    .filter((r) => ["SL+", "CSL", "OPO"].includes(r.type))
    .reduce((s, r) => s + Math.abs(r.amount), 0)
  const charges = reportRows.reduce((s, r) => s + r.charges, 0)

  return {
    kind: "transactions",
    client,
    period,
    coverage: {
      source: reportRows.length > 0 ? "database" : "none",
      emptyPeriod: reportRows.length === 0,
      note: reportRows.length === 0 ? "No transactions in this period." : undefined,
    },
    rows: reportRows,
    totals: { purchases, sales, charges, net: sales - purchases },
  }
}

export async function buildCapitalGainsReport(
  client: ClientIdentity,
  period: Period,
): Promise<CapitalGainsReport> {
  // The full ledger up to `to` is needed so FIFO can reach back to the
  // original acquisition, even when it predates the reporting window.
  const ledger = await fetchLedger(client.clientCode, period)
  const { rows, unmatchedSells } = computeRealisedGains(ledger, period)
  const summary = summariseGains(rows)

  const notes: string[] = []
  if (rows.length === 0) notes.push("No disposals in this period.")
  if (unmatchedSells > 0) {
    notes.push(
      `${unmatchedSells} disposal${unmatchedSells === 1 ? "" : "s"} had no matching acquisition in the ledger and are shown with cost treated as nil.`,
    )
  }

  return {
    kind: "capital-gains",
    client,
    period,
    coverage: {
      source: rows.length > 0 ? "database" : "none",
      emptyPeriod: rows.length === 0,
      note: notes.join(" ") || undefined,
    },
    rows,
    summary: {
      realisedGain: summary.realisedGain,
      unrealisedGain: null,
      shortTermGain: summary.shortTermGain,
      longTermGain: summary.longTermGain,
      unmatchedGain: summary.unmatchedGain,
      shortTermTax: null,
      longTermTax: null,
    },
  }
}

export async function buildExpensesReport(
  client: ClientIdentity,
  period: Period,
): Promise<ExpensesReport> {
  const { rows } = await queryTracker(
    `select trandate, tran_type, tran_desc, net_amount
     from pms_clients_tracker.pms_transactions
     where ws_account_code = $1 and trandate between $2 and $3
       and tran_type = any($4)
     order by trandate`,
    [client.clientCode, period.from, period.to, [...FEE_TYPES]],
  )

  const reportRows = (rows as Record<string, unknown>[]).map((r) => ({
    date: String(r.trandate).slice(0, 10),
    description: String(r.tran_desc ?? ""),
    amount: Math.abs(num(r.net_amount)),
    type: String(r.tran_type ?? ""),
  }))

  const sumOf = (types: string[]) =>
    reportRows.filter((r) => types.includes(r.type)).reduce((s, r) => s + r.amount, 0)

  const managementFees = sumOf(["MGF", "PRF"])
  const otherFees = sumOf(["CUS", "E01", "E09", "E10", "E12", "E20", "E21", "E03"])

  return {
    kind: "expenses",
    client,
    period,
    coverage: {
      source: reportRows.length > 0 ? "database" : "none",
      emptyPeriod: reportRows.length === 0,
      note: reportRows.length === 0 ? "No fees or charges in this period." : undefined,
    },
    rows: reportRows.map(({ date, description, amount }) => ({ date, description, amount })),
    totals: {
      managementFees,
      otherFees,
      expenses: managementFees + otherFees,
      total: managementFees + otherFees,
    },
  }
}

export async function buildDividendsReport(
  client: ClientIdentity,
  period: Period,
): Promise<DividendsReport> {
  const { rows } = await queryTracker(
    `select trandate, tran_type, tran_desc, security_name, isin,
            qty, rate, net_amount, tdsamount
     from pms_clients_tracker.pms_transactions
     where ws_account_code = $1 and trandate between $2 and $3
       and tran_type = any($4)
     order by trandate`,
    [client.clientCode, period.from, period.to, [...INCOME_TYPES]],
  )

  const all = rows as Record<string, unknown>[]
  const reportRows = all.map((r) => ({
    date: String(r.trandate).slice(0, 10),
    symbol: String(r.security_name ?? ""),
    symbolName: String(r.security_name ?? ""),
    quantity: numOrNull(r.qty),
    amountPerUnit: numOrNull(r.rate),
    amount: Math.abs(num(r.net_amount)),
    type: String(r.tran_type ?? ""),
  }))

  const dividend = reportRows
    .filter((r) => r.type === "RD0")
    .reduce((s, r) => s + r.amount, 0)
  const interest = reportRows
    .filter((r) => r.type === "IN1" || r.type === "CSI")
    .reduce((s, r) => s + r.amount, 0)

  return {
    kind: "dividends",
    client,
    period,
    coverage: {
      source: reportRows.length > 0 ? "database" : "none",
      emptyPeriod: reportRows.length === 0,
      note: reportRows.length === 0 ? "No dividend or interest income in this period." : undefined,
    },
    rows: reportRows.map(({ date, symbol, symbolName, quantity, amountPerUnit, amount }) => ({
      date,
      symbol,
      symbolName,
      quantity,
      amountPerUnit,
      amount,
    })),
    totals: { dividend, interest, total: dividend + interest },
  }
}

export async function buildFactsheetReport(
  client: ClientIdentity,
  period: Period,
): Promise<FactsheetReport> {
  const holding = await buildHoldingReport(client, period)

  // NAV history drives period return; pms_master_sheet is keyed by account_code.
  const { rows: navRows } = await queryPortal(
    `select report_date, nav, portfolio_value
     from public.pms_master_sheet
     where account_code = $1 and report_date between $2 and $3
     order by report_date`,
    [client.clientCode, period.from, period.to],
  )

  const navHistory = (navRows as Record<string, unknown>[])
    .map((r) => ({ date: String(r.report_date).slice(0, 10), nav: num(r.nav) }))
    .filter((r) => r.nav > 0)

  const first = navHistory[0]
  const last = navHistory[navHistory.length - 1]
  const simple = first && last && first.nav > 0 ? ((last.nav - first.nav) / first.nav) * 100 : null

  const gains = await buildCapitalGainsReport(client, period)

  const allocation = holding.rows
    .slice(0, 15)
    .map((r) => ({ label: r.name, value: r.marketValue, weightPercent: r.weightPercent }))

  // Group by the asset-class name the custodian supplies (astclsname).
  const bySector = new Map<string, number>()
  for (const row of holding.rows) {
    const key = row.sector || row.assetClass || "Unclassified"
    bySector.set(key, (bySector.get(key) ?? 0) + row.marketValue)
  }
  const total = holding.totals.portfolioValue
  const sectorAllocation = [...bySector.entries()]
    .map(([label, value]) => ({
      label,
      value,
      weightPercent: total !== 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value)

  return {
    kind: "factsheet",
    client,
    period,
    coverage: {
      source: holding.rows.length > 0 || navHistory.length > 0 ? "database" : "none",
      emptyPeriod: holding.rows.length === 0 && navHistory.length === 0,
      note:
        navHistory.length === 0
          ? "No NAV history for this account in the selected period; returns are omitted."
          : undefined,
    },
    returns: {
      irr: null,
      modifiedDietz: null,
      simple,
      realisedGain: gains.summary.realisedGain,
      unrealisedGain: holding.totals.gainLoss,
    },
    valuation: {
      beginMarketValue: first ? null : null,
      endMarketValue: holding.totals.marketValue,
      nav: last ? last.nav : null,
      capitalIn: null,
      capitalOut: null,
    },
    allocation,
    sectorAllocation,
    navHistory,
  }
}
