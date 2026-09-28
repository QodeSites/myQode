"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCw, ScrollText, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  boFetch,
  errorMessage,
  fmtDateTime,
  fmtRelative,
} from "@/components/admin-kit"

interface AuditItem {
  id: string | number
  at: string
  admin: string
  action: string
  target: string | null
  details: unknown
  ip: string | null
}

const KNOWN_ACTIONS = [
  "admin.login",
  "admin.set_password",
  "user.set_password",
  "user.reset_link",
  "user.unlock",
  "user.impersonate",
  "distributor.create",
  "distributor.delete",
]

const LIMITS = ["100", "250", "500"]

function detailsText(d: unknown): string {
  if (d === null || d === undefined || d === "") return ""
  if (typeof d === "string") return d
  if (typeof d === "object") {
    return Object.entries(d as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ")
  }
  return String(d)
}

export default function AdminAuditPage() {
  const [items, setItems] = useState<AuditItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [admin, setAdmin] = useState("")
  const [adminQuery, setAdminQuery] = useState("")
  const [action, setAction] = useState("all")
  const [limit, setLimit] = useState("100")
  const [admins, setAdmins] = useState<string[]>([])

  // Debounce the admin filter.
  useEffect(() => {
    const t = setTimeout(() => setAdminQuery(admin.trim()), 300)
    return () => clearTimeout(t)
  }, [admin])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit })
      if (adminQuery) qs.set("admin", adminQuery)
      if (action !== "all") qs.set("action", action)
      const res = await boFetch<{ items: AuditItem[] }>(`/api/admin/bo/audit?${qs}`)
      setItems(res.items)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [adminQuery, action, limit])

  useEffect(() => {
    load()
  }, [load])

  // Suggest backoffice admin emails for the filter.
  useEffect(() => {
    boFetch<{ items: { email: string }[] }>("/api/admin/bo/admins")
      .then((r) => setAdmins(r.items.map((a) => a.email)))
      .catch(() => {})
  }, [])

  const actions = useMemo(() => {
    const set = new Set(KNOWN_ACTIONS)
    items?.forEach((i) => set.add(i.action))
    return Array.from(set).sort()
  }, [items])

  const hasFilters = admin || action !== "all"

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Every sign-in, password change, impersonation and account change made from the backoffice."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-[300px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
            placeholder="Filter by admin email"
            list="bo-audit-admins"
            className="bg-white pl-9"
          />
          <datalist id="bo-audit-admins">
            {admins.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[220px] bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={limit} onValueChange={setLimit}>
          <SelectTrigger className="w-[140px] bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMITS.map((l) => (
              <SelectItem key={l} value={l}>
                Latest {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdmin("")
              setAction("all")
            }}
          >
            <X className="h-4 w-4" /> Clear filters
          </Button>
        ) : null}
      </div>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="overflow-hidden rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#EFECD3]/60 hover:bg-[#EFECD3]/60">
              <TableHead className="pl-5">When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="pr-5">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items
              ? Array.from({ length: 12 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j} className={j === 0 ? "pl-5" : undefined}>
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items?.map((a) => (
                  <TableRow key={String(a.id)}>
                    <TableCell className="whitespace-nowrap pl-5">
                      <p className="text-sm text-[#002017]">{fmtRelative(a.at)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(a.at)}</p>
                    </TableCell>
                    <TableCell className="text-sm">{a.admin}</TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap rounded bg-[#EFECD3] px-1.5 py-0.5 font-mono text-xs text-[#002017]">
                        {a.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.target ? (
                        a.target.includes("@") ? (
                          <Link
                            href={`/admin/users/${encodeURIComponent(a.target)}`}
                            className="text-[#02422B] hover:underline"
                          >
                            {a.target}
                          </Link>
                        ) : (
                          a.target
                        )
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate text-xs text-muted-foreground" title={detailsText(a.details)}>
                      {detailsText(a.details) || "None"}
                    </TableCell>
                    <TableCell className="pr-5 font-mono text-xs text-muted-foreground">{a.ip || "Unknown"}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!loading && items && items.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title="No audit entries"
            description={hasFilters ? "Nothing matches these filters." : "Backoffice actions will appear here."}
          />
        ) : null}
      </div>
    </div>
  )
}
