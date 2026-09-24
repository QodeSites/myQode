"use client"

import { useMemo, useState } from "react"
import { type DemoResponse, tableToCsv } from "@/lib/postmanCollectionShared"
import { JsonView } from "./json-view"

type Mode = "table" | "records" | "pretty" | "raw" | "headers"

function StatusPill({ code, status }: { code: number; status: string }) {
  const ok = code >= 200 && code < 300
  const unknown = code === 0
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        unknown
          ? "bg-[#37584f]/12 text-[#37584f] dark:bg-white/10 dark:text-[#c6d0cb]"
          : ok
            ? "bg-[#02422b]/12 text-[#02422b] dark:bg-[#008455]/25 dark:text-[#8fd3b4]"
            : "bg-[#550e0e]/12 text-[#550e0e] dark:bg-[#550e0e]/40 dark:text-[#e79a9a]",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${unknown ? "bg-[#37584f]" : ok ? "bg-[#008455]" : "bg-[#b91c1c]"}`}
      />
      {unknown ? status : `${code} ${status}`}
    </span>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function SmallButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-[#37584f]/25 px-2.5 py-1 text-xs font-medium text-[#37584f] transition-colors hover:bg-[#02422b]/8 focus-visible:ring-2 focus-visible:ring-[#02422b] focus-visible:outline-none dark:border-[#c6d0cb]/25 dark:text-[#c6d0cb] dark:hover:bg-[#dabd38]/10"
    >
      {children}
    </button>
  )
}

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ResponseViewer({
  response,
  label,
  filenameBase = "response",
  note,
  onExportFull,
}: {
  response: DemoResponse
  label?: string
  filenameBase?: string
  /** Extra context line, e.g. "showing 200 of 8121 records". */
  note?: string
  /**
   * When present, "Export CSV" calls this to fetch the complete dataset rather
   * than exporting only the rows held in the browser.
   */
  onExportFull?: () => Promise<string | null>
}) {
  const parsed = useMemo(() => {
    if (response.language !== "json") return undefined
    try {
      return JSON.parse(response.body) as unknown
    } catch {
      return undefined
    }
  }, [response.body, response.language])

  const table = response.table
  const canPretty = parsed !== undefined
  const [mode, setMode] = useState<Mode>(table ? "table" : canPretty ? "pretty" : "raw")
  const [copied, setCopied] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Columns worth showing: drop the all-null ones unless asked for.
  const columns = useMemo(() => {
    if (!table) return []
    if (showEmpty) return table.columns
    const useful = table.columns.filter((c) => !table.allNullColumns.includes(c))
    return useful.length > 0 ? useful : table.columns
  }, [table, showEmpty])

  const tabs: { id: Mode; label: string; on: boolean }[] = [
    { id: "table", label: "Table", on: !!table },
    { id: "records", label: "Records", on: !!table },
    { id: "pretty", label: "JSON", on: canPretty },
    { id: "raw", label: "Raw", on: true },
    { id: "headers", label: `Headers (${response.headers.length})`, on: true },
  ]

  return (
    <section className="overflow-hidden rounded-xl border border-[#37584f]/20 bg-[#f7f5e9] dark:border-[#c6d0cb]/15 dark:bg-[#1a201d]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#37584f]/15 px-4 py-3 dark:border-[#c6d0cb]/10">
        {label && (
          <span className="rounded bg-[#02422b] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#dabd38] uppercase">
            {label}
          </span>
        )}
        <StatusPill code={response.code} status={response.status} />
        <span className="text-xs text-[#37584f]/80 dark:text-[#c6d0cb]/70">
          {formatBytes(response.byteLength)}
          {table && ` · ${table.totalRows} records · ${table.columns.length} fields`}
        </span>

        <div className="ml-auto flex gap-2">
          {table && (
            <SmallButton
              onClick={() => {
                if (!onExportFull) {
                  download(`${filenameBase}.csv`, tableToCsv(table), "text/csv;charset=utf-8")
                  return
                }
                setExporting(true)
                void onExportFull()
                  .then((csv) => {
                    download(
                      `${filenameBase}.csv`,
                      csv ?? tableToCsv(table),
                      "text/csv;charset=utf-8",
                    )
                  })
                  .finally(() => setExporting(false))
              }}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </SmallButton>
          )}
          <SmallButton
            onClick={() => {
              void navigator.clipboard.writeText(response.body).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? "Copied" : "Copy JSON"}
          </SmallButton>
        </div>
      </header>

      {response.error && (
        <div className="border-b border-[#550e0e]/20 bg-[#550e0e]/8 px-4 py-3 dark:bg-[#550e0e]/20">
          <p className="text-sm font-semibold text-[#550e0e] dark:text-[#e79a9a]">
            {response.error.message}
          </p>
          {response.error.detail && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-[#550e0e]/85 hover:underline dark:text-[#e79a9a]/85">
                Show detail
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-[#02422b]/5 p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-[#37584f] dark:bg-black/25 dark:text-[#c6d0cb]">
                {response.error.detail}
              </pre>
            </details>
          )}
        </div>
      )}

      <nav
        className="flex flex-wrap gap-1 border-b border-[#37584f]/15 px-2 pt-2 dark:border-[#c6d0cb]/10"
        aria-label="Response view"
      >
        {tabs
          .filter((t) => t.on)
          .map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              aria-current={mode === tab.id ? "true" : undefined}
              className={[
                "rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#02422b] focus-visible:outline-none",
                mode === tab.id
                  ? "bg-[#02422b] text-[#efecd3]"
                  : "text-[#37584f] hover:bg-[#02422b]/8 dark:text-[#c6d0cb] dark:hover:bg-[#dabd38]/10",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
      </nav>

      <div className="p-4">
        {note && (
          <p className="mb-3 rounded-lg bg-[#dabd38]/12 px-3 py-2 text-xs text-[#8a5a00] dark:text-[#dabd38]">
            {note}
          </p>
        )}

        {table && (mode === "table" || mode === "records") && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#37584f]/80 dark:text-[#c6d0cb]/70">
            <span>
              {table.rows.length} of {table.totalRows} records · {columns.length} of{" "}
              {table.columns.length} fields
            </span>
            {table.allNullColumns.length > 0 && (
              <button
                type="button"
                onClick={() => setShowEmpty((s) => !s)}
                className="font-medium text-[#02422b] underline underline-offset-2 dark:text-[#dabd38]"
              >
                {showEmpty
                  ? "Hide empty fields"
                  : `Show ${table.allNullColumns.length} empty fields`}
              </button>
            )}
            {table.maskedColumns.length > 0 && (
              <span className="rounded bg-[#dabd38]/20 px-1.5 py-0.5 text-[#8a5a00] dark:text-[#dabd38]">
                PII masked: {table.maskedColumns.join(", ")}
              </span>
            )}
          </div>
        )}

        {/*
          Table view: fixed layout + wrapping cells so the table always fits the
          container width. No horizontal scrolling — wide field sets should use
          the Records view instead.
        */}
        {mode === "table" && table && (
          <div className="rounded-lg border border-[#37584f]/15 dark:border-[#c6d0cb]/12">
            <table className="w-full table-fixed border-collapse text-left text-xs">
              <thead>
                <tr className="bg-[#02422b]/6 dark:bg-black/25">
                  {columns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="border-b border-[#37584f]/15 px-2 py-2 font-semibold break-words text-[#02422b] dark:border-[#c6d0cb]/12 dark:text-[#8fd3b4]"
                    >
                      {col}
                      {table.maskedColumns.includes(col) && (
                        <span title="Masked" className="ml-1 opacity-60">
                          ●
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="even:bg-[#02422b]/3 hover:bg-[#dabd38]/10 dark:even:bg-white/2">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="border-b border-[#37584f]/10 px-2 py-1.5 align-top font-mono break-words text-[#37584f] dark:border-[#c6d0cb]/8 dark:text-[#c6d0cb]"
                      >
                        {row[col] === null ? (
                          <span className="italic opacity-40">—</span>
                        ) : (
                          row[col]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {columns.length > 8 && (
              <p className="border-t border-[#37584f]/10 px-3 py-2 text-[11px] text-[#37584f]/70 dark:border-[#c6d0cb]/8 dark:text-[#c6d0cb]/60">
                {columns.length} fields in one row gets cramped — the{" "}
                <button
                  type="button"
                  onClick={() => setMode("records")}
                  className="font-medium text-[#02422b] underline underline-offset-2 dark:text-[#dabd38]"
                >
                  Records view
                </button>{" "}
                is easier to read.
              </p>
            )}
          </div>
        )}

        {/* Records view: one card per record, fields wrap — never scrolls sideways. */}
        {mode === "records" && table && (
          <ul className="space-y-3">
            {table.rows.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-[#37584f]/15 bg-[#efecd3]/50 p-3 dark:border-[#c6d0cb]/12 dark:bg-black/20"
              >
                <p className="mb-2 text-[10px] font-bold tracking-wider text-[#37584f]/60 uppercase dark:text-[#c6d0cb]/50">
                  Record {i + 1}
                </p>
                <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {columns.map((col) => (
                    <div key={col} className="min-w-0">
                      <dt className="text-[10px] font-semibold tracking-wide text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/55">
                        {col}
                        {table.maskedColumns.includes(col) && (
                          <span title="Masked" className="ml-1">
                            ●
                          </span>
                        )}
                      </dt>
                      <dd className="font-mono text-xs break-words text-[#02422b] dark:text-[#f3f5f4]">
                        {row[col] === null ? (
                          <span className="italic opacity-40">—</span>
                        ) : (
                          row[col]
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}

        {mode === "pretty" && (
          <div className="max-h-[34rem] overflow-y-auto rounded-lg bg-[#02422b]/4 p-3 font-mono text-xs leading-relaxed break-words dark:bg-black/25">
            <JsonView value={parsed} initialOpen />
          </div>
        )}

        {mode === "raw" && (
          <pre className="max-h-[34rem] overflow-y-auto rounded-lg bg-[#02422b]/4 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-[#37584f] dark:bg-black/25 dark:text-[#c6d0cb]">
            {response.body || <span className="italic opacity-60">Empty body.</span>}
            {response.truncated && (
              <span className="mt-2 block text-[#8a5a00] italic dark:text-[#dabd38]">
                Body truncated for display.
              </span>
            )}
          </pre>
        )}

        {mode === "headers" && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-[minmax(8rem,14rem)_1fr]">
            {response.headers.length === 0 && (
              <p className="text-[#37584f]/60 italic dark:text-[#c6d0cb]/50">No headers.</p>
            )}
            {response.headers.map((h, i) => (
              <div key={`${h.key}-${i}`} className="contents">
                <dt className="font-semibold break-words text-[#02422b] dark:text-[#8fd3b4]">
                  {h.key}
                </dt>
                <dd className="break-words text-[#37584f] dark:text-[#c6d0cb]">{h.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}
