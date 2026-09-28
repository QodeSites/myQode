"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const MS_ERRORS: Record<string, string> = {
  oauth_error: "Microsoft sign-in failed.",
  missing_code: "The Microsoft sign-in response was incomplete.",
  invalid_state: "Security validation failed. Please try again.",
  token_exchange_failed: "Could not complete Microsoft sign-in.",
  profile_fetch_failed: "Could not read your Microsoft profile.",
  unauthorized: "This Microsoft account is not authorised for the backoffice.",
  callback_error: "Something went wrong during Microsoft sign-in.",
  session_expired: "Your session has expired. Please sign in again.",
}

/** Only allow same-site relative paths inside /admin as a post-login destination. */
function safeNext(raw: string | null): string {
  if (!raw) return "/admin"
  if (!raw.startsWith("/admin") || raw.startsWith("//") || raw.startsWith("/admin/login")) return "/admin"
  return raw
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get("next") || params.get("redirect"))
  const msError = params.get("error")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(msError ? MS_ERRORS[msError] || "Sign-in failed." : null)

  // Already signed in? Skip the form.
  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => {
        if (!cancelled && r.ok) router.replace(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [next, router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError("Enter your email and password.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Sign-in failed. Please try again.")
        setBusy(false)
        return
      }
      router.replace(next)
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between bg-[#002017] p-12 text-[#EFECD3] lg:flex">
        <div>
          <p className="font-serif text-3xl font-bold">myQode</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-[#DABD38]">Backoffice</p>
        </div>
        <div className="max-w-md">
          <p className="font-serif text-4xl leading-tight">Investor and distributor access, in one place.</p>
          <p className="mt-4 text-sm text-[#EFECD3]/70">
            Manage sign-ins, help users get set up, and see how the portal and app are being used.
          </p>
        </div>
        <p className="text-xs text-[#EFECD3]/50">Qode Advisors LLP</p>
      </div>

      <div className="flex items-center justify-center bg-[#EFECD3]/40 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="font-serif text-3xl font-bold text-[#02422B]">myQode</p>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#8a7414]">Backoffice</p>
          </div>
          <h1 className="font-serif text-3xl font-bold text-[#02422B]">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your backoffice email and password.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 bg-white"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 bg-white pr-10"
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
            </div>

            {error ? (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={busy}
              className="h-11 w-full bg-[#02422B] text-white hover:bg-[#02422B]/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Signing in" : "Sign in"}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            Qode staff
            <span className="h-px flex-1 bg-border" />
          </div>

          <a
            href={`/api/auth/microsoft?redirect=${encodeURIComponent(next)}`}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[#02422B]/20 bg-white text-sm font-medium text-[#002017] transition-colors hover:bg-[#F9F7EC]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#f35325" d="M1 1h10v10H1z" />
              <path fill="#81bc06" d="M13 1h10v10H13z" />
              <path fill="#05a6f0" d="M1 13h10v10H1z" />
              <path fill="#ffba08" d="M13 13h10v10H13z" />
            </svg>
            Sign in with Microsoft
          </a>
        </div>
      </div>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
