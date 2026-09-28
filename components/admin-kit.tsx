"use client"

// Shared building blocks for the web backoffice (/admin): session context, fetch helper,
// formatters and small presentational pieces used across the admin pages.

import { createContext, useContext, useState, type ReactNode } from "react"
import { Eye, EyeOff, Inbox, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Brand tokens                                                        */
/* ------------------------------------------------------------------ */

export const BRAND = {
  green: "#02422B",
  deep: "#002017",
  gold: "#DABD38",
  cream: "#EFECD3",
  card: "#F9F7EC",
} as const

/* ------------------------------------------------------------------ */
/* Session context                                                     */
/* ------------------------------------------------------------------ */

export interface BackofficeAdmin {
  email: string
  name: string
  level: "super" | "staff" | string
  via?: string
}

interface AdminSessionValue {
  admin: BackofficeAdmin | null
  signOut: () => Promise<void>
}

const AdminSessionContext = createContext<AdminSessionValue>({
  admin: null,
  signOut: async () => {},
})

export function AdminSessionProvider({
  value,
  children,
}: {
  value: AdminSessionValue
  children: ReactNode
}) {
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useBackofficeAdmin() {
  return useContext(AdminSessionContext)
}

/* ------------------------------------------------------------------ */
/* Fetch helper                                                        */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function boFetch<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {}
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/admin/login")) {
      const next = window.location.pathname + window.location.search
      window.location.replace(`/admin/login?next=${encodeURIComponent(next)}`)
    }
    const msg =
      (data && typeof data.error === "string" && data.error) ||
      (res.status === 403 ? "You do not have permission to do this." : `Request failed (${res.status})`)
    throw new ApiError(msg, res.status, data?.code)
  }
  return data as T
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Something went wrong"
}

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

const numFmt = new Intl.NumberFormat("en-IN")

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "0"
  return numFmt.format(Number(n))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "25 Sep 2026, 10:42" */
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v)
  if (!d) return "Never"
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`
}

/** "25 Sep 2026" */
export function fmtDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v)
  if (!d) return "Not set"
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "25 Sep" for chart axes (accepts YYYY-MM-DD). */
export function fmtShortDay(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
  const d = toDate(v)
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : v
}

/** "3 min ago", "2 h ago", "5 days ago" */
export function fmtRelative(v: string | number | Date | null | undefined): string {
  const d = toDate(v)
  if (!d) return "Never"
  const diff = Date.now() - d.getTime()
  const s = Math.round(diff / 1000)
  if (s < 0) return "Just now"
  if (s < 45) return "Just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"} ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`
  const years = Math.round(days / 365)
  return `${years} ${years === 1 ? "year" : "years"} ago`
}

/* ------------------------------------------------------------------ */
/* Password rules                                                      */
/* ------------------------------------------------------------------ */

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters."
  if (!/[A-Za-z]/.test(pw)) return "Include at least one letter."
  if (!/\d/.test(pw)) return "Include at least one digit."
  return null
}

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl font-bold text-[#02422B]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm", className)}>
      {title || action ? (
        <div className="flex items-start justify-between gap-3 border-b border-[#02422B]/10 px-5 py-3.5">
          <div>
            {title ? <h2 className="text-sm font-semibold text-[#002017]">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string
  description?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-10 text-center", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFECD3] text-[#02422B]">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <p className="text-sm font-medium text-[#002017]">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>{message}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

type Tone = "green" | "gold" | "red" | "grey" | "blue" | "amber"

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  gold: "bg-[#DABD38]/15 text-[#6b5a07] border-[#DABD38]/40",
  red: "bg-red-50 text-red-700 border-red-200",
  grey: "bg-stone-100 text-stone-600 border-stone-200",
  blue: "bg-sky-50 text-sky-800 border-sky-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
}

export function Pill({ tone = "grey", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function TypePill({ type }: { type: string }) {
  return type === "distributor" ? <Pill tone="gold">Distributor</Pill> : <Pill tone="green">Investor</Pill>
}

export function PasswordStatusPill({
  passwordSet,
  needsSetup,
  locked,
}: {
  passwordSet?: boolean
  needsSetup?: boolean
  locked?: boolean
}) {
  if (locked) return <Pill tone="red">Locked</Pill>
  if (passwordSet) return <Pill tone="green">Password set</Pill>
  if (needsSetup) return <Pill tone="amber">Needs setup</Pill>
  return <Pill tone="grey">No password</Pill>
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-sm",
        accent ? "border-[#02422B] bg-[#02422B] text-[#EFECD3]" : "border-[#02422B]/10 bg-[#F9F7EC]",
      )}
    >
      <div className="flex items-center justify-between">
        <p className={cn("text-xs font-medium", accent ? "text-[#EFECD3]/80" : "text-muted-foreground")}>{label}</p>
        {icon ? <span className={accent ? "text-[#DABD38]" : "text-[#02422B]/60"}>{icon}</span> : null}
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", accent ? "text-white" : "text-[#002017]")}>{value}</p>
      {hint ? (
        <p className={cn("mt-1 text-xs", accent ? "text-[#EFECD3]/70" : "text-muted-foreground")}>{hint}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Set password dialog                                                 */
/* ------------------------------------------------------------------ */

export function SetPasswordDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  onSubmit: (password: string) => Promise<void>
}) {
  const [pw, setPw] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPw("")
    setConfirm("")
    setShow(false)
    setError(null)
    setBusy(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = passwordProblem(pw)
    if (problem) return setError(problem)
    if (pw !== confirm) return setError("The two passwords do not match.")
    setBusy(true)
    setError(null)
    try {
      await onSubmit(pw)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bo-new-password">New password</Label>
            <div className="relative">
              <Input
                id="bo-new-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a digit.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bo-confirm-password">Confirm password</Label>
            <Input
              id="bo-confirm-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-[#02422B] text-white hover:bg-[#02422B]/90">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
