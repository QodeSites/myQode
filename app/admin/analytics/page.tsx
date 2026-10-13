"use client"

// App analytics, in plain words: where every client stands (no password → website only → has the app → using it),
// who used myQode each day, what they look at, and which notifications reach them. One row per client; a row opens
// that client's activity log. Data: GET /api/admin/bo/analytics/clients.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Bell, BellOff, Download, ExternalLink, Eye, KeyRound, LogIn, RefreshCw, Search, Smartphone, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorNote, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDate, fmtNum, fmtRelative, fmtShortDay } from "@/components/admin-kit"
import { cn } from "@/lib/utils"

type Status = "no_password" | "never_signed_in" | "website_only" | "old_app" | "app_not_used" | "using_app"
type Client = {
  email: string; name: string; accounts: string[]; status: Status; passwordSet: boolean; passwordSetAt: string | null; signedIn: boolean
  hasApp: boolean; devices: string[]; appVersion: string | null; appSince: string | null; lastUsed: string | null; lastUsedApp: string | null
  daysUsed: number; opens: number; usedToday: boolean; used7: boolean; topPages: string[]; notificationsOn: boolean
  notesSent: number; notesOnPhone: number; notesRead: number; locked: boolean
}
type Note = { key: string; kind: string; title: string; sent: number; clients: number; reachedPhone: number; inboxOnly: number; read: number }
type Data = {
  days: number; from: string; to: string; generatedAt: string
  summary: Record<string, number>
  daily: { date: string; app: number; website: number }[]
  clients: Client[]
  pages: { page: string; clients: number; views: number }[]
  notifications: Note[]
}
type LogRow = { at: string; kind: "opened" | "did" | "signin" | "problem" | "notification"; text: string; detail: string }

// The four places a client can be, in the order to chase them
const STATUS: Record<Status, { label: string; tone: "red" | "amber" | "gold" | "green" | "grey"; color: string; meaning: string; action: string }> = {
  no_password: { label: "No password yet", tone: "red", color: "#b42318", meaning: "They have never set a password, so they cannot sign in anywhere.", action: "Send them the password setup link." },
  never_signed_in: { label: "Password set, never signed in", tone: "amber", color: "#d97706", meaning: "They set a password but never signed in.", action: "Remind them to sign in." },
  website_only: { label: "Website only, no app", tone: "amber", color: "#DABD38", meaning: "They sign in on the website but have never used the phone app.", action: "Ask them to install the app." },
  old_app: { label: "Has the old app, needs to update", tone: "gold", color: "#8a9a94", meaning: "They have the phone app, but an old version. It still works, but it cannot tell us what they open.", action: "Ask them to update the app from the store." },
  app_not_used: { label: "Has the new app, not opened in 30 days", tone: "gold", color: "#6b7f78", meaning: "They have the latest app but have not opened it in the last 30 days.", action: "Remind them to open it." },
  using_app: { label: "Using the new app", tone: "green", color: "#02422B", meaning: "They opened the latest phone app in the last 30 days.", action: "Nothing to do." },
}
const ORDER: Status[] = ["no_password", "never_signed_in", "website_only", "old_app", "app_not_used", "using_app"]
type Filter = "all" | Status | "today" | "week" | "notes_off" | "no_app"
const FILTERS: { key: Filter; label: string; test: (c: Client) => boolean }[] = [
  { key: "all", label: "Everyone", test: () => true },
  ...ORDER.map((s) => ({ key: s as Filter, label: STATUS[s].label, test: (c: Client) => c.status === s })),
  { key: "no_app", label: "No app at all", test: (c) => !c.hasApp },
  { key: "today", label: "Used it today", test: (c) => c.usedToday },
  { key: "week", label: "Used it in the last 7 days", test: (c) => c.used7 },
  { key: "notes_off", label: "Has the app, notifications off", test: (c) => c.hasApp && !c.notificationsOn },
]
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–")
const phone = (c: Client) => (!c.hasApp ? "No app" : `${c.devices.join(" + ") || "Phone app"}${c.appVersion ? ` · v${c.appVersion}` : " · old version"}`)
const KIND: Record<LogRow["kind"], { icon: ReactNode; cls: string }> = {
  opened: { icon: <Eye className="h-3.5 w-3.5" />, cls: "bg-[#EFECD3] text-[#02422B]" },
  did: { icon: <Smartphone className="h-3.5 w-3.5" />, cls: "bg-[#02422B] text-[#EFECD3]" },
  signin: { icon: <LogIn className="h-3.5 w-3.5" />, cls: "bg-sky-100 text-sky-800" },
  problem: { icon: <TriangleAlert className="h-3.5 w-3.5" />, cls: "bg-red-100 text-red-700" },
  notification: { icon: <Bell className="h-3.5 w-3.5" />, cls: "bg-[#DABD38]/30 text-[#6b5a07]" },
}
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10)
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const blob = new Blob([[cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function Fact({ label, value, hint, icon, onClick }: { label: string; value: ReactNode; hint: ReactNode; icon: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cn("rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] p-4 text-left shadow-sm", onClick && "transition hover:border-[#02422B]/40")}>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground"><span>{label}</span><span className="text-[#02422B]/60">{icon}</span></div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-[#002017]">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </button>
  )
}

export default function AppAnalyticsPage() {
  const [days, setDays] = useState(30)
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [shown, setShown] = useState(50)
  const [open, setOpen] = useState<Client | null>(null)
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [recipients, setRecipients] = useState<{ email: string; name: string; title: string; at: string; reached: string; read: boolean }[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setD(await boFetch<Data>(`/api/admin/bo/analytics/clients?days=${days}`)) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [days])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!open) return
    let alive = true; setLog(null)
    boFetch<{ log: LogRow[] }>(`/api/admin/bo/analytics/clients?email=${encodeURIComponent(open.email)}`).then((r) => { if (alive) setLog(r.log) }).catch(() => { if (alive) setLog([]) })
    return () => { alive = false }
  }, [open])
  useEffect(() => {
    if (!note) return
    let alive = true; setRecipients(null)
    boFetch<{ recipients: any[] }>(`/api/admin/bo/analytics/clients?days=${days}&note=${encodeURIComponent(note.key)}`).then((r) => { if (alive) setRecipients(r.recipients) }).catch(() => { if (alive) setRecipients([]) })
    return () => { alive = false }
  }, [note, days])

  const pick = (f: Filter) => { setFilter(f); setShown(50); document.getElementById("clients")?.scrollIntoView({ behavior: "smooth", block: "start" }) }
  const list = useMemo(() => {
    if (!d) return []
    const f = FILTERS.find((x) => x.key === filter)!, s = q.trim().toLowerCase()
    return d.clients.filter((c) => f.test(c) && (!s || c.name.toLowerCase().includes(s) || c.email.includes(s) || c.accounts.some((a) => a.toLowerCase().includes(s))))
  }, [d, filter, q])
  const exportList = () => downloadCsv(`myqode-clients-${filter}`, list.map((c) => ({
    Client: c.name, Email: c.email, Accounts: c.accounts.join(" "), Status: STATUS[c.status].label, "What to do": STATUS[c.status].action, Phone: phone(c),
    "Last opened": c.lastUsed ? fmtDate(c.lastUsed) : "Never", [`Days used (last ${d?.days})`]: c.daysUsed, "Looks at most": c.topPages.join(", "),
    "Notifications on phone": !c.hasApp ? "No app" : c.notificationsOn ? "On" : "Off", "Notifications sent": c.notesSent, "Reached phone": c.notesOnPhone, Read: c.notesRead,
  })))
  const S = d?.summary
  const logByDay = useMemo(() => {
    const m = new Map<string, LogRow[]>()
    for (const l of log ?? []) { const k = istDay(l.at); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m.entries()]
  }, [log])

  return (
    <div className="space-y-6">
      <PageHeader title="App analytics"
        description="Who has the app, who is using it, what they look at, and which notifications reach them. Each client counts once, even with several accounts."
        actions={<>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border border-[#02422B]/20 bg-white px-3 text-sm" aria-label="Period">
            {[7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
          <Button variant="outline" className="bg-white" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
        </>} />

      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!d && loading ? <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-96 w-full" /></div> : null}

      {d && S ? <>
        {/* 1. Where every client stands */}
        <Panel title={`Where our ${fmtNum(S.clients)} clients stand`} description="Every client is in exactly one of these groups. Click a group to see the names and what to do.">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-200">
            {ORDER.map((s) => { const n = d.clients.filter((c) => c.status === s).length; return n ? <div key={s} title={`${STATUS[s].label}: ${n}`} style={{ width: `${(n / S.clients) * 100}%`, background: STATUS[s].color }} /> : null })}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ORDER.map((s) => {
              const n = d.clients.filter((c) => c.status === s).length
              if (!n && (s === "never_signed_in" || s === "app_not_used")) return null
              return (
                <button key={s} type="button" onClick={() => pick(s)} className={cn("rounded-xl border bg-white p-4 text-left transition hover:border-[#02422B]/50", filter === s ? "border-[#02422B]" : "border-[#02422B]/10")}>
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#002017]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[s].color }} />{STATUS[s].label}</div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-[#002017]">{fmtNum(n)} <span className="text-sm font-medium text-muted-foreground">{pct(n, S.clients)}</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{STATUS[s].meaning}</p>
                  <p className="mt-2 text-xs font-medium text-[#02422B]">{STATUS[s].action}</p>
                </button>
              )
            })}
          </div>
        </Panel>

        {/* 2. Quick facts */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Fact label="Used myQode today" value={fmtNum(S.usedToday)} hint="App or website, so far today" icon={<Eye className="h-4 w-4" />} onClick={() => pick("today")} />
          <Fact label="Used it in the last 7 days" value={fmtNum(S.used7)} hint={`${pct(S.used7, S.clients)} of all clients`} icon={<Eye className="h-4 w-4" />} onClick={() => pick("week")} />
          <Fact label="Don't have the app" value={fmtNum(S.noApp)} hint={`${fmtNum(S.noPassword)} have no password, ${fmtNum(S.websiteOnly + S.neverSignedIn)} use only the website`} icon={<Smartphone className="h-4 w-4" />} onClick={() => pick("no_app")} />
          <Fact label="Have the app" value={fmtNum(S.hasApp)} hint={`${fmtNum(S.iphone)} iPhone · ${fmtNum(S.android)} Android`} icon={<Smartphone className="h-4 w-4" />} />
          <Fact label="Notifications switched off" value={fmtNum(S.notificationsOff)} hint={`Of ${fmtNum(S.hasApp)} with the app, only ${fmtNum(S.notificationsOn)} get alerts on their phone`} icon={<BellOff className="h-4 w-4" />} onClick={() => pick("notes_off")} />
        </div>

        {/* 3. Daily use */}
        <Panel title="Clients using myQode each day" description={`How many different clients opened it each day, last ${d.days} days. Someone who used both the app and the website that day counts under the app.`}>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(v) => fmtShortDay(String(v))} formatter={(v: any, n: any) => [`${v} clients`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="app" name="Phone app" stackId="a" fill="#02422B" radius={[0, 0, 0, 0]} />
                <Bar dataKey="website" name="Website only" stackId="a" fill="#DABD38" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Phone-app use is recorded from version 1.3 (launched 10 Oct 2026). Clients on an older app show as having the app, but what they open is not recorded until they update.</p>
        </Panel>

        {/* 4. Every client */}
        <div id="clients" className="scroll-mt-4">
          <Panel title="Every client" description="Click a client to see everything they did: what they opened, sign-ins, and notifications sent to them."
            action={<Button size="sm" variant="outline" className="bg-white" onClick={exportList} disabled={!list.length}><Download className="h-4 w-4" />Download this list</Button>} bodyClassName="p-0">
            <div className="space-y-3 border-b border-[#02422B]/10 p-4">
              <div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => { setQ(e.target.value); setShown(50) }} placeholder="Search name, email or account" className="bg-white pl-9" /></div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => { const n = d.clients.filter(f.test).length; if (!n && f.key !== "all") return null
                  return <button key={f.key} type="button" onClick={() => { setFilter(f.key); setShown(50) }}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f.key ? "border-[#02422B] bg-[#02422B] text-white" : "border-[#02422B]/15 bg-white text-[#002017] hover:border-[#02422B]/40")}>
                    {f.label} <span className={filter === f.key ? "text-[#DABD38]" : "text-muted-foreground"}>{fmtNum(n)}</span></button> })}
              </div>
            </div>
            {list.length ? <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Client</TableHead><TableHead>Where they stand</TableHead><TableHead>Phone</TableHead><TableHead>Last opened</TableHead>
                  <TableHead className="text-right">Days used</TableHead><TableHead>Looks at most</TableHead><TableHead>Notifications</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.slice(0, shown).map((c) => (
                    <TableRow key={c.email} className="cursor-pointer hover:bg-[#EFECD3]/50" onClick={() => setOpen(c)}>
                      <TableCell><p className="max-w-[15rem] truncate font-medium text-[#002017]">{c.name}</p><p className="max-w-[15rem] truncate text-xs text-muted-foreground">{c.accounts.join(" · ")}</p></TableCell>
                      <TableCell><Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>{c.locked ? <Pill tone="red" className="ml-1">Locked</Pill> : null}</TableCell>
                      <TableCell className="text-sm">{c.hasApp ? <>{c.devices.join(" + ") || "Phone app"}<span className={cn("block text-xs", c.appVersion ? "text-muted-foreground" : "text-amber-700")}>{c.appVersion ? `Version ${c.appVersion}` : "Old version, needs an update"}</span></> : <span className="text-muted-foreground">No app</span>}</TableCell>
                      <TableCell className="text-sm">{c.lastUsed ? fmtRelative(c.lastUsed) : <span className="text-muted-foreground">Never</span>}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{c.daysUsed ? `${c.daysUsed} of ${d.days}` : <span className="text-muted-foreground">0</span>}</TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm" title={c.topPages.join(", ")}>{c.topPages.length ? c.topPages.join(", ") : <span className="text-muted-foreground">–</span>}</TableCell>
                      <TableCell className="text-sm">
                        {!c.hasApp ? <span className="text-muted-foreground">No app</span> : c.notificationsOn ? <span className="inline-flex items-center gap-1 text-emerald-700"><Bell className="h-3.5 w-3.5" />On</span> : <span className="inline-flex items-center gap-1 text-amber-700"><BellOff className="h-3.5 w-3.5" />Off</span>}
                        {c.notesSent ? <span className="block text-xs text-muted-foreground">{c.notesSent} sent · {c.notesRead} read</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                <span>Showing {fmtNum(Math.min(shown, list.length))} of {fmtNum(list.length)} clients</span>
                {shown < list.length ? <Button size="sm" variant="outline" className="bg-white" onClick={() => setShown(shown + 100)}>Show more</Button> : null}
              </div>
            </div> : <EmptyState title="No clients match" description="Try another group or search." />}
          </Panel>
        </div>

        {/* 5. What they look at · notifications */}
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="What clients look at" description={`Pages opened in the last ${d.days} days: how many clients opened each, and how many times in total.`}>
            {d.pages.length ? <div className="space-y-2">
              {d.pages.slice(0, 12).map((p) => (
                <div key={p.page} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-[#002017]">{p.page}</span>
                  <div className="h-2.5 rounded-full bg-stone-200"><div className="h-2.5 rounded-full bg-[#02422B]" style={{ width: `${(p.clients / d.pages[0].clients) * 100}%` }} /></div>
                  <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"><b className="text-[#002017]">{fmtNum(p.clients)}</b> clients · {fmtNum(p.views)} times</span>
                </div>
              ))}
            </div> : <EmptyState title="Nothing opened in this period" />}
          </Panel>

          <Panel title="Notifications we sent" description={`Last ${d.days} days. "Reached the phone" means it popped up on their phone; the rest sit only in the in-app inbox because the client has no phone registered. Click a row to see who got it.`} bodyClassName="p-0">
            {d.notifications.length ? <Table>
              <TableHeader><TableRow><TableHead>Notification</TableHead><TableHead className="text-right">Clients</TableHead><TableHead className="text-right">Reached the phone</TableHead><TableHead className="text-right">Read</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.notifications.slice(0, 15).map((n) => (
                  <TableRow key={n.key} className="cursor-pointer hover:bg-[#EFECD3]/50" onClick={() => setNote(n)}>
                    <TableCell><p className="font-medium text-[#002017]">{n.title}</p><p className="text-xs text-muted-foreground">{n.kind} · {fmtNum(n.sent)} sent</p></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(n.clients)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(n.reachedPhone)} <span className="text-xs text-muted-foreground">{pct(n.reachedPhone, n.sent)}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(n.read)} <span className="text-xs text-muted-foreground">{pct(n.read, n.sent)}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table> : <EmptyState title="No notifications sent in this period" />}
          </Panel>
        </div>

        <p className="text-xs text-muted-foreground">
          <KeyRound className="mr-1 inline h-3.5 w-3.5" />
          How this is counted: clients are people with an open account. Qode staff sessions and partners are left out. &quot;Has the app&quot; means they signed in from an iPhone or Android at least once; we cannot see installs that never signed in. Updated {fmtRelative(d.generatedAt)}.
        </p>
      </> : null}

      {/* One client's activity log */}
      <Sheet open={!!open} onOpenChange={(v) => { if (!v) setOpen(null) }}>
        <SheetContent className="w-full overflow-y-auto bg-[#F9F7EC] sm:max-w-lg">
          {open ? <>
            <SheetHeader>
              <SheetTitle className="font-serif text-xl text-[#02422B]">{open.name}</SheetTitle>
              <SheetDescription>{open.email} · {open.accounts.join(" · ")}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-8">
              <div className="rounded-lg border border-[#02422B]/10 bg-white p-3 text-sm">
                <Pill tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Pill>
                <p className="mt-2 text-muted-foreground">{STATUS[open.status].meaning} <span className="font-medium text-[#02422B]">{STATUS[open.status].action}</span></p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {[["Phone", phone(open)], ["Last opened", open.lastUsed ? fmtRelative(open.lastUsed) : "Never"], ["Password", open.passwordSet ? `Set${open.passwordSetAt ? ` on ${fmtDate(open.passwordSetAt)}` : ""}` : "Not set"],
                    ["Days used", `${open.daysUsed} of the last ${d?.days}`], ["Notifications on phone", !open.hasApp ? "No app" : open.notificationsOn ? "On" : "Off"],
                    ["Notifications", `${open.notesSent} sent · ${open.notesOnPhone} reached the phone · ${open.notesRead} read`]].map(([k, v]) => (
                    <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium text-[#002017]">{v}</dd></div>
                  ))}
                </dl>
                <Link href={`/admin/users/${encodeURIComponent(open.email)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#02422B] underline-offset-2 hover:underline">Open this client&apos;s admin page<ExternalLink className="h-3 w-3" /></Link>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#002017]">Activity log</h3>
                <p className="text-xs text-muted-foreground">Last 60 days, newest first. Times are IST.</p>
              </div>
              {log === null ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
                : !log.length ? <EmptyState title="Nothing recorded yet" description={open.hasApp && !open.appVersion ? "This client is on the old app, which does not record activity. It will appear once they update." : "This client has not used myQode in the last 60 days."} />
                : logByDay.map(([day, rows]) => (
                  <div key={day}>
                    <p className="sticky top-0 bg-[#F9F7EC] py-1 text-xs font-semibold text-[#02422B]">{fmtShortDay(day)}</p>
                    <ul className="space-y-1.5">
                      {rows.map((l, i) => (
                        <li key={i} className="flex items-start gap-2.5 rounded-lg bg-white px-3 py-2 text-sm">
                          <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", KIND[l.kind].cls)}>{KIND[l.kind].icon}</span>
                          <span className="min-w-0 flex-1"><span className="block text-[#002017]">{l.text}</span><span className="block text-xs text-muted-foreground">{l.detail}</span></span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{istTime(l.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </> : null}
        </SheetContent>
      </Sheet>

      {/* Who received one notification */}
      <Dialog open={!!note} onOpenChange={(v) => { if (!v) setNote(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {note ? <>
            <DialogHeader>
              <DialogTitle>{note.title}</DialogTitle>
              <DialogDescription>{fmtNum(note.sent)} sent to {fmtNum(note.clients)} clients in the last {d?.days} days · {fmtNum(note.reachedPhone)} reached the phone · {fmtNum(note.read)} read</DialogDescription>
            </DialogHeader>
            {recipients === null ? <Skeleton className="h-40 w-full" /> : <>
              <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => downloadCsv(`notification-${note.title}`, recipients.map((r) => ({ Client: r.name, Email: r.email, Notification: r.title, Sent: fmtDate(r.at), "Reached the phone": r.reached === "phone" ? "Yes" : "No", Read: r.read ? "Yes" : "No" })))}><Download className="h-4 w-4" />Download</Button></div>
              <Table>
                <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Sent</TableHead><TableHead>Reached the phone</TableHead><TableHead>Read</TableHead></TableRow></TableHeader>
                <TableBody>
                  {recipients.slice(0, 300).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.title}</p></TableCell>
                      <TableCell className="text-sm">{fmtShortDay(istDay(r.at))}</TableCell>
                      <TableCell>{r.reached === "phone" ? <Pill tone="green">Yes</Pill> : r.reached === "failed" ? <Pill tone="red">Failed</Pill> : r.reached === "waiting" ? <Pill tone="amber">Waiting</Pill> : <Pill tone="grey">Inbox only</Pill>}</TableCell>
                      <TableCell>{r.read ? <Pill tone="green">Read</Pill> : <Pill tone="grey">Not yet</Pill>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>}
          </> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
