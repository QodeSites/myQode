import type { AnyReport } from "@/lib/reports/types"
import { REPORT_LABELS } from "@/lib/reports/types"

/** RFC 4180 escaping. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function rowsToCsv(headers: string[], rows: unknown[][]): string[] {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))]
}

/**
 * Serializes a report to CSV. A short identifying preamble is included so an
 * exported file is self-describing once it leaves the app.
 */
export function reportToCsv(report: AnyReport): string {
  const lines: string[] = [
    `${REPORT_LABELS[report.kind]}`,
    `Client,${cell(report.client.name)}`,
    `Code,${cell(report.client.clientCode)}`,
    `Scheme,${cell(report.client.schemeName)}`,
    `Period,${report.period.from} to ${report.period.to}`,
    "",
  ]

  switch (report.kind) {
    case "holding":
      lines.push(
        ...rowsToCsv(
          ["Security", "ISIN", "Class", "Quantity", "Avg cost", "Price", "Cost", "Market value", "P&L", "P&L %", "Weight %"],
          report.rows.map((r) => [
            r.name,
            r.isin,
            r.sector ?? r.assetClass,
            r.quantity,
            r.unitCost.toFixed(4),
            r.unitPrice.toFixed(4),
            r.totalCost.toFixed(2),
            r.marketValue.toFixed(2),
            r.gainLoss.toFixed(2),
            r.gainLossPercent.toFixed(2),
            r.weightPercent.toFixed(2),
          ]),
        ),
        "",
        `Total cost,${report.totals.totalCost.toFixed(2)}`,
        `Market value,${report.totals.marketValue.toFixed(2)}`,
        `Unrealised P&L,${report.totals.gainLoss.toFixed(2)}`,
      )
      break

    case "factsheet":
      lines.push(
        `Portfolio value,${report.valuation.endMarketValue ?? ""}`,
        `NAV,${report.valuation.nav ?? ""}`,
        `Period return %,${report.returns.simple ?? ""}`,
        `Realised gain,${report.returns.realisedGain ?? ""}`,
        `Unrealised gain,${report.returns.unrealisedGain ?? ""}`,
        "",
        "Asset allocation",
        ...rowsToCsv(
          ["Class", "Value", "Weight %"],
          report.sectorAllocation.map((a) => [a.label, a.value.toFixed(2), a.weightPercent.toFixed(2)]),
        ),
        "",
        "Top holdings",
        ...rowsToCsv(
          ["Security", "Value", "Weight %"],
          report.allocation.map((a) => [a.label, a.value.toFixed(2), a.weightPercent.toFixed(2)]),
        ),
      )
      if (report.navHistory.length > 0) {
        lines.push(
          "",
          "NAV history",
          ...rowsToCsv(["Date", "NAV"], report.navHistory.map((n) => [n.date, n.nav])),
        )
      }
      break

    case "transactions":
      lines.push(
        ...rowsToCsv(
          ["Date", "Type", "Description", "Security", "ISIN", "Quantity", "Rate", "Amount", "Charges"],
          report.rows.map((r) => [
            r.date,
            r.type,
            r.typeDetail,
            r.symbolName,
            r.isin,
            r.quantity,
            r.rate,
            r.amount.toFixed(2),
            r.charges.toFixed(2),
          ]),
        ),
        "",
        `Purchases,${report.totals.purchases.toFixed(2)}`,
        `Sales,${report.totals.sales.toFixed(2)}`,
        `Charges,${report.totals.charges.toFixed(2)}`,
      )
      break

    case "capital-gains":
      lines.push(
        ...rowsToCsv(
          ["Security", "ISIN", "Quantity", "Acquired", "Sold", "Cost", "Proceeds", "Gain", "Term"],
          report.rows.map((r) => [
            r.symbol,
            r.isin,
            r.quantity,
            r.acquiredOn,
            r.soldOn,
            r.cost.toFixed(2),
            r.proceeds.toFixed(2),
            r.gain.toFixed(2),
            r.term,
          ]),
        ),
        "",
        `Short-term gain,${report.summary.shortTermGain ?? ""}`,
        `Long-term gain,${report.summary.longTermGain ?? ""}`,
        `Unmatched (term n/a),${report.summary.unmatchedGain ?? ""}`,
        `Total realised,${report.summary.realisedGain ?? ""}`,
      )
      break

    case "expenses":
      lines.push(
        ...rowsToCsv(
          ["Date", "Description", "Amount"],
          report.rows.map((r) => [r.date, r.description, r.amount.toFixed(2)]),
        ),
        "",
        `Management & performance,${report.totals.managementFees ?? ""}`,
        `Other charges,${report.totals.otherFees ?? ""}`,
        `Total,${report.totals.total ?? ""}`,
      )
      break

    case "dividends":
      lines.push(
        ...rowsToCsv(
          ["Date", "Security", "Units", "Amount"],
          report.rows.map((r) => [r.date, r.symbolName, r.quantity, r.amount.toFixed(2)]),
        ),
        "",
        `Dividends,${report.totals.dividend ?? ""}`,
        `Interest,${report.totals.interest ?? ""}`,
        `Total,${report.totals.total ?? ""}`,
      )
      break
  }

  if (report.coverage.note) lines.push("", `Note,${cell(report.coverage.note)}`)
  return lines.join("\r\n")
}
