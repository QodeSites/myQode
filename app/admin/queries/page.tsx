"use client"

// Queries: every question and request from investors and partners — who sent it, how long it has waited, and
// everything needed to answer and close it. Tests (test builds, demo accounts, Qode staff sends) and automatic payment
// notices are kept out of the queue. API: /api/admin/bo/queries.
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Inbox, Mail, RefreshCw, Search, Send, StickyNote, UserCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { EmptyState, ErrorNote, KpiCard, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDateTime, fmtRelative, useBackofficeAdmin } from "@/components/admin-kit"

type Item = {
  id: string; type: string; typeLabel: string; kind: "query" | "payment"; who: "investor" | "partner" | "staff"; test: boolean; testReason: string | null
  state: "open" | "in_progress" | "resolved"; priority: string; subject: string; preview: string; name: string; email: string; code: string | null
  mobile: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null; assignedTo: string | null; replies: number; ageHours: number
}
type Counts = { open: number; inProgress: number; overdue: number; resolvedWeek: number; investors: number; partners: number; tests: number; payments: number; medianResolveHours: number | null }
type Detail = { item: Item; fields: Record<string, any>; replies: { message: string; sent_by: string; sent_at: string; cc?: string[]; to?: string[] }[]; notes: { id: number; admin_email: string; note_type: string; content: string; created_at: string }[] }

const WHO: Record<Item["who"], [string, "blue" | "gold" | "grey"]> = { investor: ["Investor", "blue"], partner: ["Partner", "gold"], staff: ["Qode staff", "grey"] }
const STATE: Record<Item["state"], [string, "red" | "amber" | "green"]> = { open: ["Open", "red"], in_progress: ["In progress", "amber"], resolved: ["Resolved", "green"] }
const PRIORITY_TONE: Record<string, "red" | "amber" | "grey"> = { urgent: "red", high: "amber", normal: "grey", low: "grey" }
const age = (h: number) => (h < 1 ? "just now" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`)
const human = (k: string) => k.replace(/^_+/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase())
const show = (v: any): string => v == null || v === "" ? "—" : typeof v === "object" ? (Array.isArray(v) ? v.map(show).join(", ") : Object.entries(v).map(([k, x]) => `${human(k)}: ${show(x)}`).join(" · ")) : String(v)

export default function AdminQueriesPage() {
  const [data, setData] = useState<{ items: Item[]; counts: Counts } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<"queries" | "payments" | "tests">("queries")
  const [who, setWho] = useState<"all" | Item["who"]>("all")
  const [status, setStatus] = useState<"active" | Item["state"] | "all">("active")
  const [type, setType] = useState("all")
  const [q, setQ] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null); setLoading(true)
    try { setData(await boFetch("/api/admin/bo/queries")) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const pool = useMemo(() => (data?.items || []).filter(x => tab === "tests" ? x.test : !x.test && x.kind === (tab === "payments" ? "payment" : "query")), [data, tab])
  const types = useMemo(() => [...new Map(pool.map(x => [x.type, x.typeLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [pool])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return pool.filter(x => (who === "all" || x.who === who) && (type === "all" || x.type === type)
      && (tab !== "queries" || status === "all" || (status === "active" ? x.state !== "resolved" : x.state === status))
      && (!s || [x.name, x.email, x.code, x.subject, x.preview].some(v => String(v || "").toLowerCase().includes(s))))
      .sort((a, b) => (tab === "queries" && status === "active" ? (b.ageHours - a.ageHours) : (Date.parse(b.createdAt) - Date.parse(a.createdAt))))
  }, [pool, who, type, status, q, tab])
  const c = data?.counts

  return (
    <div className="space-y-5">
      <PageHeader title="Queries" description="Questions and requests from investors and partners. Oldest waiting first; tests and payment notices are kept out of the queue."
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>} />
      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <button className="text-left" onClick={() => { setTab("queries"); setStatus("open") }}><KpiCard accent label="Open" value={c?.open ?? "–"} hint="Nobody has picked these up" icon={<Inbox className="h-4 w-4" />} /></button>
        <button className="text-left" onClick={() => { setTab("queries"); setStatus("in_progress") }}><KpiCard label="In progress" value={c?.inProgress ?? "–"} hint="Assigned to someone" icon={<UserCheck className="h-4 w-4" />} /></button>
        <button className="text-left" onClick={() => { setTab("queries"); setStatus("active") }}><KpiCard label="Waiting over 2 days" value={c?.overdue ?? "–"} hint="Not resolved after 48 hours" icon={<AlertTriangle className="h-4 w-4" />} /></button>
        <KpiCard label="Resolved this week" value={c?.resolvedWeek ?? "–"} icon={<CheckCircle2 className="h-4 w-4" />} />
        <KpiCard label="Typical time to resolve" value={c?.medianResolveHours == null ? "–" : age(c.medianResolveHours)} hint="Median, all resolved queries" icon={<Clock className="h-4 w-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([["queries", `Queries${c ? ` · ${c.open + c.inProgress} open` : ""}`], ["payments", `Payment notices${c ? ` · ${c.payments}` : ""}`], ["tests", `Tests (hidden)${c ? ` · ${c.tests}` : ""}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setType("all") }}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${tab === k ? "border-[#02422B] bg-[#02422B] text-white" : "border-[#02422B]/20 bg-white/70 hover:bg-[#EFECD3]"}`}>{l}</button>
        ))}
      </div>

      <Panel bodyClassName="p-0"
        title={tab === "queries" ? "Queue" : tab === "payments" ? "Payment notices" : "Tests"}
        description={tab === "payments" ? "Automatic notices when a payment or SIP goes through. For information; nothing to answer."
          : tab === "tests" ? "Kept out of the queue: test builds, demo accounts and sends from Qode staff addresses. Open one to mark it as a real query." : "Click a row to read, reply, assign or resolve."}
        action={<div className="flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, code, subject" className="h-8 w-56 bg-white pl-8" /></div>
          <select value={who} onChange={e => setWho(e.target.value as any)} className="h-8 rounded-md border bg-white px-2 text-sm" aria-label="From">
            <option value="all">Everyone</option><option value="investor">Investors{c ? ` (${c.investors} open)` : ""}</option><option value="partner">Partners{c ? ` (${c.partners} open)` : ""}</option><option value="staff">Qode staff</option></select>
          {tab === "queries" ? <select value={status} onChange={e => setStatus(e.target.value as any)} className="h-8 rounded-md border bg-white px-2 text-sm" aria-label="Status">
            <option value="active">Open + in progress</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="all">All</option></select> : null}
          <select value={type} onChange={e => setType(e.target.value)} className="h-8 rounded-md border bg-white px-2 text-sm" aria-label="Type">
            <option value="all">All types</option>{types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>}>
        {!data ? <p className="p-6 text-sm text-muted-foreground">{loading ? "Loading…" : ""}</p> : rows.length ? (
          <div className="max-h-[65vh] overflow-auto">
            <Table><TableHeader className="sticky top-0 z-10 bg-[#F7F4E6]"><TableRow>
              <TableHead>From</TableHead><TableHead>Type</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Waiting</TableHead><TableHead>With</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map(x => {
                const late = x.state !== "resolved" && x.ageHours > 48
                return (
                  <TableRow key={x.id} className="cursor-pointer" onClick={() => setOpenId(x.id)}>
                    <TableCell className="max-w-[230px]"><p className="truncate text-sm font-medium">{x.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Pill tone={WHO[x.who][1]}>{WHO[x.who][0]}</Pill><span className="truncate">{x.code || x.email}</span></p></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{x.typeLabel}{x.priority !== "normal" ? <> <Pill tone={PRIORITY_TONE[x.priority] || "grey"}>{x.priority}</Pill></> : null}</TableCell>
                    <TableCell className="max-w-[380px]"><p className="truncate text-sm">{x.subject || "—"}</p><p className="truncate text-xs text-muted-foreground">{tab === "tests" ? x.testReason : x.preview}</p></TableCell>
                    <TableCell><Pill tone={STATE[x.state][1]}>{STATE[x.state][0]}</Pill>{x.replies ? <span className="ml-1 text-[11px] text-muted-foreground">{x.replies} repl{x.replies === 1 ? "y" : "ies"}</span> : null}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right text-xs tabular-nums ${late ? "font-semibold text-red-700" : "text-muted-foreground"}`}>{x.state === "resolved" ? fmtRelative(x.createdAt) : age(x.ageHours)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{x.assignedTo ? x.assignedTo.split("@")[0] : "—"}</TableCell>
                  </TableRow>)
              })}</TableBody></Table>
          </div>
        ) : <EmptyState title={tab === "queries" && status === "active" ? "Nothing waiting" : "Nothing here"} description={tab === "queries" ? "Every query is answered. New ones appear here as they arrive." : "Change the filters to see more."} icon={<Inbox className="h-5 w-5" />} />}
      </Panel>

      <QueryPanel id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

function QueryPanel({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { admin } = useBackofficeAdmin()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState({ to: "", cc: "", message: "", resolve: true })
  const [noteText, setNoteText] = useState("")

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    try { const r = await boFetch<Detail>(`/api/admin/bo/queries?id=${encodeURIComponent(id)}`); setD(r); setReply(p => ({ ...p, to: r.item.email || "", message: "" })) }
    catch (e) { setErr(errorMessage(e)) }
  }, [id])
  useEffect(() => { setD(null); setNoteText(""); load() }, [load])

  async function act(action: string, body: Record<string, unknown> = {}, ok = "Saved") {
    if (!id) return
    setBusy(true)
    try { await boFetch("/api/admin/bo/queries", { method: "POST", json: { id, action, ...body } }); toast.success(ok); await load(); onChanged() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const x = d?.item
  const timeline = useMemo(() => d ? [
    ...d.replies.map(r => ({ at: r.sent_at, by: r.sent_by, kind: "reply" as const, text: r.message })),
    ...d.notes.filter(n => n.note_type !== "reply").map(n => ({ at: n.created_at, by: n.admin_email, kind: n.note_type === "note" ? "note" as const : "event" as const, text: n.content })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [], [d])

  return (
    <Sheet open={!!id} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!x ? <p className="p-6 text-sm text-muted-foreground">{err || "Loading…"}</p> : <>
          <SheetHeader>
            <SheetTitle className="pr-6">{x.subject || x.typeLabel}</SheetTitle>
            <SheetDescription asChild><div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={STATE[x.state][1]}>{STATE[x.state][0]}</Pill><Pill tone={WHO[x.who][1]}>{WHO[x.who][0]}</Pill><span>{x.typeLabel}</span>
              <span>· received {fmtDateTime(x.createdAt)}</span>{x.test ? <Pill tone="grey">Test: {x.testReason}</Pill> : null}
            </div></SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4 pb-8">
            <div className="rounded-lg border border-[#02422B]/15 bg-white p-3 text-sm">
              <p className="font-medium">{x.name}</p>
              <p className="text-xs text-muted-foreground">{[x.code, x.email, x.mobile].filter(Boolean).join(" · ")}</p>
              {x.email ? <a href={`/admin/users/${encodeURIComponent(x.email)}`} className="mt-1 inline-flex items-center gap-1 text-xs text-[#02422B] underline-offset-2 hover:underline">Open their profile<ExternalLink className="h-3 w-3" /></a> : null}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Their request</p>
              <dl className="divide-y rounded-lg border bg-white text-sm">
                {Object.entries(d!.fields).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[140px_1fr] gap-3 px-3 py-2"><dt className="text-xs text-muted-foreground">{human(k)}</dt><dd className="whitespace-pre-wrap break-words">{show(v)}</dd></div>
                ))}
              </dl>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation and activity</p>
              {timeline.length ? <ol className="space-y-2">{timeline.map((t, i) => (
                <li key={i} className={`rounded-lg border p-2.5 text-sm ${t.kind === "reply" ? "border-[#02422B]/25 bg-[#F2F7F3]" : t.kind === "note" ? "border-amber-200 bg-amber-50" : "bg-white"}`}>
                  <p className="text-[11px] text-muted-foreground">{t.kind === "reply" ? "Reply sent" : t.kind === "note" ? "Internal note" : "Update"} · {t.by?.split("@")[0] || "—"} · {fmtDateTime(t.at)}</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{t.text}</p>
                </li>))}</ol> : <p className="text-sm text-muted-foreground">No replies or notes yet.</p>}
            </div>

            {!x.test && x.kind === "query" ? (
              <div className="space-y-2 rounded-lg border border-[#02422B]/20 bg-[#F7F4E6] p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium"><Mail className="h-4 w-4" />Reply by email</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={reply.to} onChange={e => setReply({ ...reply, to: e.target.value })} placeholder="To" className="bg-white" />
                  <Input value={reply.cc} onChange={e => setReply({ ...reply, cc: e.target.value })} placeholder="Cc (optional, comma separated)" className="bg-white" />
                </div>
                <Textarea value={reply.message} onChange={e => setReply({ ...reply, message: e.target.value })} rows={5} placeholder={`Dear ${x.name.split(" ")[0] || "Sir/Madam"},\n\n…`} className="bg-white" />
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" disabled={busy || !reply.message.trim() || !reply.to.trim()}
                    onClick={() => act("reply", { to: reply.to.split(",").map(s => s.trim()), cc: reply.cc.split(",").map(s => s.trim()).filter(Boolean), message: reply.message, resolve: reply.resolve }, reply.resolve ? "Reply sent and query resolved" : "Reply sent")}>
                    <Send className="h-4 w-4" />Send from investor.relations@</Button>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={reply.resolve} onChange={e => setReply({ ...reply, resolve: e.target.checked })} className="accent-[#02422B]" />Mark resolved after sending</label>
                </div>
              </div>) : null}

            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><StickyNote className="h-4 w-4" />Internal note <span className="text-xs font-normal text-muted-foreground">(only the team sees it)</span></p>
              <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} className="bg-white" placeholder="e.g. Called the client; documents coming on Monday" />
              <Button size="sm" variant="outline" disabled={busy || !noteText.trim()} onClick={async () => { await act("note", { text: noteText }, "Note added"); setNoteText("") }}>Add note</Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              {x.state !== "resolved" ? <>
                {x.assignedTo !== admin?.email ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act("assign", {}, "Assigned to you")}><UserCheck className="h-4 w-4" />Assign to me</Button>
                  : <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("assign", { email: null }, "Unassigned")}>Unassign</Button>}
                <Button size="sm" disabled={busy} onClick={() => act("resolve", {}, "Resolved")}><CheckCircle2 className="h-4 w-4" />Resolve without reply</Button>
              </> : <Button size="sm" variant="outline" disabled={busy} onClick={() => act("reopen", {}, "Reopened")}>Reopen</Button>}
              <select value={x.priority} disabled={busy} onChange={e => act("priority", { priority: e.target.value }, "Priority changed")} className="h-8 rounded-md border bg-white px-2 text-sm" aria-label="Priority">
                {["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)} priority</option>)}</select>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("markTest", { test: !x.test }, x.test ? "Moved to the queue" : "Moved to tests")}>{x.test ? "Not a test: move to the queue" : "This is a test"}</Button>
            </div>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  )
}
