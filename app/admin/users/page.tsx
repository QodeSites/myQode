"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  PasswordStatusPill,
  TypePill,
  boFetch,
  errorMessage,
  fmtDateTime,
  fmtNum,
  fmtRelative,
  passwordProblem,
} from "@/components/admin-kit"

interface BoUser {
  email: string
  name: string
  type: "investor" | "distributor"
  clientCodes: string[]
  groupId: string | null
  headOfFamily: string | null
  passwordSet: boolean
  needsSetup: boolean
  locked: boolean
  lastLoginAt: string | null
  lastWebLoginAt: string | null
  lastAppLoginAt: string | null
  loginCount: number
  webLogins: number
  appLogins: number
  intermediary: string | null
  clientCount?: number
}

interface UsersResponse {
  items: BoUser[]
  total: number
  page: number
  limit: number
}

const LIMIT = 50
const TYPES = ["all", "investor", "distributor"] as const
const STATUSES = ["all", "needs-setup", "locked", "never"] as const

function UsersPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const type = (TYPES as readonly string[]).includes(params.get("type") || "") ? params.get("type")! : "all"
  const status = (STATUSES as readonly string[]).includes(params.get("status") || "") ? params.get("status")! : "all"
  const page = Math.max(1, Number(params.get("page")) || 1)
  const q = params.get("q") || ""

  const [search, setSearch] = useState(q)
  const [data, setData] = useState<UsersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || ((k === "type" || k === "status") && v === "all") || (k === "page" && v === "1")) next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  // Keep the box in sync when the URL changes from outside (sidebar links).
  useEffect(() => {
    setSearch(q)
  }, [q])

  // Debounced search into the URL.
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => setParams({ q: search.trim() || null, page: null }), 300)
    return () => clearTimeout(t)
  }, [search, q, setParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ q, type, status, page: String(page), limit: String(LIMIT) })
      setData(await boFetch<UsersResponse>(`/api/admin/bo/users?${qs}`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [q, type, status, page])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.limit || LIMIT))) : 1
  const title = type === "investor" ? "Investors" : type === "distributor" ? "Distributors" : "Users"
  const openUser = (email: string) => router.push(`/admin/users/${encodeURIComponent(email)}`)

  const rangeText = useMemo(() => {
    if (!data || data.total === 0) return null
    const start = (data.page - 1) * data.limit + 1
    const end = Math.min(data.total, data.page * data.limit)
    return `${fmtNum(start)} to ${fmtNum(end)} of ${fmtNum(data.total)}`
  }, [data])

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description="Search by name, email or client code. Select a row to manage the user."
        actions={
          <Button onClick={() => setNewOpen(true)} className="bg-[#02422B] text-white hover:bg-[#02422B]/90">
            <Plus className="h-4 w-4" />
            New distributor
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={type} onValueChange={(v) => setParams({ type: v, page: null })}>
          <TabsList className="bg-[#EFECD3]">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="investor">Investors</TabsTrigger>
            <TabsTrigger value="distributor">Distributors</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or client code"
            className="bg-white pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setParams({ status: v, page: null })}>
          <SelectTrigger className="w-[180px] bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="needs-setup">Needs setup</SelectItem>
            <SelectItem value="locked">Locked</SelectItem>
            <SelectItem value="never">Never logged in</SelectItem>
          </SelectContent>
        </Select>
        {loading && data ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="overflow-hidden rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#EFECD3]/60 hover:bg-[#EFECD3]/60">
              <TableHead className="pl-5">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Client codes</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Last web</TableHead>
              <TableHead>Last app</TableHead>
              <TableHead className="pr-5 text-right">Logins</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j} className={j === 0 ? "pl-5" : undefined}>
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.items.map((u) => (
                  <TableRow
                    key={u.email}
                    onClick={() => openUser(u.email)}
                    className="cursor-pointer hover:bg-[#EFECD3]/50"
                  >
                    <TableCell className="max-w-[320px] pl-5">
                      <p className="truncate font-medium text-[#002017]">{u.name || u.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell>
                      <TypePill type={u.type} />
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {u.type === "distributor" ? (
                        <span className="text-sm text-muted-foreground">
                          {fmtNum(u.clientCount ?? 0)} {u.clientCount === 1 ? "investor" : "investors"}
                        </span>
                      ) : u.clientCodes?.length ? (
                        <span className="block truncate font-mono text-xs text-[#002017]" title={u.clientCodes.join(", ")}>
                          {u.clientCodes.slice(0, 3).join(", ")}
                          {u.clientCodes.length > 3 ? ` +${u.clientCodes.length - 3}` : ""}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <PasswordStatusPill passwordSet={u.passwordSet} needsSetup={u.needsSetup} locked={u.locked} />
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-[#002017]">{fmtRelative(u.lastLoginAt)}</p>
                      {u.lastLoginAt ? (
                        <p className="text-xs text-muted-foreground">{fmtDateTime(u.lastLoginAt)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtRelative(u.lastWebLoginAt)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtRelative(u.lastAppLoginAt)}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <p className="text-sm font-semibold tabular-nums text-[#002017]">{fmtNum(u.loginCount)}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {fmtNum(u.webLogins)} web, {fmtNum(u.appLogins)} app
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!loading && data && data.items.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No users match"
            description="Try a different search or clear the filters."
          />
        ) : null}
        {data && data.total > 0 ? (
          <div className="flex items-center justify-between border-t border-[#02422B]/10 px-5 py-3 text-sm">
            <span className="text-muted-foreground">{rangeText}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setParams({ page: String(page - 1) })}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <span className="px-2 text-muted-foreground">
                Page {fmtNum(page)} of {fmtNum(totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <NewDistributorDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(email) => {
          toast.success("Distributor created")
          openUser(email)
        }}
      />
    </div>
  )
}

function NewDistributorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (email: string) => void
}) {
  const empty = { name: "", email: "", password: "", salutation: "", firstName: "", lastName: "", feePercentage: "" }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const close = (o: boolean) => {
    if (!o) {
      setForm(empty)
      setError(null)
      setBusy(false)
    }
    onOpenChange(o)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = form.email.trim().toLowerCase()
    if (!form.name.trim()) return setError("Enter a name.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email.")
    const pwProblem = passwordProblem(form.password)
    if (pwProblem) return setError(pwProblem)
    let fee: number | undefined
    if (form.feePercentage.trim()) {
      fee = Number(form.feePercentage)
      if (!Number.isFinite(fee) || fee < 0 || fee > 100) return setError("Fee must be a number between 0 and 100.")
    }
    setBusy(true)
    setError(null)
    try {
      await boFetch("/api/admin/bo/distributors", {
        method: "POST",
        json: {
          name: form.name.trim(),
          email,
          password: form.password,
          ...(form.salutation.trim() ? { salutation: form.salutation.trim() } : {}),
          ...(form.firstName.trim() ? { firstName: form.firstName.trim() } : {}),
          ...(form.lastName.trim() ? { lastName: form.lastName.trim() } : {}),
          ...(fee !== undefined ? { feePercentage: fee } : {}),
        },
      })
      close(false)
      onCreated(email)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New distributor</DialogTitle>
            <DialogDescription>Creates a distributor login with the password you set here.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="nd-name">Name</Label>
              <Input id="nd-name" value={form.name} onChange={set("name")} autoFocus />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="nd-email">Email</Label>
              <Input id="nd-email" type="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="nd-password">Password</Label>
              <Input
                id="nd-password"
                type="text"
                autoComplete="new-password"
                value={form.password}
                onChange={set("password")}
              />
              <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a digit.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-sal">Salutation (optional)</Label>
              <Input id="nd-sal" value={form.salutation} onChange={set("salutation")} placeholder="Mr, Ms" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-fee">Fee % (optional)</Label>
              <Input id="nd-fee" inputMode="decimal" value={form.feePercentage} onChange={set("feePercentage")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-first">First name (optional)</Label>
              <Input id="nd-first" value={form.firstName} onChange={set("firstName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-last">Last name (optional)</Label>
              <Input id="nd-last" value={form.lastName} onChange={set("lastName")} />
            </div>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-[#02422B] text-white hover:bg-[#02422B]/90">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create distributor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <UsersPageInner />
    </Suspense>
  )
}
