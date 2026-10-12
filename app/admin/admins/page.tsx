"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { KeyRound, ShieldCheck, UserMinus, UserPlus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  Pill,
  SetPasswordDialog,
  boFetch,
  errorMessage,
  fmtDateTime,
  fmtRelative,
  useBackofficeAdmin,
} from "@/components/admin-kit"

interface AdminRow {
  email: string
  name: string | null
  role: Role
  passwordSet: boolean
  lastLoginAt: string | null
  app: boolean
}
type Role = "super" | "investors" | "partners" | "viewer"
// The one place admin access is decided (web /admin and the app's admin mode both read it).
const ROLES: { role: Role; label: string; what: string; tone: "green" | "gold" | "amber" | "grey" }[] = [
  { role: "super", label: "Super admin", what: "Everything: every investor and partner, settings, admins", tone: "green" },
  { role: "investors", label: "Investors admin", what: "All investors: open their dashboard, documents, payments, passwords", tone: "gold" },
  { role: "partners", label: "Partners admin", what: "All partners: open their portal, invoices, passwords", tone: "gold" },
  { role: "viewer", label: "Read-only", what: "Can look, cannot change anything or open accounts", tone: "grey" },
]
const roleInfo = (r: Role) => ROLES.find((x) => x.role === r) || ROLES[3]

export default function AdminAdminsPage() {
  const { admin: me } = useBackofficeAdmin()
  const [items, setItems] = useState<AdminRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState("")
  const [newRole, setNewRole] = useState<Role>("investors")

  const saveRole = async (email: string, role: Role, name?: string) => {
    setBusy(email)
    try {
      await boFetch("/api/admin/bo/admins", { method: "PUT", json: { email, role, name } })
      toast.success(`${email} is now ${roleInfo(role).label.toLowerCase()}`)
      await load()
      return true
    } catch (e) { toast.error(errorMessage(e)); return false } finally { setBusy(null) }
  }
  const remove = async (a: AdminRow) => {
    setBusy(a.email)
    try {
      await boFetch(`/api/admin/bo/admins?email=${encodeURIComponent(a.email)}`, { method: "DELETE" })
      toast.success(`Removed admin access for ${a.email}`)
      await load()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await boFetch<{ items: AdminRow[] }>("/api/admin/bo/admins")
      setItems(res.items)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const canEdit = me?.level === "super"

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admins"
        description="Who can use the admin side, on the web and in the app, and what each role allows. This list is the only place it is set."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r.role} className="rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] p-4">
            <Pill tone={r.tone}>{r.label}</Pill>
            <p className="mt-2 text-xs text-muted-foreground">{r.what}</p>
            <p className="mt-2 text-sm font-medium text-[#002017]">{(items || []).filter((a) => a.role === r.role).length} people</p>
          </div>
        ))}
      </div>

      {canEdit ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] p-4"
          onSubmit={async (e) => { e.preventDefault(); if (await saveRole(newEmail.trim().toLowerCase(), newRole)) setNewEmail("") }}
        >
          <label htmlFor="new-admin" className="text-sm font-medium text-[#002017]">Add an admin</label>
          <Input id="new-admin" type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@qodeinvest.com" className="h-9 w-64 bg-white" />
          <select aria-label="Role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className="h-9 rounded-md border bg-white px-2 text-sm">
            {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
          <Button type="submit" size="sm" disabled={!newEmail.trim() || busy !== null}><UserPlus className="h-4 w-4" />Add</Button>
          <span className="text-xs text-muted-foreground">They sign in with Microsoft, or with a password you set below.</span>
        </form>
      ) : null}

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="overflow-hidden rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#EFECD3]/60 hover:bg-[#EFECD3]/60">
              <TableHead className="pl-5">Admin</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="pr-5 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items
              ? Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j} className={j === 0 ? "pl-5" : undefined}>
                        <Skeleton className="h-4 w-full max-w-[180px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items?.map((a) => (
                  <TableRow key={a.email}>
                    <TableCell className="pl-5">
                      <p className="font-medium text-[#002017]">
                        {a.name || a.email}
                        {me && me.email.toLowerCase() === a.email.toLowerCase() ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{a.email}</p>
                    </TableCell>
                    <TableCell>
                      {canEdit && !(me && me.email.toLowerCase() === a.email.toLowerCase()) ? (
                        <select aria-label={`Role for ${a.email}`} value={a.role} disabled={busy !== null}
                          onChange={(e) => saveRole(a.email, e.target.value as Role)} className="h-8 rounded-md border bg-white px-2 text-sm">
                          {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                        </select>
                      ) : <Pill tone={roleInfo(a.role).tone}>{roleInfo(a.role).label}</Pill>}
                    </TableCell>
                    <TableCell>
                      {a.passwordSet ? <Pill tone="green">Password set</Pill> : <Pill tone="amber">Microsoft only</Pill>}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-[#002017]">{fmtRelative(a.lastLoginAt)}</p>
                      {a.lastLoginAt ? <p className="text-xs text-muted-foreground">{fmtDateTime(a.lastLoginAt)}</p> : null}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        disabled={!canEdit}
                        onClick={() => setTarget(a)}
                      >
                        <KeyRound className="h-4 w-4" />
                        Set password
                      </Button>
                      {canEdit && !(me && me.email.toLowerCase() === a.email.toLowerCase()) ? (
                        <Button variant="ghost" size="sm" className="ml-1" disabled={busy !== null} onClick={() => remove(a)} aria-label={`Remove ${a.email}`}>
                          <UserMinus className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!loading && items && items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No admins yet"
            description="Add the first admin above."
          />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        A change applies within 30 seconds, on the web and in the app. Every change is in the audit log. You cannot change or remove your own role.
      </p>

      <SetPasswordDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Set admin password"
        description={target ? `New backoffice password for ${target.email}.` : undefined}
        onSubmit={async (password) => {
          if (!target) return
          await boFetch("/api/admin/bo/admins/password", { method: "POST", json: { email: target.email, password } })
          toast.success(`Password set for ${target.email}`)
          load()
        }}
      />
    </div>
  )
}
