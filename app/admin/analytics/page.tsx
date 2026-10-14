"use client"

// App analytics, in plain words: where every client stands (no password → website only → has the app → using it),
// who used myQode each day, what they look at, and which notifications reach them. One row per client; a row opens
// that client's activity log. Data: GET /api/admin/bo/analytics/clients.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Bell, BellOff, Download, ExternalLink, Eye, KeyRound, LogIn, Mail, RefreshCw, Search, Send, Smartphone, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorNote, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDate, fmtNum, fmtRelative, fmtShortDay, useBackofficeAdmin } from "@/components/admin-kit"
import { cn } from "@/lib/utils"
import { downloadXlsx, type XSheet } from "@/lib/xlsxWriter"
import { ORDER, STATUS, ownersBridge, shares, type Status } from "@/components/app-analytics-shared"

type Client = {
  id: string; email: string; name: string; accounts: string[]; status: Status; passwordSet: boolean; passwordSetAt: string | null; signedIn: boolean
  hasApp: boolean; newApp: boolean; devices: string[]; appVersion: string | null; appSince: string | null; lastUsed: string | null; lastUsedApp: string | null
  daysUsed: number; opens: number; usedToday: boolean; used7: boolean; usedTodayApp: boolean; used7App: boolean; topPages: string[]; notificationsOn: boolean
  notesSent: number; notesOnPhone: number; notesRead: number; locked: boolean; remindedAt: string | null; familyHead: string | null
  // from Zoho CRM and the portfolio (lib/clientCrm.ts)
  source: string | null; bucket: string | null; rm: string | null; partner: string | null; inZoho: boolean; aum: number
}
type Note = { key: string; kind: string; title: string; sent: number; lastSent: string; clients: number; reachedPhone: number; inboxOnly: number; read: number }
type Data = {
  days: number; from: string; to: string; generatedAt: string
  summary: Record<string, number>
  daily: { date: string; app: number; website: number }[]
  clients: Client[]
  newAppVersion: string; zoho: boolean
  pages: { page: string; clients: number; views: number }[]
  notifications: Note[]
}
// Reminders (GET/POST /api/admin/bo/analytics/reminders): one ready message per group that needs chasing
type Kind = "no_password" | "website_only" | "old_app" | "outdated_app"
const KINDS: Kind[] = ["no_password", "website_only", "old_app", "outdated_app"]
type Reminder = { channel: "email" | "phone"; group: string; subject: string; message: string; recipients: number; skipped: number }
type Reminders = { kinds: Record<Kind, Reminder>; cooldownDays: number; latestVersion: string; history: { kind: Kind; by: string; at: string; recipients: number; subject: string }[] }
const older = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) } return false }
type LogRow = { at: string; kind: "opened" | "did" | "signin" | "problem" | "notification"; text: string; detail: string }

type Filter = "all" | Status | "today" | "week" | "notes_off" | "no_app" | "never_in"
// `card`: opened from a quick-fact card above, so it is not a tab of its own; it shows only while it is the one picked
const FILTERS: { key: Filter; label: string; test: (c: Client) => boolean; card?: boolean }[] = [
  { key: "all", label: "Everyone", test: () => true },
  ...ORDER.map((s) => ({ key: s as Filter, label: STATUS[s].label, test: (c: Client) => c.status === s })),
  { key: "no_app", card: true, label: "No app at all", test: (c) => !c.hasApp },
  { key: "never_in", card: true, label: "Never signed in", test: (c) => !c.signedIn },
  { key: "today", card: true, label: "Used it today", test: (c) => c.usedToday },
  { key: "week", card: true, label: "Used it in the last 7 days", test: (c) => c.used7 },
  { key: "notes_off", card: true, label: "On the new app, phone alerts off", test: (c) => isNew(c) && !c.notificationsOn },
]
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–")
// Two kinds of app, nothing in between: the new version, and the old app (everything before it)
const isNew = (c: Client) => c.newApp
const phoneType = (c: Client) => c.devices.join(" + ") || "Phone type not recorded"
const alerts = (c: Client) => (!c.hasApp ? "No app" : !isNew(c) ? "Old app" : c.notificationsOn ? "On" : "Off")
const phone = (c: Client) => (!c.hasApp ? "No app" : `${phoneType(c)} · ${isNew(c) ? "new app" : "old app"}`)
// Zoho CRM: where a client came from, and who looks after them
const NOT_IN_ZOHO = "Not found in Zoho", NO_SOURCE = "Source not filled in", NO_BUCKET = "Bucket not filled in", NO_RM = "No RM in Zoho"
const sourceOf = (c: Client) => (!c.inZoho ? NOT_IN_ZOHO : c.source || NO_SOURCE)
const bucketOf = (c: Client) => (!c.inZoho ? NOT_IN_ZOHO : c.bucket || NO_BUCKET)
// Clients who came through a distributor are looked after by that partner: the name in Zoho's RM field for them is
// the partner's own person or firm, so no Qode relationship manager is shown for them.
const isDist = (c: Client) => c.source === "Distributor" || c.bucket === "Distributor Partners"
const rmOf = (c: Client) => (isDist(c) ? "" : c.rm || NO_RM)
const keeper = (c: Client) => (isDist(c) ? `Partner: ${c.partner || "not named in Zoho"}` : `RM: ${rmOf(c)}`)
const crore = (n: number) => `₹${(n / 1e7).toFixed(1)} Cr`
const SHORT: Record<Status, string> = { no_password: "No password", never_signed_in: "Never signed in", website_only: "Website only", old_app: "Old app", app_not_used: "New app, unused", using_app: "New app", family_covered: "Family, seen by head" }
const BUCKET_COLORS = ["#02422B", "#DABD38", "#8a9a94", "#b42318", "#6b7f78", "#d97706", "#c7c2a6"]
const TO_CHASE: Status[] = ["no_password", "never_signed_in", "website_only", "old_app", "app_not_used"]
type Group = { key: string; clients: Client[]; by: Record<Status, number>; hasApp: number; used: number; never: number; avgDays: number | null; aum: number; chase: number }
function groupBy(clients: Client[], keyOf: (c: Client) => string): Group[] {
  const m = new Map<string, Client[]>()
  for (const c of clients) m.set(keyOf(c), [...(m.get(keyOf(c)) ?? []), c])
  return [...m.entries()].map(([key, cs]) => {
    const by = Object.fromEntries(ORDER.map((s) => [s, cs.filter((c) => c.status === s).length])) as Record<Status, number>
    const onNew = cs.filter((c) => c.newApp)
    return { key, clients: cs, by, hasApp: cs.filter((c) => c.hasApp).length, used: cs.filter((c) => c.daysUsed > 0).length, never: cs.filter((c) => !c.signedIn).length,
      avgDays: onNew.length ? onNew.reduce((s, c) => s + c.daysUsed, 0) / onNew.length : null, aum: cs.reduce((s, c) => s + c.aum, 0), chase: TO_CHASE.reduce((n, s) => n + by[s], 0) }
  })
}
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

// The whole page as one Excel workbook: a sheet per section, every client on one sheet, and a ready "to chase" list.
function fullReport(d: Data, rem: Reminders | null): XSheet[] {
  const S = d.summary, n = (k: string) => S[k] ?? 0
  const share = (a: number) => (S.clients ? a / S.clients : 0)
  const clientCols = [
    { label: "Client", width: 30 }, { label: "Email", width: 30 }, { label: "Accounts", width: 26 }, { label: "Where they stand", width: 30 }, { label: "What to do", width: 34 }, { label: "Family head", width: 24 },
    { label: "Source bucket (Zoho)", width: 22 }, { label: "Lead source (Zoho)", width: 22 }, { label: "Relationship manager (Zoho)", width: 24 }, { label: "Partner", width: 24 }, { label: "Assets (Rs)", width: 16, type: "number" as const },
    { label: "Phone", width: 16 }, { label: "App", width: 12 }, { label: "Password set on", width: 14, type: "date" as const }, { label: "Last opened (app or website)", width: 16, type: "date" as const },
    { label: "Last opened the phone app", width: 16, type: "date" as const }, { label: `Days used (last ${d.days})`, width: 12, type: "number" as const }, { label: `Times opened (last ${d.days} days)`, width: 13, type: "number" as const },
    { label: "Looks at most", width: 34 }, { label: "Phone alerts", width: 24 }, { label: "Notifications sent", width: 12, type: "number" as const },
    { label: "Reached the phone", width: 12, type: "number" as const }, { label: "Read", width: 8, type: "number" as const }, { label: "Reminded on", width: 14, type: "date" as const },
  ]
  const clientRow = (c: Client) => [c.name, c.email, c.accounts.join(", "), STATUS[c.status].label, STATUS[c.status].action, c.familyHead || "", bucketOf(c), sourceOf(c), rmOf(c), c.partner || "", Math.round(c.aum), !c.hasApp ? "No app" : phoneType(c),
    !c.hasApp ? "" : isNew(c) ? "New app" : "Old app", c.passwordSet ? c.passwordSetAt || "" : "", c.lastUsed || "", c.lastUsedApp || "", c.daysUsed, c.opens, c.topPages.join(", "),
    alerts(c), c.notesSent, c.notesOnPhone, c.notesRead, c.remindedAt || ""]
  const byName = [...d.clients].sort((a, b) => a.name.localeCompare(b.name))
  const live = ORDER.filter((s) => d.clients.some((c) => c.status === s))
  const chase = d.clients.filter((c) => c.status !== "using_app" && c.status !== "family_covered").sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name))
  const sheets: XSheet[] = [
    { name: "Summary", columns: [{ label: "Measure", width: 42 }, { label: "Clients", width: 12, type: "number" }, { label: "Share of all clients", width: 14, type: "percent" }, { label: "What it means", width: 80 }],
      rows: [
        ["Owners on record", n("ownersOnRecord"), "", "The Admin Dashboard's Total Owners."],
        ["  Closed every account", n("ownersClosed"), "", "Left out of everything below."],
        ["  Qode test accounts", n("ownersTest"), "", "Left out of everything below."],
        ["Current clients", n("clients"), 1, "Owners with an open account. Each counts once, even with several accounts."],
        ["Password set", n("passwordSet"), share(n("passwordSet")), "They can sign in."],
        ...ORDER.filter((s) => d.clients.some((c) => c.status === s)).map((s) => { const k = d.clients.filter((c) => c.status === s).length; return [STATUS[s].label, k, share(k), `${STATUS[s].meaning} ${STATUS[s].action}`] }),
        ["Have the phone app", n("hasApp"), share(n("hasApp")), `Signed in from the phone app at least once: ${n("newApp")} on the new app (version ${d.newAppVersion}), ${n("oldApp")} on the old app.`],
        ["  iPhone only", n("iphoneOnly"), share(n("iphoneOnly")), ""],
        ["  Android only", n("androidOnly"), share(n("androidOnly")), ""],
        ["  Both an iPhone and an Android", n("bothPhones"), share(n("bothPhones")), ""],
        ["  Phone type not recorded", n("phoneUnknown"), share(n("phoneUnknown")), "They signed in from the phone app between July and September 2026 on an old version that does not say whether it is an iPhone or an Android."],
        ["Don't have the app", n("noApp"), share(n("noApp")), "No password yet, website only, or seen through the family head."],
        ["New app, phone alerts on", n("alertsOn"), share(n("alertsOn")), "They get notifications on their phone."],
        ["New app, phone alerts off", n("alertsOff"), share(n("alertsOff")), "They only see notifications inside the app, if they open it. Clients on the old app are not counted here."],
        ["Used myQode today", n("usedToday"), share(n("usedToday")), `${n("usedTodayApp")} on the phone app, ${n("usedToday") - n("usedTodayApp")} on the website only.`],
        ["Used it in the last 7 days", n("used7"), share(n("used7")), `${n("used7App")} on the phone app, ${n("used7") - n("used7App")} on the website only.`],
        [`Used it in the last ${d.days} days`, n("usedPeriod"), share(n("usedPeriod")), "App or website."],
        [`Report period: ${d.from} to ${d.to}`, "", "", "Qode staff sessions, staff 'Open as' sessions, Qode test accounts and partners are left out. Phone-app activity is recorded only by the new app."],
      ] },
    ...(d.zoho ? [
      { name: "By lead source", columns: [{ label: "Source bucket (Zoho)", width: 24 }, { label: "Lead source (Zoho)", width: 28 }, { label: "Clients", width: 10, type: "number" as const }, { label: "Never signed in", width: 14, type: "number" as const }, ...live.map((s) => ({ label: STATUS[s].label, width: 16, type: "number" as const })),
          { label: "Have the phone app", width: 14, type: "number" as const }, { label: "Share of everyone with the app", width: 16, type: "percent" as const }, { label: `Used it in the last ${d.days} days`, width: 16, type: "number" as const }, { label: "Days used, new-app clients (average)", width: 18, type: "number" as const }, { label: "Assets (Rs)", width: 18, type: "number" as const }],
        rows: [...groupBy(d.clients, bucketOf).sort((a, b) => b.clients.length - a.clients.length).flatMap((bk) => [
            [bk.key, "All sources in this bucket", bk.clients.length, bk.never, ...live.map((s) => bk.by[s]), bk.hasApp, n("hasApp") ? bk.hasApp / n("hasApp") : 0, bk.used, bk.avgDays == null ? "" : Math.round(bk.avgDays * 10) / 10, Math.round(bk.aum)],
            ...groupBy(bk.clients, sourceOf).sort((a, b) => b.clients.length - a.clients.length).map((g) => [bk.key, g.key, g.clients.length, g.never, ...live.map((s) => g.by[s]), g.hasApp, n("hasApp") ? g.hasApp / n("hasApp") : 0, g.used, g.avgDays == null ? "" : Math.round(g.avgDays * 10) / 10, Math.round(g.aum)])]),
          ["Total", "", n("clients"), n("neverSignedInAll"), ...live.map((s) => d.clients.filter((c) => c.status === s).length), n("hasApp"), 1, n("usedPeriod"), "", Math.round(d.clients.reduce((t, c) => t + c.aum, 0))]] },
      { name: "By relationship manager", columns: [{ label: "Relationship manager (Zoho)", width: 30 }, { label: "Clients", width: 10, type: "number" as const }, { label: "To chase", width: 10, type: "number" as const },
          { label: "No password", width: 12, type: "number" as const }, { label: "Website only", width: 12, type: "number" as const }, { label: "Old app", width: 10, type: "number" as const }, { label: "Assets (Rs)", width: 18, type: "number" as const }],
        rows: groupBy(d.clients.filter((c) => !isDist(c)), rmOf).sort((a, b) => b.chase - a.chase || b.clients.length - a.clients.length).map((g) => [g.key, g.clients.length, g.chase, g.by.no_password + g.by.never_signed_in, g.by.website_only, g.by.old_app + g.by.app_not_used, Math.round(g.aum)]) },
    ] : []),
    { name: "To chase", columns: clientCols, rows: chase.map(clientRow) },
    { name: "All clients", columns: clientCols, rows: byName.map(clientRow) },
    { name: "Daily use", columns: [{ label: "Day", width: 14, type: "date" }, { label: "Used the phone app", width: 16, type: "number" }, { label: "Website only", width: 14, type: "number" }, { label: "Total clients", width: 14, type: "number" }],
      rows: d.daily.map((x) => [x.date, x.app, x.website, x.app + x.website]) },
    { name: "What clients look at", columns: [{ label: "Page", width: 34 }, { label: "Clients who opened it", width: 16, type: "number" }, { label: "Times opened", width: 14, type: "number" }],
      rows: d.pages.map((x) => [x.page, x.clients, x.views]) },
    { name: "Notifications", columns: [{ label: "Notification", width: 40 }, { label: "Kind", width: 24 }, { label: "Last sent", width: 14, type: "date" }, { label: "Clients it was sent to", width: 14, type: "number" },
        { label: "Clients it reached on the phone", width: 16, type: "number" }, { label: "Clients with it in the in-app inbox only", width: 18, type: "number" }, { label: "Clients who read it", width: 12, type: "number" }, { label: "Notifications sent in all", width: 14, type: "number" }],
      rows: d.notifications.map((x) => [x.title, x.kind, x.lastSent, x.clients, x.reachedPhone, x.inboxOnly, x.read, x.sent]) },
  ]
  if (rem?.history.length) sheets.push({ name: "Reminders sent", columns: [{ label: "Sent on", width: 14, type: "date" }, { label: "Group", width: 34 }, { label: "Clients", width: 10, type: "number" }, { label: "Subject", width: 44 }, { label: "Sent by", width: 30 }],
    rows: rem.history.map((h) => [h.at, rem.kinds[h.kind]?.group ?? h.kind, h.recipients, h.subject, h.by]) })
  return sheets
}

// Horizontal bars, one per row, stacked by `segs`; the row's total is printed at the end of its bar. A row may carry
// its own `color` (single-segment charts). Clicking a bar picks that row.
type Seg = { key: string; label: string; color: string }
function HBars({ rows, segs, onPick, fmt = (n) => fmtNum(n), nameWidth = 170 }: { rows: Record<string, any>[]; segs: Seg[]; onPick?: (name: string) => void; fmt?: (n: number) => string; nameWidth?: number }) {
  if (!rows.length) return <EmptyState title="Nothing to show" />
  return (
    <div style={{ height: Math.max(110, rows.length * 34 + (segs.length > 1 ? 64 : 30)) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 0 }} barCategoryGap={7}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
          <YAxis type="category" dataKey="name" width={nameWidth} tick={{ fontSize: 12, fill: "#002017" }} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={{ fill: "#EFECD3", opacity: 0.5 }} formatter={(v: any, n: any) => [fmt(Number(v)), n]} />
          {segs.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          {segs.map((sg, i) => (
            <Bar key={sg.key} dataKey={sg.key} name={sg.label} stackId="a" fill={sg.color} isAnimationActive={false} cursor={onPick ? "pointer" : undefined} onClick={(e: any) => onPick?.(String(e?.name ?? e?.payload?.name ?? ""))}>
              {segs.length === 1 ? rows.map((r, k) => <Cell key={k} fill={r.color || sg.color} />) : null}
              {i === segs.length - 1 ? <LabelList dataKey="total" position="right" formatter={(v: any) => fmt(Number(v))} style={{ fontSize: 12, fontWeight: 700, fill: "#002017" }} /> : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
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
  const [src, setSrc] = useState<string | null>(null)   // one lead source
  const [bucket, setBucket] = useState<string | null>(null)   // one source bucket
  const [rm, setRm] = useState<string | null>(null)     // one relationship manager
  const [allRms, setAllRms] = useState(false)
  const [srcMode, setSrcMode] = useState<"bucket" | "source">("bucket")   // the source charts: by bucket, or by lead source
  const [showTables, setShowTables] = useState(false)                      // the same figures as tables, for exact numbers
  const [shown, setShown] = useState(50)
  const [open, setOpen] = useState<Client | null>(null)
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const { admin } = useBackofficeAdmin()
  const maySend = admin?.role === "super" || admin?.role === "investors"
  const [rem, setRem] = useState<Reminders | null>(null)
  const [kind, setKind] = useState<Kind | null>(null)
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [preview, setPreview] = useState<{ recipients: number; skipped: number; sharing?: number; names: string[]; html: string | null } | null>(null)
  const [sending, setSending] = useState<null | "preview" | "test" | "send">(null)
  const [confirm, setConfirm] = useState(false)
  const [tested, setTested] = useState(false)
  const [recipients, setRecipients] = useState<{ email: string; name: string; title: string; at: string; reached: string; read: boolean }[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setD(await boFetch<Data>(`/api/admin/bo/analytics/clients?days=${days}`)) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
    boFetch<Reminders>("/api/admin/bo/analytics/reminders").then(setRem).catch(() => setRem(null))
  }, [days])

  // The reminder dialog: the ready message can be edited; nothing goes out before "Send a test to me" and a second confirmation
  const post = (mode: "preview" | "test" | "send", k = kind, sub = subject, msg = message) =>
    boFetch<any>("/api/admin/bo/analytics/reminders", { method: "POST", json: { kind: k, subject: sub, message: msg, mode } })
  const openReminder = (k: Kind) => {
    const r = rem?.kinds[k]; if (!r) return
    setKind(k); setSubject(r.subject); setMessage(r.message); setPreview(null); setConfirm(false); setTested(false); setSending("preview")
    post("preview", k, r.subject, r.message).then(setPreview).catch((e) => toast.error(errorMessage(e))).finally(() => setSending(null))
  }
  const refreshPreview = async () => { setSending("preview"); try { setPreview(await post("preview")) } catch (e) { toast.error(errorMessage(e)) } finally { setSending(null) } }
  const sendTest = async () => { setSending("test"); try { const r = await post("test"); setTested(true); toast.success(`Test sent to ${r.to}`) } catch (e) { toast.error(errorMessage(e)) } finally { setSending(null) } }
  const sendAll = async () => {
    setSending("send")
    try {
      const r = await post("send"); setKind(null)
      toast.success(r.queued ? `Sending to ${r.queued} clients now. It takes a few minutes; refresh to see them marked as reminded.` : "Nobody left to remind in this group.")
      setTimeout(load, 4000)
    } catch (e) { toast.error(errorMessage(e)) } finally { setSending(null); setConfirm(false) }
  }
  useEffect(() => { load() }, [load])
  // A link from another admin page can open one group: /admin/analytics?group=no_password
  const [linked, setLinked] = useState(false)
  useEffect(() => {
    if (!d || linked) return
    setLinked(true)
    const g = new URLSearchParams(window.location.search).get("group") as Filter | null
    if (g && FILTERS.some((f) => f.key === g)) { setFilter(g); setTimeout(() => document.getElementById("clients")?.scrollIntoView({ block: "start" }), 50) }
  }, [d, linked])

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
  const filters = FILTERS
  const list = useMemo(() => {
    if (!d) return []
    const f = filters.find((x) => x.key === filter)!, s = q.trim().toLowerCase()
    return d.clients.filter((c) => f.test(c) && (!src || sourceOf(c) === src) && (!bucket || bucketOf(c) === bucket) && (!rm || rmOf(c) === rm)
      && (!s || c.name.toLowerCase().includes(s) || c.email.includes(s) || c.accounts.some((a) => a.toLowerCase().includes(s)) || (c.rm || "").toLowerCase().includes(s) || (c.source || "").toLowerCase().includes(s)))
  }, [d, filter, q, src, bucket, rm])
  const toClients = () => { setShown(50); setTimeout(() => document.getElementById("clients")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30) }
  const last = (key: string) => (key === NOT_IN_ZOHO ? 2 : key === NO_SOURCE || key === NO_BUCKET || key === NO_RM ? 1 : 0)
  const order = (a: Group, b: Group) => last(a.key) - last(b.key) || b.clients.length - a.clients.length
  // Zoho's source buckets, each with the lead sources inside it
  const byBucket = useMemo(() => (d ? groupBy(d.clients, bucketOf).sort(order).map((g) => ({ ...g, sources: groupBy(g.clients, sourceOf).sort(order) })) : []), [d])
  const bySrc = useMemo(() => (d ? groupBy(d.clients, sourceOf).sort(order) : []), [d])
  const byRm = useMemo(() => (d ? groupBy(d.clients.filter((c) => !isDist(c)), rmOf).sort((a, b) => last(a.key) - last(b.key) || b.chase - a.chase || b.clients.length - a.clients.length) : []), [d])
  const remindable = KINDS.includes(filter as Kind) ? (filter as Kind) : null
  const exportList = () => downloadCsv(`myqode-clients-${filter}`, list.map((c) => ({
    Client: c.name, Email: c.email, Accounts: c.accounts.join(" "), Status: STATUS[c.status].label, "What to do": STATUS[c.status].action,
    "Source bucket (Zoho)": bucketOf(c), "Lead source (Zoho)": sourceOf(c), "Relationship manager (Zoho)": rmOf(c), Partner: c.partner || "", "Assets (Rs)": Math.round(c.aum), Phone: phone(c),
    "Last opened": c.lastUsed ? fmtDate(c.lastUsed) : "Never", [`Days used (last ${d?.days})`]: c.daysUsed, "Looks at most": c.topPages.join(", "),
    "Phone alerts": alerts(c), "Notifications sent": c.notesSent, "Reached phone": c.notesOnPhone, Read: c.notesRead,
    "Reminded on": c.remindedAt ? fmtDate(c.remindedAt) : "",
  })))
  const S = d?.summary
  const statusCount = useMemo(() => ORDER.map((s) => (d ? d.clients.filter((c) => c.status === s).length : 0)), [d])
  const statusShare = useMemo(() => shares(statusCount), [statusCount])
  const logByDay = useMemo(() => {
    const m = new Map<string, LogRow[]>()
    for (const l of log ?? []) { const k = istDay(l.at); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m.entries()]
  }, [log])

  return (
    <div className="space-y-6">
      <PageHeader title="App analytics"
        description="Who has the app, who is using it, what they look at, and which notifications reach them. A client is an owner with an open account, counted once even with several accounts."
        actions={<>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border border-[#02422B]/20 bg-white px-3 text-sm" aria-label="Period">
            {[7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
          <Button variant="outline" className="bg-white" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
          <Button className="bg-[#02422B] text-white hover:bg-[#02422B]/90" disabled={!d} onClick={() => d && downloadXlsx(`myQode-app-analytics-${d.to}.xlsx`, fullReport(d, rem))}><Download className="h-4 w-4" />Download full report</Button>
        </>} />

      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!d && loading ? <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-96 w-full" /></div> : null}

      {d && S ? <>
        {/* 1. Where every client stands */}
        <Panel title={`Where our ${fmtNum(S.clients)} clients stand`} description={`${ownersBridge(S)} Everything on this page is about the ${fmtNum(S.clients)} current clients. Each is in exactly one group below, so the groups add up to ${fmtNum(S.clients)}. Click a group to see the names and what to do.`}>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-200">
            {ORDER.map((s) => { const n = d.clients.filter((c) => c.status === s).length; return n ? <div key={s} title={`${STATUS[s].label}: ${n}`} style={{ width: `${(n / S.clients) * 100}%`, background: STATUS[s].color }} /> : null })}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {ORDER.map((s, i) => {
              const n = statusCount[i]
              if (!n && (s === "never_signed_in" || s === "app_not_used" || s === "family_covered")) return null
              return (
                <button key={s} type="button" onClick={() => pick(s)} className={cn("rounded-xl border bg-white p-4 text-left transition hover:border-[#02422B]/50", filter === s ? "border-[#02422B]" : "border-[#02422B]/10")}>
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#002017]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[s].color }} />{STATUS[s].label}</div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-[#002017]">{fmtNum(n)} <span className="text-sm font-medium text-muted-foreground">{statusShare[i]}%</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{STATUS[s].meaning}</p>
                  <p className="mt-2 text-xs font-medium text-[#02422B]">{STATUS[s].action}</p>
                  {maySend && rem?.kinds[s as Kind] ? <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openReminder(s as Kind) }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openReminder(s as Kind) } }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#02422B]/25 px-2.5 py-1 text-xs font-semibold text-[#02422B] hover:bg-[#EFECD3]"><Mail className="h-3.5 w-3.5" />Send them a reminder</span> : null}
                </button>
              )
            })}
          </div>
        </Panel>

        {/* 2. Quick facts */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Fact label="Used myQode today" value={fmtNum(S.usedToday)} hint={`${fmtNum(S.usedTodayApp)} on the phone app + ${fmtNum(S.usedToday - S.usedTodayApp)} on the website only`} icon={<Eye className="h-4 w-4" />} onClick={() => pick("today")} />
          <Fact label="Used it in the last 7 days" value={fmtNum(S.used7)} hint={`${fmtNum(S.used7App)} on the phone app + ${fmtNum(S.used7 - S.used7App)} on the website only`} icon={<Eye className="h-4 w-4" />} onClick={() => pick("week")} />
          <Fact label="Have the phone app" value={<>{fmtNum(S.hasApp)} <span className="text-sm font-medium text-muted-foreground">of {fmtNum(S.clients)}</span></>}
            hint={<>{fmtNum(S.newApp)} new app + {fmtNum(S.oldApp)} old app.<br />{[[S.iphoneOnly, "iPhone"], [S.androidOnly, "Android"], [S.bothPhones, "both"], [S.phoneUnknown, "on an old app that does not say which phone"]].filter((x) => x[0]).map((x) => `${fmtNum(x[0] as number)} ${x[1]}`).join(" + ")}</>} icon={<Smartphone className="h-4 w-4" />} />
          <Fact label="Don't have the app" value={<>{fmtNum(S.noApp)} <span className="text-sm font-medium text-muted-foreground">of {fmtNum(S.clients)}</span></>}
            hint={[[S.noPassword, "no password"], [S.neverSignedIn, "never signed in"], [S.websiteOnly, "website only"], [S.familyCovered, "seen by the family head"]].filter((x) => x[0]).map((x) => `${fmtNum(x[0] as number)} ${x[1]}`).join(" + ")} icon={<Smartphone className="h-4 w-4" />} onClick={() => pick("no_app")} />
          <Fact label="Phone alerts switched on" value={<>{fmtNum(S.phoneAlerts)} <span className="text-sm font-medium text-muted-foreground">of {fmtNum(S.hasApp)} with the app</span></>}
            hint={`${fmtNum(S.alertsOn)} on the new app + ${fmtNum(S.phoneAlerts - S.alertsOn)} on the old app. ${fmtNum(S.alertsOff)} on the new app have them switched off, and the other ${fmtNum(S.oldApp - (S.phoneAlerts - S.alertsOn))} on the old app cannot get them.`} icon={<Bell className="h-4 w-4" />} onClick={() => pick("notes_off")} />
        </div>

        {/* 3. Daily use */}
        <Panel title="Clients using myQode each day" description={`How many different clients opened it each day, last ${d.days} days. Each client counts once a day: under the phone app if they used it that day, otherwise under the website. The last bar is today so far.`}>
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
          <p className="mt-3 text-xs text-muted-foreground">&quot;Phone app&quot; is the new app, version {d.newAppVersion} (from 10 Oct 2026), and the few clients who had an earlier test version before that. Most of the old app&apos;s use is not recorded, so clients on it show here mainly when they use the website.</p>
        </Panel>

        {/* 3b. Joined to Zoho CRM: by source bucket and lead source, and by relationship manager */}
        {d.zoho ? <>
          {(() => {
            const groups: Group[] = srcMode === "bucket" ? byBucket : bySrc
            const statusSegs: Seg[] = ORDER.filter((x) => statusCount[ORDER.indexOf(x)]).map((x) => ({ key: x, label: SHORT[x], color: STATUS[x].color }))
            const pickSource = (name: string, group?: Filter) => { if (srcMode === "bucket") { setBucket(name); setSrc(null) } else { setSrc(name); setBucket(null) } setRm(null); if (group) setFilter(group); toClients() }
            const toggle = (
              <div className="flex rounded-md border border-[#02422B]/20 bg-white p-0.5 text-xs">
                {([["bucket", "Source bucket"], ["source", "Lead source"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setSrcMode(k)} className={cn("rounded px-2.5 py-1 font-medium", srcMode === k ? "bg-[#02422B] text-white" : "text-[#002017]")}>{l}</button>)}
              </div>)
            const donut = byBucket.map((g, n) => ({ name: g.key, value: g.clients.length, color: BUCKET_COLORS[n % BUCKET_COLORS.length] }))
            return (<>
              <div className="grid gap-6 xl:grid-cols-5">
                <div className="xl:col-span-2">
                  <Panel title="Clients by source bucket" description={`How the ${fmtNum(S.clients)} clients split across Zoho's source buckets. Click a slice or a name to see those clients.`}>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="relative h-52 w-52 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={donut} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="95%" paddingAngle={1.5} isAnimationActive={false} stroke="none" cursor="pointer"
                              onClick={(e: any) => { setBucket(String(e?.name ?? "")); setSrc(null); setRm(null); toClients() }}>
                              {donut.map((x) => <Cell key={x.name} fill={x.color} />)}
                            </Pie>
                            <Tooltip formatter={(v: any, n: any) => [`${fmtNum(Number(v))} clients (${pct(Number(v), S.clients)})`, n]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold tabular-nums text-[#002017]">{fmtNum(S.clients)}</span><span className="text-xs text-muted-foreground">clients</span></div>
                      </div>
                      <ul className="min-w-[12rem] flex-1 space-y-1.5 text-sm">
                        {donut.map((x, n) => (
                          <li key={x.name}><button type="button" className="flex w-full items-center gap-2 text-left hover:underline" onClick={() => { setBucket(x.name); setSrc(null); setRm(null); toClients() }}>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} /><span className="flex-1 text-[#002017]">{x.name}</span>
                            <span className="tabular-nums font-semibold text-[#002017]">{fmtNum(x.value)}</span><span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{shares(donut.map((y) => y.value))[n]}%</span>
                          </button></li>
                        ))}
                      </ul>
                    </div>
                  </Panel>
                </div>
                <div className="xl:col-span-3">
                  <Panel title="Where clients came from, and where they stand" action={toggle}
                    description={`Each bar is one ${srcMode === "bucket" ? "source bucket" : "lead source"} from Zoho CRM. Its length is the number of clients (printed at the end), and the colours show where they stand on myQode. Click a bar to see the names.`}>
                    <HBars rows={groups.map((g) => ({ name: g.key, total: g.clients.length, ...g.by }))} segs={statusSegs} onPick={(n) => pickSource(n)} />
                  </Panel>
                </div>
              </div>
              <div className="grid gap-6 xl:grid-cols-5">
                <div className="xl:col-span-2">
                  <Panel title={`The ${fmtNum(S.neverSignedInAll)} who have never signed in, by source`}
                    description={`Clients with no sign-in to myQode at all, out of ${fmtNum(S.clients)}. A longer bar means more people to reach in that ${srcMode === "bucket" ? "bucket" : "source"}. Click a bar for the names.`}>
                    <HBars rows={groups.filter((g) => g.never).sort((a, b) => b.never - a.never).map((g) => ({ name: g.key, total: g.never, never: g.never }))}
                      segs={[{ key: "never", label: "Never signed in", color: "#b42318" }]} onPick={(n) => pickSource(n, "never_in")} />
                  </Panel>
                </div>
                <div className="xl:col-span-3">
            <Panel title="Who should call them" description={`The five relationship managers (from Zoho) with the most clients still to chase. Clients who came through a distributor are left out here: their partner looks after them (${fmtNum(d.clients.filter(isDist).length)} clients). Click a bar to see that person's list.`}>
              <HBars rows={byRm.filter((g) => g.chase).slice(0, 5).map((g) => ({ name: g.key.length > 26 ? g.key.slice(0, 25) + "…" : g.key, full: g.key, total: g.chase, nopw: g.by.no_password + g.by.never_signed_in, web: g.by.website_only, old: g.by.old_app + g.by.app_not_used }))}
                segs={[{ key: "nopw", label: "No password", color: STATUS.no_password.color }, { key: "web", label: "Website only", color: STATUS.website_only.color }, { key: "old", label: "Old app", color: STATUS.old_app.color }]}
                onPick={(n) => { const g = byRm.find((x) => x.key === n || (x.key.length > 26 && x.key.slice(0, 25) + "…" === n)); if (g) { setRm(g.key); setSrc(null); setBucket(null); setFilter("all"); toClients() } }} />
              <p className="mt-2 text-xs text-muted-foreground">{fmtNum(byRm.reduce((t, g) => t + g.chase, 0))} clients to chase in all, across {fmtNum(byRm.filter((g) => g.chase).length)} people; these five hold {fmtNum(byRm.filter((g) => g.chase).slice(0, 5).reduce((t, g) => t + g.chase, 0))} of them.</p>
            </Panel>
                </div>
              </div>
            </>)
          })()}

          <Panel title="By source" description={`Where each client came from, as recorded in Zoho CRM: the source bucket (Investor Source Bucket) and, inside it, the lead source (Investor Source). "Never signed in" is the clients who have not signed in to myQode at all. Counted in clients, so the Total row is the ${fmtNum(S.clients)} above. Click a row to see the names.`} bodyClassName="p-0">
            {(() => {
              const real = byBucket.filter((g) => last(g.key) === 0), top = real[0]
              const neverTop = [...real].filter((g) => g.never).sort((a, b) => b.never - a.never).slice(0, 2)
              const big = real.filter((g) => g.clients.length >= 10)
              const best = [...big].sort((a, b) => b.hasApp / b.clients.length - a.hasApp / a.clients.length)[0], worst = [...big].sort((a, b) => a.hasApp / a.clients.length - b.hasApp / b.clients.length)[0]
              const gaps = byBucket.filter((g) => last(g.key) > 0).reduce((t, g) => t + g.clients.length, 0)
              return (
                <div className="border-b border-[#02422B]/10 bg-white/60 px-4 py-3 text-sm text-[#002017]">
                  <p className="font-semibold">In short</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
                    <li><b>How to read it:</b> each shaded row is a source bucket and is the total of the lead sources listed under it. Read across a row to see where those clients stand on myQode; each client is counted once.</li>
                    {top ? <li><b>Where clients came from:</b> {real.slice(0, 3).map((g) => `${g.key} ${fmtNum(g.clients.length)}`).join(", ")}{real.length > 3 ? `, and ${fmtNum(real.slice(3).reduce((t, g) => t + g.clients.length, 0))} from ${real.length - 3 === 1 ? "one other bucket" : `${real.length - 3} other buckets`}` : ""}.</li> : null}
                    {neverTop.length ? <li><b>Never signed in:</b> {fmtNum(S.neverSignedInAll)} of {fmtNum(S.clients)} clients. {neverTop.map((g) => `${fmtNum(g.never)} are ${g.key}`).join(" and ")}{S.neverSignedInAll - neverTop.reduce((t, g) => t + g.never, 0) > 0 ? `; the other ${fmtNum(S.neverSignedInAll - neverTop.reduce((t, g) => t + g.never, 0))} are spread across the rest` : ""}.</li> : null}
                    {S.hasApp ? <li><b>Who the {fmtNum(S.hasApp)} with the app are:</b> {[...bySrc].filter((g) => g.hasApp).sort((x, y) => y.hasApp - x.hasApp).slice(0, 4).map((g) => `${g.key} ${fmtNum(g.hasApp)} (${pct(g.hasApp, S.hasApp)})`).join(", ")}; the rest come from the other sources.</li> : null}
                    {best && worst && best.key !== worst.key ? <li><b>Phone app:</b> {best.key} clients have it most ({pct(best.hasApp, best.clients.length)}), {worst.key} least ({pct(worst.hasApp, worst.clients.length)}); across all clients it is {pct(S.hasApp, S.clients)}.</li> : null}
                    {gaps ? <li><b>Gaps in Zoho:</b> {fmtNum(gaps)} {gaps === 1 ? "client has" : "clients have"} no bucket or no Zoho record, shown at the bottom of the table.</li> : null}
                  </ul>
                </div>)
            })()}
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Source bucket and lead source</TableHead><TableHead className="text-right">Clients</TableHead><TableHead className="text-right">Never signed in</TableHead>
                {ORDER.filter((s) => statusCount[ORDER.indexOf(s)]).map((s) => <TableHead key={s} className="text-right">{SHORT[s]}</TableHead>)}
                <TableHead className="text-right">Have the app</TableHead><TableHead className="text-right">Share of the {fmtNum(S.hasApp)} with the app</TableHead><TableHead className="text-right">Used, last {d.days} days</TableHead>
                <TableHead className="text-right">Avg days used</TableHead><TableHead className="text-right">Assets</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {byBucket.flatMap((bk) => [{ g: bk as Group, isBucket: true }, ...(bk.sources.length > 1 || bk.sources[0]?.key !== bk.key ? bk.sources.map((g) => ({ g, isBucket: false })) : [])].map(({ g, isBucket }) => {
                  const on = isBucket ? bucket === g.key && !src : src === g.key && bucket === bk.key
                  return (
                    <TableRow key={bk.key + "|" + (isBucket ? "" : g.key)} className={cn("cursor-pointer", isBucket ? "border-t-2 border-t-[#02422B]/40 bg-[#02422B]/10 font-semibold hover:bg-[#02422B]/15" : "hover:bg-[#EFECD3]/50", on && (isBucket ? "bg-[#02422B]/20" : "bg-[#EFECD3]"))}
                      onClick={() => { setBucket(on ? null : bk.key); setSrc(on || isBucket ? null : g.key); setRm(null); toClients() }}>
                      <TableCell className={cn("text-[#002017]", isBucket ? "border-l-4 border-l-[#02422B] font-bold" : "pl-8 font-normal")}>{g.key}{isBucket ? <span className="ml-2 text-xs font-medium text-[#02422B]/70">bucket total</span> : null}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtNum(g.clients.length)}</TableCell>
                      <TableCell className="text-right tabular-nums" title="See these clients" onClick={(e) => { if (!g.never) return; e.stopPropagation(); setBucket(bk.key); setSrc(isBucket ? null : g.key); setRm(null); setFilter("never_in"); toClients() }}>{g.never ? <span className="font-semibold text-[#b42318] underline decoration-dotted underline-offset-2">{fmtNum(g.never)} <span className="text-xs font-normal text-muted-foreground">{pct(g.never, g.clients.length)}</span></span> : <span className="text-muted-foreground">0</span>}</TableCell>
                      {ORDER.filter((s) => statusCount[ORDER.indexOf(s)]).map((s) => <TableCell key={s} className={cn("text-right tabular-nums", isBucket ? "font-bold" : "font-normal")}>{g.by[s] ? <>{fmtNum(g.by[s])} <span className="text-xs text-muted-foreground">{pct(g.by[s], g.clients.length)}</span></> : <span className="text-muted-foreground">0</span>}</TableCell>)}
                      <TableCell className={cn("text-right tabular-nums", isBucket ? "font-bold" : "font-normal")}>{fmtNum(g.hasApp)} <span className="text-xs text-muted-foreground">{pct(g.hasApp, g.clients.length)}</span></TableCell>
                      <TableCell className={cn("text-right tabular-nums text-[#02422B]", isBucket ? "font-bold" : "font-semibold")}>{g.hasApp ? pct(g.hasApp, S.hasApp) : <span className="font-normal text-muted-foreground">0%</span>}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", isBucket ? "font-bold" : "font-normal")}>{fmtNum(g.used)} <span className="text-xs text-muted-foreground">{pct(g.used, g.clients.length)}</span></TableCell>
                      <TableCell className={cn("text-right tabular-nums", isBucket ? "font-bold" : "font-normal")}>{g.avgDays == null ? <span className="text-muted-foreground">–</span> : g.avgDays.toFixed(1)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", isBucket ? "font-bold" : "font-normal")}>{crore(g.aum)}</TableCell>
                    </TableRow>
                  )
                }))}
                <TableRow className="border-t-2 border-[#02422B]/30 bg-[#F9F7EC] font-semibold">
                  <TableCell>Total</TableCell><TableCell className="text-right tabular-nums">{fmtNum(S.clients)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(S.neverSignedInAll)} <span className="text-xs font-normal text-muted-foreground">{pct(S.neverSignedInAll, S.clients)}</span></TableCell>
                  {ORDER.filter((s) => statusCount[ORDER.indexOf(s)]).map((s) => <TableCell key={s} className="text-right tabular-nums">{fmtNum(statusCount[ORDER.indexOf(s)])} <span className="text-xs font-normal text-muted-foreground">{statusShare[ORDER.indexOf(s)]}%</span></TableCell>)}
                  <TableCell className="text-right tabular-nums">{fmtNum(S.hasApp)} <span className="text-xs font-normal text-muted-foreground">{pct(S.hasApp, S.clients)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">100%</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(S.usedPeriod)} <span className="text-xs font-normal text-muted-foreground">{pct(S.usedPeriod, S.clients)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{(() => { const n = d.clients.filter((c) => c.newApp); return n.length ? (n.reduce((t, c) => t + c.daysUsed, 0) / n.length).toFixed(1) : "–" })()}</TableCell>
                  <TableCell className="text-right tabular-nums">{crore(d.clients.reduce((t, c) => t + c.aum, 0))}</TableCell>
                </TableRow>
              </TableBody>
            </Table></div>
            <p className="px-4 py-3 text-xs text-muted-foreground">A client is matched to their Zoho record by login email, then the record&apos;s other email, then name. &quot;Never signed in&quot; is the &quot;No password&quot; and &quot;Family, seen by head&quot; columns together, plus anyone who set a password but never signed in. &quot;Share of the {fmtNum(S.hasApp)} with the app&quot; is, of every client who has the phone app, the part that came from that bucket or source; the bucket rows add up to 100%. &quot;Avg days used&quot; is the average number of days in the last {d.days} that clients on the new app opened it. Assets are the latest portfolio value.</p>
          </Panel>

          <div><Button size="sm" variant="outline" className="bg-white" onClick={() => setShowTables(!showTables)}>{showTables ? "Hide the relationship-manager table" : "Show the relationship-manager figures as a table"}</Button></div>
          {showTables ? <>
          <div>
            <Panel title="Who should call them" description="Clients still to chase (no password, website only, or on the old app), by their relationship manager in Zoho: RM 1, or the record's owner when RM 1 is blank. Clients who came through a distributor are not in this table. Click a row to see that person's list." bodyClassName="p-0">
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead>Relationship manager</TableHead><TableHead className="text-right">Clients</TableHead><TableHead className="text-right">To chase</TableHead><TableHead className="text-right">No password</TableHead><TableHead className="text-right">Website only</TableHead><TableHead className="text-right">Old app</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(allRms ? byRm : byRm.slice(0, 10)).map((g) => (
                    <TableRow key={g.key} className={cn("cursor-pointer hover:bg-[#EFECD3]/50", rm === g.key && "bg-[#EFECD3]/70")} onClick={() => { setRm(rm === g.key ? null : g.key); setSrc(null); setBucket(null); setFilter("all"); toClients() }}>
                      <TableCell className="font-medium text-[#002017]">{g.key}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(g.clients.length)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtNum(g.chase)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(g.by.no_password + g.by.never_signed_in)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(g.by.website_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(g.by.old_app + g.by.app_not_used)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-[#02422B]/30 bg-[#F9F7EC] font-semibold">
                    <TableCell>Total, {fmtNum(byRm.length)} people</TableCell><TableCell className="text-right tabular-nums">{fmtNum(byRm.reduce((t, g) => t + g.clients.length, 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(byRm.reduce((t, g) => t + g.chase, 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(byRm.reduce((t, g) => t + g.by.no_password + g.by.never_signed_in, 0))}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(byRm.reduce((t, g) => t + g.by.website_only, 0))}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(byRm.reduce((t, g) => t + g.by.old_app + g.by.app_not_used, 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table></div>
              {byRm.length > 10 ? <div className="px-4 py-3"><Button size="sm" variant="outline" className="bg-white" onClick={() => setAllRms(!allRms)}>{allRms ? "Show the top 10" : `Show all ${fmtNum(byRm.length)}`}</Button></div> : null}
            </Panel>
          </div>
          </> : null}
        </> : <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Zoho CRM could not be read just now, so lead source and relationship manager are missing from this page. Press Refresh to try again.</p>}

        {/* 4. Every client */}
        <div id="clients" className="scroll-mt-4">
          <Panel title="Every client" description="Click a client to see everything they did: what they opened, sign-ins, and notifications sent to them."
            action={<div className="flex flex-wrap justify-end gap-2">
              {remindable && maySend && rem ? <Button size="sm" className="bg-[#02422B] text-white hover:bg-[#02422B]/90" onClick={() => openReminder(remindable)}><Send className="h-4 w-4" />Send reminder to this group</Button> : null}
              <Button size="sm" variant="outline" className="bg-white" onClick={exportList} disabled={!list.length}><Download className="h-4 w-4" />Download this list</Button>
            </div>} bodyClassName="p-0">
            <div className="space-y-3 border-b border-[#02422B]/10 p-4">
              <div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => { setQ(e.target.value); setShown(50) }} placeholder="Search name, email or account" className="bg-white pl-9" /></div>
              {src || bucket || rm ? <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Showing only</span>
                {bucket ? <button type="button" onClick={() => setBucket(null)} className="rounded-full bg-[#02422B] px-3 py-1 font-medium text-white">Source bucket: {bucket} ✕</button> : null}
                {src ? <button type="button" onClick={() => setSrc(null)} className="rounded-full bg-[#02422B] px-3 py-1 font-medium text-white">Source: {src} ✕</button> : null}
                {rm ? <button type="button" onClick={() => setRm(null)} className="rounded-full bg-[#02422B] px-3 py-1 font-medium text-white">RM: {rm} ✕</button> : null}
              </div> : null}
              <div className="flex flex-wrap gap-1.5">
                {filters.map((f) => { const n = d.clients.filter((c) => f.test(c) && (!src || sourceOf(c) === src) && (!bucket || bucketOf(c) === bucket) && (!rm || rmOf(c) === rm)).length; if ((!n || (f.card && filter !== f.key)) && f.key !== "all") return null
                  return <button key={f.key} type="button" onClick={() => { setFilter(f.key); setShown(50) }}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f.key ? "border-[#02422B] bg-[#02422B] text-white" : "border-[#02422B]/15 bg-white text-[#002017] hover:border-[#02422B]/40")}>
                    {f.label} <span className={filter === f.key ? "text-[#DABD38]" : "text-muted-foreground"}>{fmtNum(n)}</span></button> })}
              </div>
            </div>
            {list.length ? <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Client</TableHead><TableHead>Where they stand</TableHead><TableHead>Phone</TableHead><TableHead>Last opened</TableHead>
                  <TableHead className="text-right">Days used</TableHead><TableHead>Looks at most</TableHead><TableHead>Phone alerts</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.slice(0, shown).map((c) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-[#EFECD3]/50" onClick={() => setOpen(c)}>
                      <TableCell><p className="max-w-[15rem] truncate font-medium text-[#002017]">{c.name}</p><p className="max-w-[15rem] truncate text-xs text-muted-foreground">{c.accounts.join(" · ")}</p>
                        {d.zoho ? <p className="max-w-[15rem] truncate text-xs text-muted-foreground" title={`${bucketOf(c)} · ${sourceOf(c)} · ${keeper(c)}`}>{sourceOf(c)} · {keeper(c)}</p> : null}</TableCell>
                      <TableCell><Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>{c.locked ? <Pill tone="red" className="ml-1">Locked</Pill> : null}
                        {c.familyHead ? <span className="mt-1 block text-xs text-muted-foreground">Family head: {c.familyHead}</span> : null}
                        {c.remindedAt ? <span className="mt-1 block text-xs text-muted-foreground">Reminded {fmtRelative(c.remindedAt)}</span> : null}</TableCell>
                      <TableCell className="text-sm">{c.hasApp ? <>{phoneType(c)}<span className={cn("block text-xs", isNew(c) ? "text-muted-foreground" : "text-amber-700")}>{isNew(c) ? "New app" : "Old app, needs to update"}</span></> : <span className="text-muted-foreground">No app</span>}</TableCell>
                      {/* Last opened counts the website too: say where, and when the phone app itself was last opened */}
                      <TableCell className="text-sm">{c.lastUsed ? <>{fmtRelative(c.lastUsed)}
                        <span className="block text-xs text-muted-foreground">{c.lastUsedApp && c.lastUsedApp >= c.lastUsed ? "on the app"
                          : c.hasApp ? `on the website · app ${c.lastUsedApp ? fmtRelative(c.lastUsedApp) : "not opened"}` : "on the website"}</span></>
                        : <span className="text-muted-foreground">Never</span>}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{c.daysUsed ? `${c.daysUsed} of ${d.days}` : <span className="text-muted-foreground">0</span>}</TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm" title={c.topPages.join(", ")}>{c.topPages.length ? c.topPages.join(", ") : <span className="text-muted-foreground">–</span>}</TableCell>
                      <TableCell className="text-sm">
                        {!isNew(c) ? <span className="text-muted-foreground">{alerts(c)}</span> : c.notificationsOn ? <span className="inline-flex items-center gap-1 text-emerald-700"><Bell className="h-3.5 w-3.5" />On</span> : <span className="inline-flex items-center gap-1 text-amber-700"><BellOff className="h-3.5 w-3.5" />Off</span>}
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
          <Panel title="What clients look at" description={`Pages opened in the new phone app or on the website in the last ${d.days} days, by the ${fmtNum(S.usedPeriod)} clients who used myQode in that time. A client counts once per page.`}>
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

          <Panel title="Notifications we sent" description={`Last ${d.days} days, counted in clients. "Reached the phone" means it popped up on their phone, which needs a phone registered for alerts (${fmtNum(S.phoneAlerts)} clients today). For everyone else it sits in the in-app inbox. "In all" appears where some clients got it more than once, for example one per account. Click a row to see who got it.`} bodyClassName="p-0">
            {d.notifications.length ? <Table>
              <TableHeader><TableRow><TableHead>Notification</TableHead><TableHead className="text-right">Sent to</TableHead><TableHead className="text-right">Reached the phone</TableHead><TableHead className="text-right">Read it</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.notifications.slice(0, 15).map((n) => (
                  <TableRow key={n.key} className="cursor-pointer hover:bg-[#EFECD3]/50" onClick={() => setNote(n)}>
                    <TableCell className="whitespace-normal"><p className="font-medium text-[#002017]">{n.title}</p><p className="text-xs text-muted-foreground">{n.kind} · last sent {fmtShortDay(istDay(n.lastSent))}{n.sent > n.clients ? ` · ${fmtNum(n.sent)} in all` : ""}</p></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(n.clients)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(n.reachedPhone)} <span className="text-xs text-muted-foreground">{pct(n.reachedPhone, n.clients)}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(n.read)} <span className="text-xs text-muted-foreground">{pct(n.read, n.clients)}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table> : <EmptyState title="No notifications sent in this period" />}
          </Panel>
        </div>

        {rem?.history.length ? <Panel title="Reminders sent" description="Each time a group was reminded, and by whom.">
          <ul className="space-y-1.5 text-sm">
            {rem.history.map((h, i) => <li key={i} className="flex flex-wrap justify-between gap-2"><span><b className="text-[#002017]">{rem.kinds[h.kind]?.group ?? h.kind}</b> · {fmtNum(h.recipients)} clients · &quot;{h.subject}&quot;</span><span className="text-xs text-muted-foreground">{fmtDate(h.at)} · {h.by}</span></li>)}
          </ul>
        </Panel> : null}

        <p className="text-xs text-muted-foreground">
          <KeyRound className="mr-1 inline h-3.5 w-3.5" />
          How this is counted: a client is an owner with an open account, counted once even with several accounts; these are the Admin Dashboard&apos;s owners, without those who closed every account and Qode&apos;s test accounts. A few family members share one login email: each is counted as a client and shows that login&apos;s password, phone and activity. Qode staff and partners are left out. &quot;Has the phone app&quot; means they signed in from it at least once; we cannot see installs that never signed in. For a few clients on the old app the phone type is not recorded. There are two kinds of app: the &quot;new app&quot; is version {d.newAppVersion}, and the &quot;old app&quot; is everything before it. Updated {fmtRelative(d.generatedAt)}.
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
                <p className="mt-2 text-muted-foreground">{open.familyHead ? `Family head: ${open.familyHead}. ` : ""}{STATUS[open.status].meaning} <span className="font-medium text-[#02422B]">{STATUS[open.status].action}</span></p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {[...(d?.zoho ? [["Source bucket (Zoho)", bucketOf(open)], ["Lead source (Zoho)", sourceOf(open)], ...(isDist(open) ? [] : [["Relationship manager", rmOf(open)]]), ...(open.partner ? [["Partner", open.partner]] : [])] : []), ["Assets with Qode", crore(open.aum)], ["Phone", phone(open)], ["Last opened", open.lastUsed ? fmtRelative(open.lastUsed) : "Never"], ["Password", open.passwordSet ? `Set${open.passwordSetAt ? ` on ${fmtDate(open.passwordSetAt)}` : ""}` : "Not set"],
                    ["Days used", `${open.daysUsed} of the last ${d?.days}`], ["Phone alerts", alerts(open)],
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
                : !log.length ? <EmptyState title="Nothing recorded yet" description={open.hasApp && !isNew(open) ? "This client is on the old app, which does not record activity. It will appear once they update." : "This client has not used myQode in the last 60 days."} />
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

      {/* Send a reminder to one group */}
      <Dialog open={!!kind} onOpenChange={(v) => { if (!v && sending !== "send") setKind(null) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          {kind && rem ? <>
            <DialogHeader>
              <DialogTitle>Send a reminder: {rem.kinds[kind].group}</DialogTitle>
              <DialogDescription>
                {rem.kinds[kind].channel === "email"
                  ? "Goes as an email from Qode Investor Relations (investor.relations@qodeinvest.com). These clients cannot get a phone alert, because they do not have the new app."
                  : "Goes as an alert on the phone and into the in-app inbox, to clients on the new app who have notifications switched on."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border border-[#02422B]/15 bg-[#F9F7EC] p-3 text-sm">
                {preview ? <>
                  <b className="text-[#002017]">{fmtNum(preview.recipients)} {rem.kinds[kind].channel === "email" ? "emails" : "phone alerts"}</b> will go out.
                  {preview.sharing ? <> {fmtNum(preview.sharing)} more clients in this group share a login email with a family member, so they get one between them.</> : null}
                  {preview.skipped ? <> {fmtNum(preview.skipped)} more are left out because they were already reminded in the last {rem.cooldownDays} days.</> : null}
                  {preview.names.length ? <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">See who</summary><p className="mt-1">{preview.names.join(", ")}</p></details> : null}
                </> : <Skeleton className="h-5 w-64" />}
              </div>
              <label className="block text-xs font-medium text-muted-foreground">{rem.kinds[kind].channel === "email" ? "Subject" : "Title"}
                <Input value={subject} maxLength={90} onChange={(e) => { setSubject(e.target.value); setTested(false); setConfirm(false) }} className="mt-1 bg-white text-sm text-[#002017]" /></label>
              <label className="block text-xs font-medium text-muted-foreground">{rem.kinds[kind].channel === "email" ? "Message (the email starts with Dear and the client's name; the buttons and the IR signature are added below your text)" : "Message (up to 300 characters)"}
                <textarea value={message} maxLength={rem.kinds[kind].channel === "email" ? 2000 : 300} rows={rem.kinds[kind].channel === "email" ? 9 : 3} onChange={(e) => { setMessage(e.target.value); setTested(false); setConfirm(false) }}
                  className="mt-1 w-full rounded-md border border-input bg-white p-3 text-sm text-[#002017]" /></label>
              {rem.kinds[kind].channel === "email" ? <div>
                <div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">How the email looks</p>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={refreshPreview} disabled={sending !== null}><RefreshCw className={cn("h-3.5 w-3.5", sending === "preview" && "animate-spin")} />Update preview</Button></div>
                {preview?.html ? <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="mt-1 h-80 w-full rounded-lg border border-[#02422B]/15 bg-white" /> : <Skeleton className="mt-1 h-80 w-full" />}
              </div> : null}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#02422B]/10 pt-3">
                <Button variant="outline" onClick={sendTest} disabled={sending !== null || !subject.trim() || !message.trim()}><Send className="h-4 w-4" />{sending === "test" ? "Sending the test…" : "1. Send a test to me"}</Button>
                {!confirm
                  ? <Button className="bg-[#02422B] text-white hover:bg-[#02422B]/90" onClick={() => setConfirm(true)} disabled={sending !== null || !tested || !preview?.recipients}>2. Send to {fmtNum(preview?.recipients ?? 0)} clients</Button>
                  : <span className="flex flex-wrap items-center gap-2 text-sm"><span className="text-red-700">This goes to {fmtNum(preview?.recipients ?? 0)} clients and cannot be undone.</span>
                      <Button variant="outline" onClick={() => setConfirm(false)} disabled={sending !== null}>Cancel</Button>
                      <Button className="bg-red-700 text-white hover:bg-red-800" onClick={sendAll} disabled={sending !== null}>{sending === "send" ? "Sending…" : "Yes, send it"}</Button></span>}
              </div>
              {!tested ? <p className="text-xs text-muted-foreground">Send a test to yourself first and read it. The send button unlocks after that. Changing the text asks for a new test.</p> : null}
            </div>
          </> : null}
        </DialogContent>
      </Dialog>

      {/* Who received one notification */}
      <Dialog open={!!note} onOpenChange={(v) => { if (!v) setNote(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {note ? <>
            <DialogHeader>
              <DialogTitle>{note.title}</DialogTitle>
              <DialogDescription>Sent to {fmtNum(note.clients)} clients in the last {d?.days} days · reached the phone of {fmtNum(note.reachedPhone)} · read by {fmtNum(note.read)}{note.sent > note.clients ? ` · ${fmtNum(note.sent)} notifications in all` : ""}</DialogDescription>
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
