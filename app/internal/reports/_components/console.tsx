"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { AnyReport, ReportKind } from "@/lib/reports/types"
import { REPORT_LABELS } from "@/lib/reports/types"
import { Statement } from "./statement"
import { reportToCsv } from "./csv"

type ClientOption = {
  clientId: string
  clientCode: string
  name: string
  schemeName: string
}

const KINDS: ReportKind[] = [
  "holding",
  "factsheet",
  "transactions",
  "capital-gains",
  "expenses",
  "dividends",
]

/** Indian financial year containing `d`: 1 April → 31 March. */
function currentFinancialYear(d = new Date()): { from: string; to: string } {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` }
}

function download(name: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportConsole() {
  const fy = useMemo(() => currentFinancialYear(), [])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [search, setSearch] = useState("")
  const [clientCode, setClientCode] = useState("")
  const [kind, setKind] = useState<ReportKind>("holding")
  const [from, setFrom] = useState(fy.from)
  const [to, setTo] = useState(fy.to)
  const [report, setReport] = useState<AnyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientsError, setClientsError] = useState<string | null>(null)

  // Debounced client lookup so typing doesn't hammer the DB.
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/internal/reports?clients=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((d: { clients?: ClientOption[]; error?: string }) => {
          if (d.error) {
            setClientsError(d.error)
            return
          }
          setClientsError(null)
          setClients(d.clients ?? [])
        })
        .catch((e) => setClientsError(e instanceof Error ? e.message : String(e)))
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  const generate = useCallback(async () => {
    if (!clientCode) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/internal/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientCode, kind, from, to }),
      })
      const data = (await res.json()) as { report?: AnyReport; error?: string }
      if (data.error) {
        setError(data.error)
        setReport(null)
      } else {
        setReport(data.report ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [clientCode, kind, from, to])

  const selected = clients.find((c) => c.clientCode === clientCode)

  return (
    <>
      {/* Controls — hidden when printing so only the statement goes to paper. */}
      <section className="print:hidden">
        <div className="mx-auto mb-6 max-w-[110rem] rounded-xl border border-[#37584f]/20 bg-[#f7f5e9] p-4 dark:border-[#c6d0cb]/15 dark:bg-[#1a201d]">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto_auto_auto]">
            <div>
              <label
                htmlFor="client"
                className="mb-1 block text-[11px] font-semibold tracking-wider text-[#37584f]/80 uppercase dark:text-[#c6d0cb]/60"
              >
                Client
              </label>
              <input
                id="client-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
                className="mb-2 w-full rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-2 text-sm text-[#002017] placeholder:text-[#37584f]/50 focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4]"
              />
              <select
                id="client"
                value={clientCode}
                onChange={(e) => setClientCode(e.target.value)}
                className="w-full rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-2 text-sm text-[#002017] focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4]"
              >
                <option value="">
                  {clients.length === 0 ? "No clients found" : `Select from ${clients.length}…`}
                </option>
                {clients.map((c) => (
                  <option key={c.clientCode} value={c.clientCode}>
                    {c.clientCode} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="kind"
                className="mb-1 block text-[11px] font-semibold tracking-wider text-[#37584f]/80 uppercase dark:text-[#c6d0cb]/60"
              >
                Report
              </label>
              <select
                id="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ReportKind)}
                className="w-full rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-2 text-sm text-[#002017] focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4]"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {REPORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="from"
                className="mb-1 block text-[11px] font-semibold tracking-wider text-[#37584f]/80 uppercase dark:text-[#c6d0cb]/60"
              >
                From
              </label>
              <input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-2 text-sm text-[#002017] focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4]"
              />
            </div>

            <div>
              <label
                htmlFor="to"
                className="mb-1 block text-[11px] font-semibold tracking-wider text-[#37584f]/80 uppercase dark:text-[#c6d0cb]/60"
              >
                To
              </label>
              <input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-2 text-sm text-[#002017] focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4]"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={!clientCode || loading}
                className="rounded-lg bg-[#02422b] px-5 py-2 text-sm font-semibold text-[#dabd38] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#02422b] focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-[#0e1512]"
              >
                {loading ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => {
                setFrom(fy.from)
                setTo(fy.to)
              }}
              className="text-[#02422b] underline underline-offset-2 dark:text-[#dabd38]"
            >
              This financial year
            </button>
            <button
              type="button"
              onClick={() => {
                setFrom("2018-01-01")
                setTo(new Date().toISOString().slice(0, 10))
              }}
              className="text-[#02422b] underline underline-offset-2 dark:text-[#dabd38]"
            >
              Since inception
            </button>

            {report && (
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    download(
                      `${report.client.clientCode}-${report.kind}-${report.period.from}-${report.period.to}.csv`,
                      reportToCsv(report),
                      "text/csv;charset=utf-8",
                    )
                  }
                  className="rounded-md border border-[#37584f]/25 px-3 py-1.5 font-medium text-[#37584f] hover:bg-[#02422b]/8 dark:border-[#c6d0cb]/25 dark:text-[#c6d0cb]"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-md border border-[#37584f]/25 px-3 py-1.5 font-medium text-[#37584f] hover:bg-[#02422b]/8 dark:border-[#c6d0cb]/25 dark:text-[#c6d0cb]"
                >
                  Print / Save PDF
                </button>
              </span>
            )}
          </div>

          {clientsError && (
            <p className="mt-3 rounded-lg bg-[#550e0e]/10 px-3 py-2 text-xs text-[#550e0e] dark:text-[#e79a9a]">
              Could not load clients: {clientsError}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg bg-[#550e0e]/10 px-3 py-2 text-xs text-[#550e0e] dark:text-[#e79a9a]">
              {error}
            </p>
          )}
          {selected && !report && !loading && (
            <p className="mt-3 text-xs text-[#37584f]/75 dark:text-[#c6d0cb]/60">
              {selected.name} · {selected.schemeName}
            </p>
          )}
        </div>
      </section>

      {report ? (
        <Statement report={report} />
      ) : (
        <p className="print:hidden mx-auto max-w-[110rem] rounded-xl border border-dashed border-[#37584f]/30 bg-[#f7f5e9] px-4 py-16 text-center text-sm text-[#37584f]/70 dark:border-[#c6d0cb]/20 dark:bg-[#1a201d] dark:text-[#c6d0cb]/60">
          Choose a client, report and period, then Generate.
        </p>
      )}
    </>
  )
}
