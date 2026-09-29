"use client"

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Toaster } from "sonner"
import {
  Activity,
  Banknote,
  BarChart3,
  Bell,
  Briefcase,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  MessageSquareHeart,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react"
import { AdminSessionProvider, type BackofficeAdmin } from "@/components/admin-kit"
import { cn } from "@/lib/utils"

const PUBLIC_PATHS = ["/admin/login", "/admin/auth-complete"]

type NavItem = {
  label: string
  href: string
  icon: typeof Users
  isActive: (pathname: string, type: string | null) => boolean
}

const NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard, isActive: (p) => p === "/admin" },
  {
    label: "Investors",
    href: "/admin/users?type=investor",
    icon: Users,
    isActive: (p, t) => p === "/admin/users" && t === "investor",
  },
  {
    label: "Distributors",
    href: "/admin/users?type=distributor",
    icon: Briefcase,
    isActive: (p, t) => p === "/admin/users" && t === "distributor",
  },
  {
    label: "Analytics",
    href: "/admin/onboarding",
    icon: BarChart3,
    isActive: (p) => p.startsWith("/admin/onboarding"),
  },
  { label: "App analytics", href: "/admin/analytics", icon: Activity, isActive: (p) => p.startsWith("/admin/analytics") },
  { label: "Queries", href: "/admin/queries", icon: MessageSquare, isActive: (p) => p.startsWith("/admin/queries") },
  { label: "Feedback", href: "/admin/feedback", icon: MessageSquareHeart, isActive: (p) => p.startsWith("/admin/feedback") },
  { label: "Payments", href: "/admin/payments", icon: Banknote, isActive: (p) => p.startsWith("/admin/payments") },
  { label: "Notifications", href: "/admin/notifications", icon: Bell, isActive: (p) => p.startsWith("/admin/notifications") },
  { label: "Audit log", href: "/admin/audit", icon: ScrollText, isActive: (p) => p.startsWith("/admin/audit") },
  { label: "Admins", href: "/admin/admins", icon: ShieldCheck, isActive: (p) => p.startsWith("/admin/admins") },
]

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/admin"
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))

  if (isPublic) {
    return (
      <>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </>
    )
  }

  return (
    <Suspense fallback={<FullScreenLoader />}>
      <GuardedShell pathname={pathname}>{children}</GuardedShell>
    </Suspense>
  )
}

function FullScreenLoader({ label = "Loading backoffice" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#EFECD3]/40">
      <div className="flex items-center gap-3 text-sm text-[#02422B]">
        <Loader2 className="h-5 w-5 animate-spin" />
        {label}
      </div>
    </div>
  )
}

function GuardedShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [admin, setAdmin] = useState<BackofficeAdmin | null>(null)
  const [state, setState] = useState<"checking" | "ok" | "error">("checking")
  const [signingOut, setSigningOut] = useState(false)

  const check = useCallback(async () => {
    setState("checking")
    try {
      const res = await fetch("/api/admin/auth/me", { credentials: "same-origin", cache: "no-store" })
      if (res.status === 401 || res.status === 403) {
        const qs = typeof window !== "undefined" ? window.location.search : ""
        router.replace(`/admin/login?next=${encodeURIComponent(pathname + qs)}`)
        return
      }
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = await res.json()
      setAdmin(data.admin)
      setState("ok")
    } catch {
      setState("error")
    }
    // Only re-check when the shell mounts; navigation inside /admin keeps the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const signOut = useCallback(async () => {
    setSigningOut(true)
    try {
      await fetch("/api/admin/auth/logout", { method: "POST", credentials: "same-origin" })
      if (admin?.via === "microsoft") {
        await fetch("/api/auth/admin/logout", { method: "POST", credentials: "same-origin" }).catch(() => {})
      }
    } catch {
      // ignore: we still leave the backoffice
    }
    router.replace("/admin/login")
  }, [admin, router])

  if (state === "checking") return <FullScreenLoader />
  if (state === "error" || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#EFECD3]/40 p-6">
        <div className="max-w-sm rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] p-6 text-center shadow-sm">
          <p className="font-serif text-xl font-bold text-[#02422B]">Could not reach the backoffice</p>
          <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
          <button
            onClick={check}
            className="mt-4 rounded-md bg-[#02422B] px-4 py-2 text-sm font-medium text-white hover:bg-[#02422B]/90"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const type = searchParams.get("type")
  const initials = (admin.name || admin.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("")

  return (
    <AdminSessionProvider value={{ admin, signOut }}>
      <div className="flex min-h-screen bg-[#EFECD3]/35">
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-[#002017] text-[#EFECD3]">
          <Link href="/admin" className="block px-6 pb-6 pt-7">
            <span className="font-serif text-2xl font-bold tracking-wide text-[#EFECD3]">myQode</span>
            <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-[0.18em] text-[#DABD38]">
              Backoffice
            </span>
          </Link>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
            {NAV.map((item) => {
              const active = item.isActive(pathname, type)
              const Icon = item.icon
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-[#DABD38] font-semibold text-[#002017]"
                      : "text-[#EFECD3]/80 hover:bg-white/5 hover:text-[#EFECD3]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="border-t border-white/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#02422B] text-xs font-bold text-[#DABD38]">
                {initials || "A"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#EFECD3]">{admin.name || admin.email}</p>
                <p className="truncate text-[11px] text-[#EFECD3]/60">
                  {admin.level === "super" ? "Super admin" : "Staff"}
                  {admin.via === "microsoft" ? " (Microsoft)" : ""}
                </p>
              </div>
            </div>
            <button
              onClick={signOut}
              disabled={signingOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-[#EFECD3]/90 transition-colors hover:bg-white/5 disabled:opacity-60"
            >
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Sign out
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1600px] px-8 py-8">{children}</div>
        </main>
      </div>
      <Toaster position="top-right" richColors closeButton />
    </AdminSessionProvider>
  )
}
