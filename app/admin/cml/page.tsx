"use client"

// Admin → CML: each client's Client Master List in Qode's format (lib/cml.ts), grouped by family group. A client's
// CML opens as a printable page (Save as PDF); "Download group" puts every member of the group in one document.
// Super and investors admins only (PAN, bank account, date of birth); every download is in the audit log.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, FileText, RefreshCw, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorNote, KpiCard, PageHeader, Pill, boFetch, errorMessage, fmtDate, fmtNum } from "@/components/admin-kit"

type Code = { code: string; strategy: string; closed: boolean }
type Client = { clientId: string; name: string; codes: Code[]; closed: boolean; cml: { uploadedAt: string | null } | null }
type Group = { groupId: string; groupName: string; clients: Client[] }
type Data = { groups: Group[]; counts: { groups: number; clients: number; withCml: number; missing: number } }

const open = (qs: string) => window.open(`/api/admin/bo/cml?${qs}`, "_blank", "noopener")

export default function CmlPage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [onlyMissing, setOnlyMissing] = useState(false)

  const load = useCallback(async () => {
    setErr("")
    try { setData(await boFetch<Data>("/api/admin/bo/cml")) } catch (e) { setErr(errorMessage(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.groups || [])
      .map(g => ({ ...g, clients: g.clients.filter(c => !onlyMissing || (!c.cml && !c.closed)) }))
      .filter(g => g.clients.length)
      .filter(g => !s || g.groupName.toLowerCase().includes(s) || g.clients.some(c =>
        c.name.toLowerCase().includes(s) || c.clientId.includes(s) || c.codes.some(x => x.code.toLowerCase().includes(s))))
  }, [data, q, onlyMissing])

  const c = data?.counts
  return (
    <div className="space-y-6">
      <PageHeader
        title="CML"
        description="Each client's Client Master List in Qode's format, read from the CML the depository participant issued (Client Document Vault). Opens ready to save as PDF."
        actions={<Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>}
      />
      {err && <ErrorNote message={err} onRetry={load} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Family groups" value={c ? fmtNum(c.groups) : "…"} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Clients" value={c ? fmtNum(c.clients) : "…"} />
        <KpiCard label="CML on file" value={c ? fmtNum(c.withCml) : "…"} icon={<FileText className="h-4 w-4" />} />
        <button className="text-left" onClick={() => setOnlyMissing(v => !v)}>
          <KpiCard label="Missing (open accounts)" value={c ? fmtNum(c.missing) : "…"} hint={onlyMissing ? "Showing only these (click to show all)" : "Click to show only these"} />
        </button>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search group, client, client ID or code" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {!data && !err ? <Skeleton className="h-64 w-full" />
        : !groups.length ? <EmptyState title="Nothing matches" description="Try another name, client ID or code." />
        : groups.map(g => {
          const withCml = g.clients.filter(x => x.cml).length
          return (
            <div key={g.groupId} className="rounded-lg border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[#F7F5E9] px-4 py-2.5">
                <div>
                  <div className="font-semibold text-[#02422B]">{g.groupName}</div>
                  <div className="text-xs text-muted-foreground">{g.clients.length} client{g.clients.length === 1 ? "" : "s"} · {withCml} CML on file</div>
                </div>
                <Button size="sm" variant="outline" disabled={!withCml} onClick={() => open("group=" + encodeURIComponent(g.groupId))}>
                  <Download className="mr-1 h-4 w-4" />Download group
                </Button>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Client</TableHead><TableHead>Client ID</TableHead><TableHead>Accounts</TableHead><TableHead>CML</TableHead><TableHead className="text-right" />
                </TableRow></TableHeader>
                <TableBody>
                  {g.clients.map(x => (
                    <TableRow key={x.clientId}>
                      <TableCell className="font-medium">{x.name}</TableCell>
                      <TableCell className="tabular-nums">{x.clientId}</TableCell>
                      <TableCell className="text-sm">{x.codes.map(k => <span key={k.code} className={k.closed ? "mr-2 text-muted-foreground line-through" : "mr-2"}>{k.code}</span>)}</TableCell>
                      <TableCell>{x.cml ? <Pill tone="green">On file{x.cml.uploadedAt ? " · " + fmtDate(x.cml.uploadedAt) : ""}</Pill> : <Pill tone={x.closed ? "grey" : "amber"}>{x.closed ? "Closed · none" : "Missing"}</Pill>}</TableCell>
                      <TableCell className="text-right">
                        {x.cml && <Button size="sm" onClick={() => open("client=" + encodeURIComponent(x.clientId))}><Download className="mr-1 h-4 w-4" />PDF</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        })}
    </div>
  )
}
