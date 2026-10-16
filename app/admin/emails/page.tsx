"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Lock, Mail, Paperclip, RefreshCw, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  EmptyState,
  ErrorNote,
  KpiCard,
  PageHeader,
  Pill,
  boFetch,
  errorMessage,
  fmtDate,
  fmtDateTime,
  fmtNum,
  fmtRelative,
} from "@/components/admin-kit"

type RecipientType = "investor" | "distributor" | "internal"

interface EmailItem {
  id: number
  at: string
  to: string[]
  cc: string[]
  fromName: string | null
  subject: string
  status: "sent" | "failed"
  error: string | null
  bodyWithheld: boolean
  attachments: number
  type: RecipientType
  name: string | null
  clientCodes: string[]
}

interface EmailDetail extends Omit<EmailItem, "attachments"> {
  html: string | null
  attachments: Array<{ name: string; size: number }>
}

interface EmailsResponse {
  items: EmailItem[]
  page: number
  limit: number
  total: number
  counts: { investor: number; distributor: number; internal: number; failed: number; since: string | null }
  only: RecipientType | null
}

const LIMIT = 50
const TYPE_LABEL: Record<RecipientType, string> = { investor: "Investors", distributor: "Distributors", internal: "Internal" }

function TypeTag({ type }: { type: RecipientType }) {
  return type === "investor" ? <Pill tone="green">Investor</Pill> : type === "distributor" ? <Pill tone="gold">Distributor</Pill> : <Pill>Internal</Pill>
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function AdminEmailsPage() {
  const [data, setData] = useState<EmailsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [type, setType] = useState<RecipientType | "">("")
  const [failedOnly, setFailedOnly] = useState(false)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Search runs a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      if (type) qs.set("type", type)
      if (failedOnly) qs.set("status", "failed")
      if (q) qs.set("q", q)
      setData(await boFetch<EmailsResponse>(`/api/admin/bo/emails?${qs}`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, type, failedOnly, q, page])

  useEffect(() => {
    load()
  }, [load])

  // New filters start from the first page.
  useEffect(() => {
    setPage(1)
  }, [from, to, type, failedOnly, q])

  useEffect(() => {
    if (openId == null) return
    setDetail(null)
    setDetailError(null)
    boFetch<{ email: EmailDetail }>(`/api/admin/bo/emails?id=${openId}`)
      .then((r) => setDetail(r.email))
      .catch((e) => setDetailError(errorMessage(e)))
  }, [openId])

  const c = data?.counts
  const items = data?.items
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const hasFilters = !!(from || to || type || failedOnly || q)
  const types: RecipientType[] = data?.only ? [data.only] : ["investor", "distributor", "internal"]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Emails"
        description={`Every email myQode sent from the web portal or the app, newest first.${c?.since ? ` Recorded since ${fmtDate(c.since)}.` : ""} Sign-in codes and password links are never stored.`}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email, name, client code or subject"
            className="w-[300px] bg-white pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-[170px] bg-white" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-[170px] bg-white" />
        </label>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("")
              setTo("")
              setType("")
              setFailedOnly(false)
              setSearch("")
            }}
          >
            <X className="h-4 w-4" /> Clear filters
          </Button>
        ) : null}
      </div>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!c && loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : c ? (
          <>
            {types.map((t) => (
              <button key={t} type="button" onClick={() => setType(type === t ? "" : t)} className="text-left">
                <KpiCard
                  label={TYPE_LABEL[t]}
                  value={fmtNum(c[t])}
                  hint={type === t ? "Showing only these (click to show all)" : "Click to show only these"}
                  icon={<Mail className="h-4 w-4" />}
                  accent={type === t}
                />
              </button>
            ))}
            <button type="button" onClick={() => setFailedOnly(!failedOnly)} className="text-left">
              <KpiCard
                label="Failed"
                value={fmtNum(c.failed)}
                hint={failedOnly ? "Showing only failed (click to show all)" : "Not delivered to Microsoft. Click to show"}
                accent={failedOnly}
              />
            </button>
          </>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#EFECD3]/60 hover:bg-[#EFECD3]/60">
              <TableHead className="pl-5">When</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="pr-5">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j} className={j === 0 ? "pl-5" : undefined}>
                        <Skeleton className="h-4 w-full max-w-[200px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items?.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer align-top" onClick={() => setOpenId(m.id)}>
                    <TableCell className="whitespace-nowrap pl-5">
                      <p className="text-sm text-[#002017]">{fmtRelative(m.at)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(m.at)}</p>
                    </TableCell>
                    <TableCell className="max-w-[280px] text-sm">
                      {m.name ? <p className="font-medium text-[#002017]">{m.name}</p> : null}
                      <p className="break-all text-[#02422B]">{m.to.join(", ")}</p>
                      {m.clientCodes.length ? <p className="text-xs text-muted-foreground">{m.clientCodes.join(" · ")}</p> : null}
                    </TableCell>
                    <TableCell className="max-w-[420px] text-sm text-[#002017]">
                      <span className="flex items-center gap-1.5">
                        {m.bodyWithheld ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                        {m.attachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                        {m.subject || <span className="text-muted-foreground">No subject</span>}
                      </span>
                    </TableCell>
                    <TableCell><TypeTag type={m.type} /></TableCell>
                    <TableCell className="pr-5">
                      {m.status === "sent" ? <Pill tone="green">Sent</Pill> : <Pill tone="red">Failed</Pill>}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!loading && items && items.length === 0 ? (
          <EmptyState
            icon={<Mail className="h-5 w-5" />}
            title="No emails"
            description={hasFilters ? "Nothing matches these filters." : "Emails appear here as myQode sends them."}
          />
        ) : null}
        {data && data.total > data.limit ? (
          <div className="flex items-center justify-between border-t border-[#02422B]/10 px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {data.page} of {pages} ({fmtNum(data.total)} emails)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> Newer
              </Button>
              <Button variant="outline" size="sm" disabled={loading || page >= pages} onClick={() => setPage((p) => p + 1)}>
                Older <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog open={openId != null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto bg-[#F9F7EC]">
          <DialogHeader>
            <DialogTitle className="pr-6 text-[#002017]">{detail?.subject || (detailError ? "Email" : "Loading…")}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 text-sm">
                {detail ? (
                  <>
                    <p>
                      {fmtDateTime(detail.at)} · {detail.status === "sent" ? <Pill tone="green">Sent</Pill> : <Pill tone="red">Failed</Pill>}{" "}
                      <TypeTag type={detail.type} />
                    </p>
                    <p>
                      <span className="text-muted-foreground">To </span>
                      {detail.to.map((a, i) => (
                        <span key={a}>
                          {i ? ", " : ""}
                          <Link href={`/admin/users/${encodeURIComponent(a)}`} className="text-[#02422B] hover:underline">
                            {a}
                          </Link>
                        </span>
                      ))}
                    </p>
                    {detail.cc.length ? (
                      <p>
                        <span className="text-muted-foreground">Cc </span>
                        {detail.cc.join(", ")}
                      </p>
                    ) : null}
                    {detail.fromName ? (
                      <p>
                        <span className="text-muted-foreground">From </span>
                        {detail.fromName}
                      </p>
                    ) : null}
                    {detail.error ? <p className="text-red-700">{detail.error}</p> : null}
                    {detail.attachments.length ? (
                      <p className="flex flex-wrap items-center gap-2">
                        <Paperclip className="h-3.5 w-3.5" />
                        {detail.attachments.map((a) => `${a.name} (${kb(a.size)})`).join(", ")}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          {detailError ? <ErrorNote message={detailError} /> : null}
          {!detail && !detailError ? <Skeleton className="h-[400px] w-full rounded-lg" /> : null}
          {detail ? (
            detail.html ? (
              // The stored HTML runs with no scripts, forms or navigation: a picture of the email, nothing more.
              <iframe title="Email body" sandbox="" srcDoc={detail.html} className="h-[60vh] w-full rounded-lg border border-[#02422B]/10 bg-white" />
            ) : (
              <EmptyState
                icon={<Lock className="h-5 w-5" />}
                title="Body not stored"
                description="This email carried a sign-in code or a password link, so only its subject and recipients are kept."
              />
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
