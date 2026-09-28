"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { KeyRound, ShieldCheck } from "lucide-react"
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
  passwordSet: boolean
  lastLoginAt: string | null
  app: boolean
}

export default function AdminAdminsPage() {
  const { admin: me } = useBackofficeAdmin()
  const [items, setItems] = useState<AdminRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminRow | null>(null)

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
        description="People who can sign in to this backoffice with an email and password."
      />

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="overflow-hidden rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#EFECD3]/60 hover:bg-[#EFECD3]/60">
              <TableHead className="pl-5">Admin</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>App access</TableHead>
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
                      {a.passwordSet ? <Pill tone="green">Password set</Pill> : <Pill tone="amber">Not set</Pill>}
                    </TableCell>
                    <TableCell>{a.app ? <Pill tone="gold">App admin</Pill> : <Pill tone="grey">Web only</Pill>}</TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!loading && items && items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No backoffice admins configured"
            description="Admins come from the BACKOFFICE_ADMINS setting on the server."
          />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        To add or remove an admin, update the BACKOFFICE_ADMINS list on the server. Changes here only set passwords.
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
