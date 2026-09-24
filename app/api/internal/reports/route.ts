import { NextResponse } from "next/server"
import {
  buildCapitalGainsReport,
  buildDividendsReport,
  buildExpensesReport,
  buildFactsheetReport,
  buildHoldingReport,
  buildTransactionsReport,
  getClient,
  listClients,
} from "@/lib/reports/build"
import type { ReportKind } from "@/lib/reports/types"

/**
 * Internal report API.
 *
 * GET  ?clients=<search>       — client picker
 * POST { clientCode, kind, from, to } — build one report
 *
 * Gated behind the same switch as the /internal pages; these payloads carry
 * unmasked investor data by design (statements are useless otherwise).
 */

export const dynamic = "force-dynamic"

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_INTERNAL_DEMO === "true"
}

const BUILDERS = {
  holding: buildHoldingReport,
  factsheet: buildFactsheetReport,
  transactions: buildTransactionsReport,
  "capital-gains": buildCapitalGainsReport,
  expenses: buildExpensesReport,
  dividends: buildDividendsReport,
} as const

export async function GET(request: Request) {
  if (!enabled()) return NextResponse.json({ error: "Not available" }, { status: 404 })

  const url = new URL(request.url)
  const search = url.searchParams.get("clients") ?? ""
  try {
    const clients = await listClients(search, 200)
    return NextResponse.json({ clients })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: "Not available" }, { status: 404 })

  let clientCode: string
  let kind: ReportKind
  let from: string
  let to: string
  try {
    const body = (await request.json()) as Record<string, unknown>
    clientCode = String(body.clientCode ?? "")
    kind = String(body.kind ?? "") as ReportKind
    from = String(body.from ?? "")
    to = String(body.to ?? "")
    if (!clientCode || !(kind in BUILDERS) || !from || !to) {
      return NextResponse.json({ error: "clientCode, kind, from and to are required" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
  }

  try {
    const client = await getClient(clientCode)
    if (!client) {
      return NextResponse.json({ error: `Unknown client: ${clientCode}` }, { status: 404 })
    }
    const report = await BUILDERS[kind](client, { from, to })
    return NextResponse.json({ report })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
