"use client"

// Notifications: write anything, send it to your own phone, then publish it to clients (popup + the app's inbox).
// API: /api/admin/bo/notifications (lib/appNotify.ts). Publishing asks for confirmation with the exact recipient
// count (a dry run) first. The automatic money / portfolio / reading notifications are separate and stay off
// until PUSH_LIVE=1 on the server.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Bell, CheckCircle2, Globe, RefreshCw, Send, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EmptyState, ErrorNote, KpiCard, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDateTime, fmtNum } from "@/components/admin-kit"

type Stats = { total: number; delivered: number; inFlight: number; failed: number; noDevice: number; muted: number; read: number }
type Campaign = { id: number; title: string; body: string; link: string | null; category: string; audience: { type: string; value: unknown }; createdBy: string; createdAt: string; recipients: number; stats: Stats }
type Overview = {
  ready: boolean; live: boolean; testEmails: string[]; everyone?: number; strategies?: string[]
  devices?: { active: number; logins: number; ios: number; android: number }
  outbox?: { pending: number; failed24h: number; created24h: number }
  campaigns: Campaign[]
}

const DESTINATIONS: [string, string][] = [
  ["tab:home", "Home"], ["tab:portfolio", "Performance"], ["page:newsletters", "Newsletters and perspectives"],
  ["tab:reports", "Reports"], ["page:transactions", "Transactions"], ["tab:docs", "Documents"],
  ["tab:services", "Account services"], ["sheet:add", "Add funds"], ["url", "A web page (link)"],
]
const CATEGORIES: [string, string][] = [["updates", "Announcement"], ["reading", "Reading from Qode"], ["portfolio", "Portfolio update"]]
const TEMPLATES = [
  { label: "What Qode is reading", title: "What Qode is reading this week", body: "A few pieces our fund managers found worth your time. Tap to read.", dest: "url", category: "reading" },
  { label: "New newsletter", title: "Our latest newsletter is here", body: "Markets, strategy updates and what changed in the portfolios this month.", dest: "page:newsletters", category: "reading" },
  { label: "Announcement", title: "", body: "", dest: "tab:home", category: "updates" },
]
const cleanStrategy = (s: string) => s.replace(/^QODE ADVISORS LLP\s*-\s*/i, "")
const audienceText = (a: Campaign["audience"]) =>
  a.type === "test" ? "Test (you)" : a.type === "all" ? "Everyone" : a.type === "strategy" ? cleanStrategy(String(a.value || "")) : `${(a.value as string[] | null)?.length ?? 0} clients`
const destText = (link: string | null) =>
  !link ? "Home" : link.startsWith("url:") ? link.slice(4) : DESTINATIONS.find(([k]) => k === link)?.[1] ?? link

export default function AdminNotificationsPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [dest, setDest] = useState("tab:home")
  const [url, setUrl] = useState("")
  const [category, setCategory] = useState("updates")
  const [audience, setAudience] = useState<"all" | "strategy" | "emails">("all")
  const [strategy, setStrategy] = useState("")
  const [emails, setEmails] = useState("")
  const [busy, setBusy] = useState<"" | "test" | "count" | "publish">("")
  const [confirm, setConfirm] = useState<{ recipients: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setData(await boFetch<Overview>("/api/admin/bo/notifications")) }
    catch (e) { setError(errorMessage(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const link = dest === "url" ? (url.trim() ? "url:" + url.trim() : "") : dest
  const problem = useMemo(() => {
    if (!title.trim()) return "Add a title"
    if (title.length > 90) return "Title is too long (90 characters)"
    if (!body.trim()) return "Write the message"
    if (body.length > 300) return "Message is too long (300 characters)"
    if (dest === "url" && !/^https:\/\/\S+\.\S+$/i.test(url.trim())) return "Add a web link starting with https://"
    return ""
  }, [title, body, dest, url])
  const audienceProblem = audience === "strategy" && !strategy ? "Choose a strategy" : audience === "emails" && !emails.trim() ? "Add at least one email" : ""

  const payload = (type: string) => ({
    title: title.trim(), body: body.trim(), link: link || null, category,
    audience: { type, value: type === "strategy" ? strategy : type === "emails" ? emails : undefined },
  })

  async function sendTest() {
    if (problem) return
    setBusy("test")
    try {
      await boFetch("/api/admin/bo/notifications", { method: "POST", json: payload("test") })
      toast.success("Sent to your phone. It should pop up within a few seconds.")
      load()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy("") }
  }

  async function askPublish() {
    if (problem || audienceProblem) return
    setBusy("count")
    try {
      const r = await boFetch<{ recipients: number }>("/api/admin/bo/notifications", { method: "POST", json: { ...payload(audience), dryRun: true } })
      setConfirm({ recipients: r.recipients })
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy("") }
  }

  async function publish() {
    setBusy("publish")
    try {
      const r = await boFetch<{ recipients: number }>("/api/admin/bo/notifications", { method: "POST", json: payload(audience) })
      toast.success(`Published to ${fmtNum(r.recipients)} ${r.recipients === 1 ? "person" : "people"}.`)
      setConfirm(null); setTitle(""); setBody(""); setUrl("")
      load()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy("") }
  }

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => { setTitle(t.title); setBody(t.body); setDest(t.dest); setCategory(t.category) }
  const d = data

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Popups on clients' phones, also kept in the app's inbox under the bell. Send a test to your own phone first, then publish."
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button>}
      />
      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      {loading && !d ? <Skeleton className="h-24 w-full" /> : d && !d.ready ? (
        <ErrorNote message="The notification tables aren't created on the server yet." />
      ) : d ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Reach" value={fmtNum(d.everyone ?? 0)} hint="people who use the app" icon={<Bell className="h-4 w-4" />} accent />
          <KpiCard label="Phones registered" value={fmtNum(d.devices?.active ?? 0)} hint={`${fmtNum(d.devices?.ios ?? 0)} iPhone · ${fmtNum(d.devices?.android ?? 0)} Android`} icon={<Smartphone className="h-4 w-4" />} />
          <KpiCard label="Sent in the last 24 hours" value={fmtNum(d.outbox?.created24h ?? 0)} hint={`${fmtNum(d.outbox?.pending ?? 0)} waiting · ${fmtNum(d.outbox?.failed24h ?? 0)} failed`} icon={<Send className="h-4 w-4" />} />
          <KpiCard label="Automatic notifications" value={d.live ? "On" : "Off"} hint={d.live ? "Money, portfolio and reading go to clients" : "Money, portfolio and reading: off until PUSH_LIVE=1"} icon={<CheckCircle2 className="h-4 w-4" />} />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="New notification" description="Anything you want clients to know. Tapping it opens the destination you choose.">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Start from:</span>
              {TEMPLATES.map((t) => <Button key={t.label} size="sm" variant="outline" onClick={() => applyTemplate(t)}>{t.label}</Button>)}
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#002017]">Title <span className="text-muted-foreground">({title.length}/90)</span></span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What Qode is reading this week" className="bg-white" maxLength={90} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#002017]">Message <span className="text-muted-foreground">({body.length}/300)</span></span>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What should clients know?" className="bg-white" maxLength={300} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#002017]">Tapping it opens</span>
                <select value={dest} onChange={(e) => setDest(e.target.value)} className="h-9 w-full rounded-md border bg-white px-3 text-sm">
                  {DESTINATIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#002017]">Kind</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-full rounded-md border bg-white px-3 text-sm">
                  {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <span className="block text-[11px] text-muted-foreground">Clients who turned this kind off in the app don't get the popup.</span>
              </label>
            </div>
            {dest === "url" ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#002017]">Web link</span>
                <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" />
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="bg-white" /></div>
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 border-t border-[#02422B]/10 pt-4">
              <Button variant="outline" onClick={sendTest} disabled={!!problem || !!busy}>
                <Smartphone className="h-4 w-4" />{busy === "test" ? "Sending…" : "Send test to my phone"}
              </Button>
              {problem ? <span className="text-xs text-muted-foreground">{problem}</span> : null}
            </div>

            <div className="space-y-3 rounded-lg border border-[#02422B]/15 bg-white/60 p-4">
              <p className="text-sm font-semibold text-[#002017]">Publish to clients</p>
              <div className="flex flex-wrap gap-2">
                {([["all", `Everyone on the app${d?.everyone ? ` (${fmtNum(d.everyone)})` : ""}`], ["strategy", "One strategy"], ["emails", "Chosen clients"]] as const).map(([k, l]) => (
                  <Button key={k} size="sm" variant={audience === k ? "default" : "outline"} onClick={() => setAudience(k)}>{l}</Button>
                ))}
              </div>
              {audience === "strategy" ? (
                <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="h-9 w-full rounded-md border bg-white px-3 text-sm">
                  <option value="">Choose a strategy</option>
                  {(d?.strategies ?? []).map((s) => <option key={s} value={s}>{cleanStrategy(s)}</option>)}
                </select>
              ) : null}
              {audience === "emails" ? (
                <Textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={2} placeholder="one@example.com, two@example.com" className="bg-white" />
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={askPublish} disabled={!!problem || !!audienceProblem || !!busy}>
                  <Send className="h-4 w-4" />{busy === "count" ? "Counting…" : "Publish…"}
                </Button>
                {audienceProblem && !problem ? <span className="text-xs text-muted-foreground">{audienceProblem}</span> : null}
                <span className="text-xs text-muted-foreground">You'll see exactly how many people it goes to before it's sent.</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Preview" description="How it appears on a phone">
          <div className="rounded-2xl bg-stone-900/5 p-3">
            <div className="rounded-xl bg-white/90 p-3 shadow-sm">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-[#02422B] font-serif text-[11px] text-[#DABD38]">Q</span>
                <span className="flex-1 font-medium tracking-wide">MYQODE</span><span>now</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-[#111]">{title || "Title"}</p>
              <p className="text-sm text-stone-700">{body || "Your message"}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Opens: {destText(link)}</p>
        </Panel>
      </div>

      <Panel title="Sent" description="Delivered means Apple or Google accepted it for the phone. Inbox only: the person has no phone registered, so they'll see it under the bell." bodyClassName="p-0">
        {d && d.campaigns.length ? (
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Notification</TableHead><TableHead>To</TableHead>
              <TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Read</TableHead><TableHead className="text-right">Inbox only</TableHead><TableHead className="text-right">Failed</TableHead><TableHead>By</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {d.campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(c.createdAt)}</TableCell>
                  <TableCell className="max-w-[360px]"><p className="truncate text-sm font-medium">{c.title}</p><p className="truncate text-xs text-muted-foreground">{c.body}</p><p className="truncate text-[11px] text-muted-foreground">Opens {destText(c.link)}</p></TableCell>
                  <TableCell>{c.audience.type === "test" ? <Pill tone="grey">Test</Pill> : <Pill tone="green">{audienceText(c.audience)}</Pill>}<span className="ml-1 text-xs text-muted-foreground">{fmtNum(c.recipients)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(c.stats.delivered)}{c.stats.inFlight ? <span className="text-xs text-muted-foreground"> +{c.stats.inFlight} sending</span> : null}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(c.stats.read)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(c.stats.noDevice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.stats.failed ? <span className="text-red-700">{fmtNum(c.stats.failed)}</span> : "0"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.createdBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <EmptyState title="Nothing sent yet" description="Your first test will show here." icon={<Bell className="h-5 w-5" />} />}
      </Panel>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o && busy !== "publish") setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {fmtNum(confirm?.recipients ?? 0)} {confirm?.recipients === 1 ? "person" : "people"}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title.trim()}” goes to their phones now (popups are held until 9 am if it's night in India) and into their inbox in the app. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "publish"}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); publish() }} disabled={busy === "publish"}>
              {busy === "publish" ? "Publishing…" : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
