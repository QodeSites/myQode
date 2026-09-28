"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  Loader2,
  Mail,
  Smartphone,
  Trash2,
  Unlock,
  UserX,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  EmptyState,
  ErrorNote,
  Panel,
  PasswordStatusPill,
  Pill,
  SetPasswordDialog,
  TypePill,
  boFetch,
  errorMessage,
  fmtDate,
  fmtDateTime,
  fmtNum,
  fmtRelative,
  useBackofficeAdmin,
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

interface Detail {
  user: BoUser
  accounts: {
    clientId: string | number
    clientCode: string | null
    name: string
    strategy: string | null
    status: string | null
    headOfFamily: string | null
    groupId: string | null
    ownerId: string | null
    maturityDate: string | null
  }[]
  logins: { at: string; platform: "web" | "app"; os: string | null }[]
  app: { lastVersion: string | null; platform: string | null; lastSeenAt: string | null } | null
  investors?: { email: string; name: string; clientCodes: string[] }[]
  audit: { at: string; admin: string; action: string; details: unknown }[]
}

type Busy = null | "portal" | "app" | "reset" | "unlock" | "delete"

function decodeParam(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw || ""
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

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

export default function AdminUserDetailPage() {
  const params = useParams<{ email: string }>()
  const email = decodeParam(params?.email)
  const router = useRouter()
  const { admin } = useBackofficeAdmin()
  const isSuper = admin?.level === "super"

  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await boFetch<Detail>(`/api/admin/bo/users/detail?email=${encodeURIComponent(email)}`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [email])

  useEffect(() => {
    load()
  }, [load])

  // Open the tab synchronously (before the await) so popup blockers allow it.
  const openPortal = async () => {
    const win = window.open("about:blank", "_blank")
    setBusy("portal")
    try {
      const res = await boFetch<{ redirectUrl: string }>("/api/admin/bo/impersonate", {
        method: "POST",
        json: { email, target: "portal" },
      })
      if (win) win.location.href = res.redirectUrl
      else window.open(res.redirectUrl, "_blank")
      toast.success("Opened the web portal as this user")
      load()
    } catch (e) {
      win?.close()
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const openApp = async () => {
    const win = window.open("about:blank", "_blank")
    setBusy("app")
    try {
      const res = await boFetch<{ token: string }>("/api/admin/bo/impersonate", {
        method: "POST",
        json: { email, target: "app" },
      })
      localStorage.setItem("myqode.token", res.token)
      if (win) win.location.href = "/app"
      else window.open("/app", "_blank")
      toast.success("Opened the web app as this user", {
        description: "This browser's web app session now belongs to this user until it expires or you sign out there.",
      })
      load()
    } catch (e) {
      win?.close()
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const sendReset = async () => {
    setBusy("reset")
    try {
      await boFetch("/api/admin/bo/users/reset-link", { method: "POST", json: { email } })
      toast.success(`Reset link sent to ${email}`)
      load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const unlock = async () => {
    setBusy("unlock")
    try {
      await boFetch("/api/admin/bo/users/unlock", { method: "POST", json: { email } })
      toast.success("Account unlocked")
      load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const deleteDistributor = async () => {
    setBusy("delete")
    try {
      await boFetch(`/api/admin/bo/distributors?email=${encodeURIComponent(email)}`, { method: "DELETE" })
      toast.success("Distributor deleted")
      setDeleteOpen(false)
      router.replace("/admin/users?type=distributor")
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(null)
    }
  }

  const backHref = data?.user.type === "distributor" ? "/admin/users?type=distributor" : "/admin/users?type=investor"

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-40 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="col-span-2 h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-5">
        <BackLink href="/admin/users" />
        {error.toLowerCase().includes("not found") ? (
          <Panel>
            <EmptyState
              icon={<UserX className="h-5 w-5" />}
              title="User not found"
              description={`There is no investor or distributor with the email ${email}.`}
            />
          </Panel>
        ) : (
          <ErrorNote message={error} onRetry={load} />
        )}
      </div>
    )
  }

  if (!data) return null
  const u = data.user

  return (
    <div className="space-y-5">
      <BackLink href={backHref} />

      {/* Header card */}
      <section className="rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TypePill type={u.type} />
              <PasswordStatusPill passwordSet={u.passwordSet} needsSetup={u.needsSetup} locked={u.locked} />
              {u.locked && u.passwordSet ? <Pill tone="green">Password set</Pill> : null}
              {!u.lastLoginAt ? <Pill tone="grey">Never logged in</Pill> : null}
            </div>
            <h1 className="mt-3 truncate font-serif text-3xl font-bold text-[#02422B]">{u.name || u.email}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{u.email}</p>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <Meta label="Last login" value={u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"} />
              <Meta label="Last web" value={fmtRelative(u.lastWebLoginAt)} />
              <Meta label="Last app" value={fmtRelative(u.lastAppLoginAt)} />
              <Meta
                label="Logins"
                value={`${fmtNum(u.loginCount)} (${fmtNum(u.webLogins)} web, ${fmtNum(u.appLogins)} app)`}
              />
              {u.type === "investor" && u.clientCodes?.length ? (
                <Meta label="Client codes" value={u.clientCodes.join(", ")} mono />
              ) : null}
              {u.intermediary ? <Meta label="Distributor" value={u.intermediary} /> : null}
              {u.type === "distributor" ? <Meta label="Investors" value={fmtNum(u.clientCount ?? 0)} /> : null}
            </dl>
          </div>

          <div className="flex max-w-[520px] flex-wrap justify-end gap-2">
            <Button
              onClick={openPortal}
              disabled={busy !== null || !isSuper}
              className="bg-[#02422B] text-white hover:bg-[#02422B]/90"
            >
              {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              Open web portal as user
            </Button>
            <Button onClick={openApp} disabled={busy !== null || !isSuper} variant="outline" className="bg-white">
              {busy === "app" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              Open web app as user
            </Button>
            <Button onClick={() => setPwOpen(true)} disabled={busy !== null || !isSuper} variant="outline" className="bg-white">
              <KeyRound className="h-4 w-4" />
              Set password
            </Button>
            <Button onClick={sendReset} disabled={busy !== null || !isSuper} variant="outline" className="bg-white">
              {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send reset link
            </Button>
            {u.locked ? (
              <Button onClick={unlock} disabled={busy !== null || !isSuper} variant="outline" className="bg-white">
                {busy === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                Unlock
              </Button>
            ) : null}
            {u.type === "distributor" ? (
              <Button
                onClick={() => setDeleteOpen(true)}
                disabled={busy !== null || !isSuper}
                variant="outline"
                className="border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
              >
                <Trash2 className="h-4 w-4" />
                Delete distributor
              </Button>
            ) : null}
          </div>
        </div>
        {!isSuper ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Your staff access is read-only here. A super admin can manage passwords and open the portal as this user.
          </p>
        ) : null}
      </section>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          {u.type === "investor" || data.accounts.length > 0 ? (
            <Panel title="Accounts" description={`${fmtNum(data.accounts.length)} linked to this email`} bodyClassName="p-0">
              {data.accounts.length === 0 ? (
                <EmptyState title="No accounts" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Client code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Strategy</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead className="pr-5">Maturity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.accounts.map((a) => (
                      <TableRow key={String(a.clientId)}>
                        <TableCell className="pl-5 font-mono text-xs">{a.clientCode || "None"}</TableCell>
                        <TableCell>
                          <p className="text-sm text-[#002017]">{a.name}</p>
                          {a.headOfFamily ? (
                            <p className="text-xs text-muted-foreground">Head of family: {a.headOfFamily}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">{a.strategy || "Not set"}</TableCell>
                        <TableCell>
                          {a.status ? (
                            <Pill tone={/active/i.test(a.status) ? "green" : "grey"}>{a.status}</Pill>
                          ) : (
                            <span className="text-sm text-muted-foreground">Not set</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {a.groupId || "None"}
                          {a.ownerId ? <span className="block">Owner {a.ownerId}</span> : null}
                        </TableCell>
                        <TableCell className="pr-5 text-sm">{a.maturityDate ? fmtDate(a.maturityDate) : "None"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          ) : null}

          {u.type === "distributor" ? (
            <Panel
              title="Investors"
              description={`${fmtNum(data.investors?.length ?? 0)} under this distributor`}
              bodyClassName="p-0"
            >
              {!data.investors || data.investors.length === 0 ? (
                <EmptyState title="No investors linked yet" />
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">Investor</TableHead>
                        <TableHead className="pr-5">Client codes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.investors.map((inv) => (
                        <TableRow
                          key={inv.email || inv.name}
                          className={inv.email ? "cursor-pointer hover:bg-[#EFECD3]/50" : undefined}
                          onClick={() => inv.email && router.push(`/admin/users/${encodeURIComponent(inv.email)}`)}
                        >
                          <TableCell className="pl-5">
                            <p className="text-sm font-medium text-[#002017]">{inv.name || inv.email}</p>
                            <p className="text-xs text-muted-foreground">{inv.email || "No email"}</p>
                          </TableCell>
                          <TableCell className="pr-5 font-mono text-xs">{inv.clientCodes?.join(", ") || "None"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          ) : null}

          <Panel title="Backoffice activity" description="Actions admins have taken on this user" bodyClassName="p-0">
            {data.audit.length === 0 ? (
              <EmptyState title="No backoffice actions yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">When</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="pr-5">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.audit.map((a, i) => (
                    <TableRow key={`${a.at}-${i}`}>
                      <TableCell className="whitespace-nowrap pl-5">
                        <p className="text-sm text-[#002017]">{fmtRelative(a.at)}</p>
                        <p className="text-xs text-muted-foreground">{fmtDateTime(a.at)}</p>
                      </TableCell>
                      <TableCell className="text-sm">{a.admin}</TableCell>
                      <TableCell>
                        <span className="rounded bg-[#EFECD3] px-1.5 py-0.5 font-mono text-xs text-[#002017]">
                          {a.action}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate pr-5 text-xs text-muted-foreground">
                        {detailsText(a.details) || "None"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="App">
            {data.app ? (
              <dl className="space-y-3 text-sm">
                <Row label="Version" value={data.app.lastVersion || "Unknown"} />
                <Row label="Platform" value={data.app.platform ? capitalise(data.app.platform) : "Unknown"} />
                <Row
                  label="Last seen"
                  value={data.app.lastSeenAt ? `${fmtRelative(data.app.lastSeenAt)}` : "Never"}
                  sub={data.app.lastSeenAt ? fmtDateTime(data.app.lastSeenAt) : undefined}
                />
              </dl>
            ) : (
              <EmptyState
                icon={<Smartphone className="h-5 w-5" />}
                title="No app activity"
                description="This user has not used the mobile app yet."
                className="py-6"
              />
            )}
          </Panel>

          <Panel title="Login history" description="Latest 50 sign-ins" bodyClassName="p-0">
            {data.logins.length === 0 ? (
              <EmptyState title="No sign-ins yet" />
            ) : (
              <ul className="max-h-[520px] divide-y divide-[#02422B]/10 overflow-y-auto">
                {data.logins.map((l, i) => (
                  <li key={`${l.at}-${i}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div>
                      <p className="text-sm text-[#002017]">{fmtDateTime(l.at)}</p>
                      <p className="text-xs text-muted-foreground">{fmtRelative(l.at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.os ? <span className="text-xs capitalize text-muted-foreground">{l.os}</span> : null}
                      {l.platform === "app" ? <Pill tone="gold">App</Pill> : <Pill tone="green">Web</Pill>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <SetPasswordDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        title="Set password"
        description={`Sets a new password for ${u.email} on every account with this email and unlocks it.`}
        onSubmit={async (password) => {
          await boFetch("/api/admin/bo/users/password", { method: "POST", json: { email, password } })
          toast.success("Password updated")
          load()
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={(o) => busy !== "delete" && setDeleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this distributor?</AlertDialogTitle>
            <AlertDialogDescription>
              {u.name || u.email} will no longer be able to sign in. Investor accounts are not affected. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancel</AlertDialogCancel>
            <Button
              onClick={deleteDistributor}
              disabled={busy === "delete"}
              className="bg-red-700 text-white hover:bg-red-800"
            >
              {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete distributor
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-sm text-[#02422B] hover:underline">
      <ArrowLeft className="h-4 w-4" /> Back to users
    </Link>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs text-[#002017]" : "text-[#002017]"}>{value}</dd>
    </div>
  )
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-[#002017]">
        {value}
        {sub ? <span className="block text-xs text-muted-foreground">{sub}</span> : null}
      </dd>
    </div>
  )
}
