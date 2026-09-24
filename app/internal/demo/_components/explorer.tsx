"use client"

import { useMemo, useState } from "react"
import {
  type DemoCollection,
  type DemoRequest,
  type DemoResponse,
  jsonArrayToCsv,
  normalizeLiveResponse,
} from "@/lib/postmanCollectionShared"
import { RequestPanel } from "./request-panel"
import { ResponseViewer } from "./response-viewer"

type RunState =
  | { phase: "idle" }
  | { phase: "running" }
  | {
      phase: "done"
      response: DemoResponse
      durationMs: number
      tokenUsed: string | null
      totalRecords: number | null
      wireBytes: number | null
    }
  | { phase: "error"; message: string }

function statusOf(request: DemoRequest): { label: string; tone: "ok" | "fail" | "none" } {
  if (request.responses.length === 0) return { label: "—", tone: "none" }
  if (request.responses.some((r) => r.error)) {
    const failing = request.responses.find((r) => r.error)
    return { label: String(failing?.code ?? "ERR"), tone: "fail" }
  }
  return { label: String(request.responses[0].code), tone: "ok" }
}

function formatMb(bytes: number | null): string {
  if (!bytes) return "unknown size"
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TONE = {
  ok: "bg-[#02422b]/12 text-[#02422b] dark:bg-[#008455]/25 dark:text-[#8fd3b4]",
  fail: "bg-[#550e0e]/12 text-[#550e0e] dark:bg-[#550e0e]/40 dark:text-[#e79a9a]",
  none: "bg-[#37584f]/10 text-[#37584f]/60 dark:bg-white/8 dark:text-[#c6d0cb]/50",
} as const

export function Explorer({ collection }: { collection: DemoCollection }) {
  const [selectedId, setSelectedId] = useState(collection.requests[0]?.id ?? "")
  const [query, setQuery] = useState("")
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({})

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return collection.requests
    return collection.requests.filter(
      (r) => r.name.toLowerCase().includes(q) || r.pathname.toLowerCase().includes(q),
    )
  }, [collection.requests, query])

  const selected = collection.requests.find((r) => r.id === selectedId) ?? null
  const run = selected ? (runs[selected.id] ?? { phase: "idle" as const }) : { phase: "idle" as const }
  const selectedOverrides = selected ? (overrides[selected.id] ?? {}) : {}

  async function execute(request: DemoRequest) {
    setRuns((prev) => ({ ...prev, [request.id]: { phase: "running" } }))
    try {
      const res = await fetch("/api/internal/demo-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          overrides: overrides[request.id] ?? {},
        }),
      })

      const payload = (await res.json()) as {
        ok?: boolean
        code?: number
        status?: string
        durationMs?: number
        headers?: Record<string, string>
        body?: string
        error?: string
        tokenUsed?: string | null
        totalRecords?: number | null
        wireBytes?: number | null
      }

      if (!res.ok && payload.error) {
        setRuns((prev) => ({
          ...prev,
          [request.id]: { phase: "error", message: payload.error as string },
        }))
        return
      }

      const normalized = normalizeLiveResponse({
        code: payload.code ?? 0,
        status: payload.status ?? (payload.ok ? "OK" : "Failed"),
        headers: payload.headers ?? {},
        body: payload.body ?? "",
      })

      setRuns((prev) => ({
        ...prev,
        [request.id]: {
          phase: "done",
          response: normalized,
          durationMs: payload.durationMs ?? 0,
          tokenUsed: payload.tokenUsed ?? null,
          totalRecords: payload.totalRecords ?? null,
          wireBytes: payload.wireBytes ?? null,
        },
      }))
    } catch (err) {
      setRuns((prev) => ({
        ...prev,
        [request.id]: {
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      }))
    }
  }

  /**
   * Re-runs the request asking for the untrimmed array, so the CSV holds every
   * record rather than only the preview rows loaded in the browser.
   */
  async function fetchFullCsv(request: DemoRequest): Promise<string | null> {
    try {
      const res = await fetch("/api/internal/demo-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          overrides: overrides[request.id] ?? {},
          full: true,
        }),
      })
      const payload = (await res.json()) as { body?: string }
      if (!payload.body) return null
      return jsonArrayToCsv(payload.body)
    } catch {
      return null
    }
  }

  return (
    <div className="mx-auto grid max-w-[110rem] gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
      {/* Endpoint selector */}
      <aside className="lg:sticky lg:top-6">
        <div className="overflow-hidden rounded-xl border border-[#37584f]/20 bg-[#f7f5e9] dark:border-[#c6d0cb]/15 dark:bg-[#1a201d]">
          <div className="border-b border-[#37584f]/15 p-3 dark:border-[#c6d0cb]/10">
            <label htmlFor="endpoint-search" className="sr-only">
              Filter endpoints
            </label>
            <input
              id="endpoint-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter endpoints…"
              className="w-full rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-2 text-sm text-[#002017] placeholder:text-[#37584f]/50 focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4] dark:placeholder:text-[#c6d0cb]/40"
            />
          </div>

          <ul className="max-h-[60vh] overflow-y-auto p-2">
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-[#37584f]/60 dark:text-[#c6d0cb]/50">
                No endpoints match “{query}”.
              </li>
            )}
            {filtered.map((req) => {
              const status = statusOf(req)
              const active = req.id === selectedId
              const state = runs[req.id]
              return (
                <li key={req.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(req.id)}
                    aria-current={active ? "true" : undefined}
                    className={[
                      "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[#02422b] focus-visible:outline-none",
                      active
                        ? "bg-[#02422b] text-[#efecd3]"
                        : "hover:bg-[#02422b]/8 dark:hover:bg-[#dabd38]/10",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={[
                          "block truncate text-sm font-semibold",
                          active ? "text-[#efecd3]" : "text-[#02422b] dark:text-[#8fd3b4]",
                        ].join(" ")}
                      >
                        {req.name}
                      </span>
                      <span
                        className={[
                          "block truncate font-mono text-[10px]",
                          active ? "text-[#efecd3]/70" : "text-[#37584f]/70 dark:text-[#c6d0cb]/55",
                        ].join(" ")}
                      >
                        {req.pathname}
                      </span>
                    </span>
                    {state?.phase === "running" && (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 animate-pulse rounded-full bg-[#dabd38]"
                      />
                    )}
                    <span
                      className={[
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        active ? "bg-[#efecd3]/20 text-[#efecd3]" : TONE[status.tone],
                      ].join(" ")}
                    >
                      {status.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {/* Selected endpoint */}
      <div className="min-w-0">
        {!selected ? (
          <p className="rounded-xl border border-dashed border-[#37584f]/30 bg-[#f7f5e9] px-4 py-16 text-center text-sm text-[#37584f]/70 dark:border-[#c6d0cb]/20 dark:bg-[#1a201d] dark:text-[#c6d0cb]/60">
            Select an endpoint to view its request and response.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-[family-name:var(--font-playfair)] text-2xl text-[#02422b] dark:text-[#8fd3b4]">
                  {selected.name}
                </h2>
                <p className="mt-1 font-mono text-xs break-all text-[#37584f]/75 dark:text-[#c6d0cb]/60">
                  {selected.method} {selected.url}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void execute(selected)}
                disabled={run.phase === "running"}
                className="shrink-0 rounded-lg bg-[#02422b] px-4 py-2 text-sm font-semibold text-[#dabd38] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#02422b] focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-[#0e1512]"
              >
                {run.phase === "running" ? "Running…" : "Run request"}
              </button>
            </div>

            {/* Editable body params so dates can be changed before running. */}
            {selected.bodyFields.length > 0 && (
              <section className="rounded-xl border border-[#37584f]/20 bg-[#f7f5e9] p-4 dark:border-[#c6d0cb]/15 dark:bg-[#1a201d]">
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
                  Parameters
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {selected.bodyFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`param-${selected.id}-${field.key}`}
                        className="mb-1 block font-mono text-[11px] font-semibold text-[#02422b] dark:text-[#8fd3b4]"
                      >
                        {field.key}
                      </label>
                      <input
                        id={`param-${selected.id}-${field.key}`}
                        type="text"
                        value={selectedOverrides[field.key] ?? field.value}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [selected.id]: {
                              ...(prev[selected.id] ?? {}),
                              [field.key]: e.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-[#37584f]/25 bg-[#efecd3] px-3 py-1.5 font-mono text-xs text-[#002017] focus-visible:border-[#02422b] focus-visible:ring-2 focus-visible:ring-[#02422b]/30 focus-visible:outline-none dark:border-[#c6d0cb]/20 dark:bg-[#0e1512] dark:text-[#f3f5f4]"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {run.phase === "error" && (
              <p className="rounded-xl border border-[#550e0e]/30 bg-[#550e0e]/10 px-4 py-3 text-sm text-[#550e0e] dark:text-[#e79a9a]">
                Request failed: {run.message}
              </p>
            )}

            {run.phase === "done" && (
              <div>
                <h3 className="mb-3 flex items-baseline gap-2 font-[family-name:var(--font-playfair)] text-base text-[#02422b] dark:text-[#8fd3b4]">
                  Live response
                  <span className="font-sans text-xs font-normal text-[#37584f]/70 dark:text-[#c6d0cb]/60">
                    {run.durationMs} ms
                  </span>
                  {run.tokenUsed && (
                    <span
                      title={run.tokenUsed}
                      className="rounded bg-[#dabd38]/20 px-1.5 py-0.5 font-mono text-[10px] font-normal text-[#8a5a00] dark:text-[#dabd38]"
                    >
                      fresh token …{run.tokenUsed.slice(-8)}
                    </span>
                  )}
                </h3>
                <ResponseViewer
                  response={run.response}
                  label="Live"
                  filenameBase={`${selected.id}-live`}
                  note={
                    run.totalRecords
                      ? `Upstream returned ${run.totalRecords.toLocaleString()} records (${formatMb(run.wireBytes)}). Showing the first 200 — Export CSV downloads all of them.`
                      : undefined
                  }
                  onExportFull={() => fetchFullCsv(selected)}
                />
              </div>
            )}

            <RequestPanel request={selected} />

            <div>
              <h3 className="mb-3 font-[family-name:var(--font-playfair)] text-base text-[#02422b] dark:text-[#8fd3b4]">
                {selected.responses.length > 1 ? "Saved examples" : "Saved example"}
              </h3>
              {selected.responses.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#37584f]/30 bg-[#f7f5e9] px-4 py-10 text-center text-sm text-[#37584f]/70 dark:border-[#c6d0cb]/20 dark:bg-[#1a201d] dark:text-[#c6d0cb]/60">
                  No saved response in the collection — use Run request to call it live.
                </p>
              ) : (
                <div className="space-y-5">
                  {selected.responses.map((res, i) => (
                    <ResponseViewer
                      key={`${selected.id}-${i}`}
                      response={res}
                      label="Saved"
                      filenameBase={`${selected.id}-${i + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
