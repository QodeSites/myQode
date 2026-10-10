"use client"

// Documents: which clients' Client Document Vault (web Trust → Client document vault, app Documents tab) has
// documents, and uploading the missing ones — one client at a time or in bulk. API: /api/admin/bo/documents.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, FileText, FolderUp, RefreshCw, Search, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EmptyState, ErrorNote, KpiCard, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDateTime, useBackofficeAdmin } from "@/components/admin-kit"

type Code = { code: string; strategy: string; closed: boolean }
type Folder = { clientId: string; codes: Code[]; closed: boolean; counts: Record<string, number> }
// One client = all their strategy accounts (grouped by PAN on the server); each account has its own vault folder.
type Client = { clientId: string; clientIds: string[]; name: string; email: string; codes: Code[]; folders: Folder[]; closed: boolean; counts: Record<string, number>; total: number; missingIn: string[]; status: "complete" | "partial" | "none" }
type VaultFile = { key: string; clientId: string; section: string; filename: string; size: number; lastModified: string | null; url: string }
// The same document in several account folders, shown once.
type Doc = { section: string; filename: string; size: number; lastModified: string | null; url: string; keys: string[]; clientIds: string[] }
type Planned = { id: string; file: File; path: string; client: Client | null; section: string; state: "ready" | "uploading" | "done" | "exists" | "error" | "skip"; note?: string }

const STATUS: Record<Client["status"], [string, "green" | "gold" | "red"]> = { complete: ["Complete", "green"], partial: ["Missing some", "gold"], none: ["No documents", "red"] }
const OK_EXT = /\.(pdf|jpe?g|png)$/i
const kb = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
const CODE_RE = /\bQ[A-Z]{2}\d{3,6}\b/i

// Section from a folder name or the file name; null when nothing matches.
function guessSection(text: string, sections: string[]): string | null {
  const t = text.toLowerCase()
  const exact = sections.find(s => t.split("/").some(p => p.trim().toLowerCase() === s.toLowerCase()))
  if (exact) return exact
  if (/agreement/.test(t)) return "PMS Agreement"
  if (/account.?opening|\baof\b|kyc/.test(t)) return "Account Opening Documents"
  if (/\bcml\b|client.?master/.test(t)) return "CML"
  if (/disclosure/.test(t)) return "Disclosures"
  return null
}

// Uploads one file into every account folder of the client.
async function uploadOne(clientIds: string[], section: string, file: File, overwrite: boolean) {
  const fd = new FormData()
  for (const id of clientIds) fd.append("clientId", id)
  fd.append("section", section); fd.append("file", file)
  if (overwrite) fd.append("overwrite", "1")
  const r = await fetch("/api/admin/bo/documents", { method: "POST", body: fd, credentials: "same-origin" })
  const j = await r.json().catch(() => ({}))
  if (r.status === 409) return { exists: true as const }
  if (r.status === 413) throw new Error("File too large for the server")
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return { exists: false as const, partly: (j?.existed?.length || 0) > 0 }
}

export default function AdminDocumentsPage() {
  const { admin } = useBackofficeAdmin()
  const canEdit = admin?.level === "super"   // uploads and removals need backoffice (super) access; staff can look
  const [data, setData] = useState<{ sections: string[]; required: string[]; clients: Client[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<"all" | Client["status"]>("all")
  const [showClosed, setShowClosed] = useState(false)
  const [open, setOpen] = useState<Client | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null); setLoading(true)
    try { setData(await boFetch("/api/admin/bo/documents")) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const pool = useMemo(() => (data?.clients || []).filter(c => showClosed || !c.closed), [data, showClosed])
  const kpi = useMemo(() => ({ complete: pool.filter(c => c.status === "complete").length, partial: pool.filter(c => c.status === "partial").length, none: pool.filter(c => c.status === "none").length }), [pool])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return pool.filter(c => (filter === "all" || c.status === filter) &&
      (!s || c.name?.toLowerCase().includes(s) || c.email?.includes(s) || c.clientIds.some(id => id.includes(s)) || c.codes.some(x => x.code.toLowerCase().includes(s))))
  }, [pool, filter, q])

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description="Which clients can see their documents in the Client Document Vault (web and app), and uploading the missing ones."
        actions={<div className="flex gap-2">
          {canEdit ? <Button size="sm" onClick={() => setBulkOpen(true)} disabled={!data}><FolderUp className="h-4 w-4" />Bulk upload</Button> : null}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>} />
      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <button className="text-left" onClick={() => setFilter("complete")}><KpiCard label="All documents" value={kpi.complete} hint={`${(data?.required || []).join(", ")}`} icon={<CheckCircle2 className="h-4 w-4" />} /></button>
        <button className="text-left" onClick={() => setFilter("partial")}><KpiCard label="Missing some" value={kpi.partial} hint="At least one required section empty" /></button>
        <button className="text-left" onClick={() => setFilter("none")}><KpiCard label="No documents" value={kpi.none} hint="The vault shows nothing" accent /></button>
      </div>

      <Panel title={`Clients (${rows.length})`} description="One row per client, with all their strategy accounts. Uploads go into every account, so the client sees them under each strategy. Counts are files per section." bodyClassName="p-0"
        action={<div className="flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, account code" className="h-8 w-56 bg-white pl-8" /></div>
          <select value={filter} onChange={e => setFilter(e.target.value as any)} className="h-8 rounded-md border bg-white px-2 text-sm">
            <option value="all">All</option><option value="complete">All documents</option><option value="partial">Missing some</option><option value="none">No documents</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="accent-[#02422B]" />Closed accounts</label>
        </div>}>
        {!data ? <p className="p-6 text-sm text-muted-foreground">{loading ? "Reading the document store…" : ""}</p> : rows.length ? (
          <div className="max-h-[65vh] overflow-auto">
            <Table><TableHeader className="sticky top-0 z-10 bg-[#F7F4E6]"><TableRow>
              <TableHead>Client</TableHead><TableHead>Accounts</TableHead>
              {data.sections.map(s => <TableHead key={s} className="text-center text-xs">{s}{data.required.includes(s) ? "" : " (app)"}</TableHead>)}
              <TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{rows.map(c => (
                <TableRow key={c.clientId}>
                  <TableCell><p className="text-sm font-medium">{c.name || "—"}</p><p className="text-xs text-muted-foreground">{c.email || "no email"} · id {c.clientIds.join(", ")}</p></TableCell>
                  <TableCell className="text-xs">{c.codes.map(x => <span key={x.code} className={`mr-1.5 inline-block ${x.closed ? "text-muted-foreground line-through" : ""}`}>{x.code}</span>)}</TableCell>
                  {data.sections.map(s => <TableCell key={s} className="text-center text-sm tabular-nums">{c.counts[s] ? <span className="text-[#02422B]">✓ {c.counts[s]}</span> : <span className="text-muted-foreground">—</span>}</TableCell>)}
                  <TableCell><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill>{c.status === "partial" && c.missingIn.length && c.missingIn.length < c.codes.length ? <span className="mt-1 block text-[11px] text-muted-foreground">Missing in {c.missingIn.join(", ")}</span> : null}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(c)}>{canEdit ? "Files / upload" : "Files"}</Button></TableCell>
                </TableRow>))}
              </TableBody></Table>
          </div>
        ) : <EmptyState title="No clients match" description="Change the filter or search." icon={<FileText className="h-5 w-5" />} />}
      </Panel>

      {open && data ? <ClientDialog client={open} sections={data.sections} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={load} /> : null}
      {bulkOpen && data ? <BulkDialog clients={data.clients} sections={data.sections} onClose={() => setBulkOpen(false)} onDone={load} /> : null}
    </div>
  )
}

function ClientDialog({ client, sections, canEdit, onClose, onChanged }: { client: Client; sections: string[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [files, setFiles] = useState<VaultFile[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [section, setSection] = useState(sections[0])
  const [picked, setPicked] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [remove, setRemove] = useState<Doc | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setErr(null)
    try { setFiles((await boFetch<{ files: VaultFile[] }>(`/api/admin/bo/documents?${client.clientIds.map(id => `clientId=${encodeURIComponent(id)}`).join("&")}`)).files) } catch (e) { setErr(errorMessage(e)) }
  }, [client.clientIds.join(",")])   // eslint-disable-line react-hooks/exhaustive-deps
  const codesOf = useMemo(() => new Map(client.folders.map(f => [f.clientId, f.codes.map(c => c.code).join(", ")])), [client])
  const docs = useMemo(() => {
    const m = new Map<string, Doc>()
    for (const f of files || []) {
      const k = f.section + "/" + f.filename
      const d = m.get(k) || { section: f.section, filename: f.filename, size: f.size, lastModified: f.lastModified, url: f.url, keys: [], clientIds: [] }
      d.keys.push(f.key); d.clientIds.push(f.clientId); m.set(k, d)
    }
    return [...m.values()]
  }, [files])
  useEffect(() => { load() }, [load])

  async function upload() {
    setBusy(true); let ok = 0, exists = 0, failed = 0
    for (const f of picked) {
      try { const r = await uploadOne(client.clientIds, section, f, overwrite); r.exists ? exists++ : ok++ } catch (e) { failed++; toast.error(`${f.name}: ${errorMessage(e)}`) }
    }
    setBusy(false); setPicked([]); if (input.current) input.current.value = ""
    toast[failed ? "error" : "success"](`${ok} uploaded${exists ? `, ${exists} skipped (already there; tick "replace" to overwrite)` : ""}${failed ? `, ${failed} failed` : ""}.`)
    load(); onChanged()
  }

  async function doRemove() {
    if (!remove) return
    try { for (const key of remove.keys) await boFetch(`/api/admin/bo/documents?key=${encodeURIComponent(key)}`, { method: "DELETE" }); toast.success(`Removed from ${remove.keys.length === 1 ? "the vault" : `all ${remove.keys.length} accounts`} (kept in the removed-files area).`); load(); onChanged() }
    catch (e) { toast.error(errorMessage(e)) } finally { setRemove(null) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{client.name}</DialogTitle>
          <DialogDescription>{client.codes.map(c => `${c.code} (${c.strategy})`).join(", ")}{client.folders.length > 1 ? ` · uploads go into all ${client.folders.length} accounts` : ` · folder id ${client.clientId}`}</DialogDescription>
        </DialogHeader>
        {err ? <ErrorNote message={err} onRetry={load} /> : null}
        <div className="max-h-72 overflow-auto rounded-md border">
          {!files ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : docs.length ? (
            <Table><TableBody>{docs.map(f => (
              <TableRow key={f.section + "/" + f.filename}>
                <TableCell className="text-xs text-muted-foreground">{f.section}</TableCell>
                <TableCell><a href={f.url} target="_blank" rel="noreferrer" className="text-sm text-[#02422B] underline-offset-2 hover:underline">{f.filename}</a>
                  {client.folders.length > 1 ? <span className={`block text-[11px] ${f.clientIds.length < client.folders.length ? "text-amber-700" : "text-muted-foreground"}`}>
                    {f.clientIds.length < client.folders.length ? `Only in ${f.clientIds.map(id => codesOf.get(id)).join(", ")}` : "In all accounts"}</span> : null}</TableCell>
                <TableCell className="text-xs tabular-nums">{kb(f.size)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{f.lastModified ? fmtDateTime(f.lastModified) : ""}</TableCell>
                <TableCell>{canEdit ? <Button size="sm" variant="ghost" className="h-7" onClick={() => setRemove(f)} aria-label={`Remove ${f.filename}`}><Trash2 className="h-3.5 w-3.5" /></Button> : null}</TableCell>
              </TableRow>))}</TableBody></Table>
          ) : <p className="p-4 text-sm text-muted-foreground">No documents yet: the client's vault is empty.</p>}
        </div>
        {canEdit ? (
          <div className="space-y-3 rounded-md border border-[#02422B]/15 bg-[#F7F4E6] p-3">
            <p className="text-sm font-medium">Upload</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={section} onChange={e => setSection(e.target.value)} className="h-9 rounded-md border bg-white px-2 text-sm">{sections.map(s => <option key={s}>{s}</option>)}</select>
              <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => setPicked(Array.from(e.target.files || []))} className="text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-[#02422B]" />Replace a file that has the same name</label>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={upload} disabled={!picked.length || busy}><Upload className="h-4 w-4" />{busy ? "Uploading…" : `Upload ${picked.length || ""} to ${section}`}</Button>
              <span className="text-xs text-muted-foreground">PDF, JPG or PNG, up to 25 MB each. The client sees it in the vault straight away.</span>
            </div>
          </div>
        ) : null}
        <AlertDialog open={!!remove} onOpenChange={o => { if (!o) setRemove(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Remove this document?</AlertDialogTitle>
              <AlertDialogDescription>{remove ? `“${remove.filename}” (${remove.section}) disappears from ${client.name}'s vault${remove.keys.length > 1 ? ` in all ${remove.keys.length} accounts` : ""}. A copy is kept in the removed-files area and the action is in the audit log.` : ""}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={doRemove}>Remove</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

function BulkDialog({ clients, sections, onClose, onDone }: { clients: Client[]; sections: string[]; onClose: () => void; onDone: () => void }) {
  const [defSection, setDefSection] = useState("")
  const [plan, setPlan] = useState<Planned[]>([])
  const [running, setRunning] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const byCode = useMemo(() => { const m = new Map<string, Client>(); for (const c of clients) for (const x of c.codes) m.set(x.code.toUpperCase(), c); return m }, [clients])
  const byId = useMemo(() => { const m = new Map<string, Client>(); for (const c of clients) for (const id of c.clientIds) m.set(id, c); return m }, [clients])

  function add(list: FileList | null) {
    const next: Planned[] = []
    for (const file of Array.from(list || [])) {
      const path = (file as any).webkitRelativePath || file.name
      if (!OK_EXT.test(file.name)) { next.push({ id: path + file.size, file, path, client: null, section: "", state: "skip", note: "Not a PDF/JPG/PNG" }); continue }
      const code = path.match(CODE_RE)?.[0]?.toUpperCase()
      const idPart = path.split("/").map((p: string) => p.replace(/\.0+$/, "")).find((p: string) => byId.has(p))
      const client = (code && byCode.get(code)) || (idPart ? byId.get(idPart)! : null)
      const section = guessSection(path, sections) || defSection
      next.push({ id: path + file.size, file, path, client, section, state: client && section ? "ready" : "skip",
        note: !client ? "No account code (e.g. QAW00162) or client id in the name or folder" : !section ? "Choose a section" : undefined })
    }
    setPlan(p => { const seen = new Set(p.map(x => x.id)); return [...p, ...next.filter(x => !seen.has(x.id))] })
  }
  const setRow = (id: string, patch: Partial<Planned>) => setPlan(p => p.map(x => {
    if (x.id !== id) return x
    const y = { ...x, ...patch }
    if (y.state === "ready" || y.state === "skip") { y.state = y.client && y.section && OK_EXT.test(y.file.name) ? "ready" : "skip"; y.note = !y.client ? x.note : !y.section ? "Choose a section" : undefined }
    return y
  }))
  useEffect(() => { if (defSection) setPlan(p => p.map(x => (x.state === "skip" && x.client && !x.section ? { ...x, section: defSection, state: "ready", note: undefined } : x))) }, [defSection])

  const ready = plan.filter(x => x.state === "ready")
  const finished = plan.filter(x => ["done", "exists", "error"].includes(x.state)).length
  const total = plan.filter(x => x.state !== "skip").length

  async function run() {
    setRunning(true)
    const queue = plan.filter(x => x.state === "ready")
    let i = 0
    const worker = async () => {
      while (i < queue.length) {
        const item = queue[i++]
        setRow(item.id, { state: "uploading" })
        try { const r = await uploadOne(item.client!.clientIds, item.section, item.file, overwrite)
          setPlan(p => p.map(x => x.id === item.id ? { ...x, state: r.exists ? "exists" : "done", note: r.exists ? "Already there (not replaced)" : undefined } : x))
        } catch (e) { setPlan(p => p.map(x => x.id === item.id ? { ...x, state: "error", note: errorMessage(e) } : x)) }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setRunning(false); onDone()
    toast.success("Bulk upload finished. Check the table for anything skipped or failed.")
  }

  const tone = (s: Planned["state"]) => s === "done" ? "green" : s === "error" ? "red" : s === "exists" || s === "skip" ? "gold" : "grey"
  const label: Record<Planned["state"], string> = { ready: "Ready", uploading: "Uploading…", done: "Uploaded", exists: "Already there", error: "Failed", skip: "Won't upload" }

  return (
    <Dialog open onOpenChange={o => { if (!o && !running) onClose() }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Bulk upload to client vaults</DialogTitle>
          <DialogDescription>
            Each file goes into every account of its client. It needs one of the client's account codes in its name or folder (e.g. <code>QAW00162_PMS Agreement.pdf</code>, or a folder
            <code> QAW00162/CML/…</code>). The section comes from the folder or file name (agreement, account opening/AOF/KYC, CML, disclosure), or the default below.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#02422B]/15 bg-[#F7F4E6] p-3 text-sm">
          <label className="flex items-center gap-2">Default section
            <select value={defSection} onChange={e => setDefSection(e.target.value)} className="h-8 rounded-md border bg-white px-2 text-sm">
              <option value="">(from the name)</option>{sections.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="cursor-pointer rounded-md border bg-white px-3 py-1.5 hover:bg-[#EFECD3]"><Upload className="mr-1 inline h-4 w-4" />Add files
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { add(e.target.files); e.target.value = "" }} disabled={running} /></label>
          <label className="cursor-pointer rounded-md border bg-white px-3 py-1.5 hover:bg-[#EFECD3]"><FolderUp className="mr-1 inline h-4 w-4" />Add a folder
            <input type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as any)} onChange={e => { add(e.target.files); e.target.value = "" }} disabled={running} /></label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-[#02422B]" />Replace files with the same name</label>
          {plan.length ? <Button size="sm" variant="ghost" onClick={() => setPlan([])} disabled={running}><X className="h-4 w-4" />Clear</Button> : null}
        </div>
        {plan.length ? (
          <>
            {running || finished ? <div className="space-y-1"><Progress value={total ? (finished / total) * 100 : 0} /><p className="text-xs text-muted-foreground">{finished} of {total} done</p></div> : null}
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table><TableHeader className="sticky top-0 z-10 bg-[#F7F4E6]"><TableRow><TableHead>File</TableHead><TableHead>Client</TableHead><TableHead>Section</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>{plan.map(x => (
                  <TableRow key={x.id}>
                    <TableCell className="max-w-[260px] truncate text-xs" title={x.path}>{x.path}<span className="block text-muted-foreground">{kb(x.file.size)}</span></TableCell>
                    <TableCell className="text-xs">{x.client ? <>{x.client.name}<span className="block text-muted-foreground">{x.client.codes.map(c => c.code).join(", ")}{x.client.folders.length > 1 ? ` · into all ${x.client.folders.length} accounts` : ""}</span></> : <span className="text-red-700">Not matched</span>}</TableCell>
                    <TableCell><select value={x.section} disabled={running || !["ready", "skip"].includes(x.state)} onChange={e => setRow(x.id, { section: e.target.value })} className="h-7 rounded border bg-white px-1 text-xs">
                      <option value="">—</option>{sections.map(s => <option key={s}>{s}</option>)}</select></TableCell>
                    <TableCell><Pill tone={tone(x.state)}>{label[x.state]}</Pill>{x.note ? <span className="block text-[11px] text-muted-foreground">{x.note}</span> : null}</TableCell>
                    <TableCell>{!running && ["ready", "skip"].includes(x.state) ? <Button size="sm" variant="ghost" className="h-7" onClick={() => setPlan(p => p.filter(y => y.id !== x.id))} aria-label="Drop this file"><X className="h-3.5 w-3.5" /></Button> : null}</TableCell>
                  </TableRow>))}</TableBody></Table>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={run} disabled={!ready.length || running}><Upload className="h-4 w-4" />{running ? "Uploading…" : `Upload ${ready.length} file${ready.length === 1 ? "" : "s"}`}</Button>
              <span className="text-xs text-muted-foreground">{plan.filter(x => x.state === "skip").length} won't be uploaded (see the reason in each row).</span>
            </div>
          </>
        ) : <EmptyState title="Add files or a folder" description="Nothing is uploaded until you check the table and press Upload." icon={<FolderUp className="h-5 w-5" />} />}
      </DialogContent>
    </Dialog>
  )
}
