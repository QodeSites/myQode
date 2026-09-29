"use client"

// App analytics: one page for business decisions — acquisition, activation, engagement, retention, sign-in health,
// devices and notifications, for any period. Data: GET /api/admin/bo/analytics. Each section can be exported as CSV,
// and "Download everything" gives one CSV per section in a single click.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Activity, Download, KeyRound, LogIn, RefreshCw, Smartphone, Timer, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorNote, KpiCard, PageHeader, Panel, Pill, boFetch, errorMessage, fmtNum, fmtShortDay } from "@/components/admin-kit"

const C = { web: "#6b7f78", ios: "#02422B", android: "#DABD38", app: "#9aa5a0", ok: "#02422B", bad: "#b42318", lock: "#DABD38" }
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–")
const secs = (s: number | null | undefined) => (s == null ? "–" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`)
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const shift = (d: string, k: number) => new Date(Date.parse(d + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10)
const LABELS: Record<string, string> = {
  login_success: "Successful sign-ins", login_failed: "Failed sign-ins", lockout: "Accounts locked", otp_sent: "Setup codes sent", otp_verified: "Setup codes verified",
  otp_failed: "Setup codes rejected", password_set: "Passwords set up", password_reset_requested: "Password resets requested",
  password_reset_completed: "Password resets completed", password_changed: "Passwords changed", logout: "Sign-outs",
  wrong_password: "Wrong password", unknown_user: "Unknown email", locked: "Account locked", account_closed: "Account closed", role_mismatch: "Wrong login type",
  no_password_set: "Password not set up yet", rate_limited: "Too many attempts", other: "Other",
}
const label = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows?.length) return ""
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const cell = (v: unknown) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n")
}
function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
const CsvButton = ({ name, rows }: { name: string; rows?: Record<string, unknown>[] | null }) =>
  rows && rows.length ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => downloadCsv(name, rows)}><Download className="h-3.5 w-3.5" />CSV</Button> : null

function Section({ title, description, children, csv }: { title: string; description?: ReactNode; children: ReactNode; csv?: ReactNode }) {
  return <Panel title={title} description={description} action={csv}>{children}</Panel>
}
const Note = ({ children }: { children: ReactNode }) => <p className="mt-3 text-xs text-muted-foreground">{children}</p>
const Chart = ({ children, h = 240 }: { children: ReactNode; h?: number }) => <div style={{ height: h }}><ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer></div>
const axis = { tick: { fontSize: 11, fill: "#6b7280" }, tickLine: false, axisLine: false }

function Funnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const top = steps[0]?.value || 1
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-baseline justify-between text-sm"><span className="font-medium text-[#002017]">{s.label}</span>
            <span className="tabular-nums">{fmtNum(s.value)} <span className="text-xs text-muted-foreground">{i ? `${pct(s.value, top)} of all · ${pct(s.value, steps[i - 1].value)} of previous` : ""}</span></span></div>
          <div className="mt-1 h-2.5 rounded-full bg-[#02422B]/10"><div className="h-2.5 rounded-full bg-[#02422B]" style={{ width: `${Math.max(2, (s.value / top) * 100)}%` }} /></div>
          {s.hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{s.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}

function Bars({ rows, k = "k", v = "users", unit = "users" }: { rows: any[]; k?: string; v?: string; unit?: string }) {
  if (!rows?.length) return <p className="py-4 text-center text-xs text-muted-foreground">No data for this period yet.</p>
  const max = Math.max(...rows.map((r) => r[v] || 0), 1)
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r[k]} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <div className="min-w-0"><p className="truncate">{r[k]}</p><div className="mt-0.5 h-1.5 rounded-full bg-[#02422B]/10"><div className="h-1.5 rounded-full bg-[#DABD38]" style={{ width: `${(r[v] / max) * 100}%` }} /></div></div>
          <span className="tabular-nums text-xs text-muted-foreground">{fmtNum(r[v])} {unit}</span>
        </div>
      ))}
    </div>
  )
}

export default function AdminAppAnalyticsPage() {
  const [to, setTo] = useState(istToday())
  const [from, setFrom] = useState(shift(istToday(), -29))
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setD(await boFetch(`/api/admin/bo/analytics?from=${from}&to=${to}`)) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { load() }, [load])
  const preset = (days: number) => { const t = istToday(); setTo(t); setFrom(shift(t, -(days - 1))) }

  const a = d?.accounts, l = d?.logins, u = d?.usage, au = d?.auth, dv = d?.devices
  const allSessions = useMemo(() => (u?.sessions || []).reduce((t: number, s: any) => t + s.sessions, 0), [u])
  const downloadAll = () => {
    const parts: [string, any[]][] = [
      ["accounts", a ? [a] : []], ["daily-sign-ins", l?.daily], ["sign-ins-by-hour", l?.byHour], ["retention", d?.retention], ["sign-in-events", au?.byEvent],
      ["failed-sign-ins-by-reason", au?.failedByReason], ["sessions", u?.sessions], ["daily-active-users", u?.daily], ["screens", u?.screens], ["features", u?.features],
      ["errors", u?.errors], ["devices-models", dv?.models], ["devices-os", dv?.osVersions], ["devices-app-versions", dv?.appVersions], ["notifications", d?.notifications],
    ]
    parts.forEach(([n2, rows], i) => { if (rows?.length) setTimeout(() => downloadCsv(`myqode-${n2}-${from}-to-${to}`, rows), i * 250) })
  }

  return (
    <div className="space-y-5">
      <PageHeader title="App analytics" description="How the app and web portal are doing, end to end: who signs up, signs in, comes back, and what they use."
        actions={<>
          <Button variant="outline" size="sm" onClick={downloadAll} disabled={!d}><Download className="h-4 w-4" />Download everything (CSV)</Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button>
        </>} />

      <div className="flex flex-wrap items-center gap-2">
        {[[7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([k, t]) => <Button key={k} size="sm" variant="outline" onClick={() => preset(k as number)}>{t}</Button>)}
        <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-[160px] bg-white" />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} className="w-[160px] bg-white" />
      </div>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {loading && !d ? <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div> : null}

      {d ? <>
        {/* Headline */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard accent label="Monthly active users" value={fmtNum(l?.mau)} hint={`${fmtNum(l?.wau)} this week · ${fmtNum(l?.dau)} on ${to}`} icon={<Users className="h-4 w-4" />} />
          <KpiCard label="Unique people signed in" value={fmtNum(l?.users)} hint={`${fmtNum(l?.logins)} sign-ins · avg ${l?.avgDailyUsers ?? 0} people a day`} icon={<LogIn className="h-4 w-4" />} />
          <KpiCard label="App users (ever)" value={fmtNum(a?.app_users)} hint={`${pct(a?.app_users, a?.investors)} of ${fmtNum(a?.investors)} investors · ${fmtNum(a?.new_app_users)} new in period`} icon={<Smartphone className="h-4 w-4" />} />
          <KpiCard label="Average app session" value={secs(Math.round(((u?.sessions || []).filter((s: any) => s.platform !== "web").reduce((t: number, s: any) => t + s.avg_secs * s.sessions, 0)) / Math.max(1, (u?.sessions || []).filter((s: any) => s.platform !== "web").reduce((t: number, s: any) => t + s.sessions, 0))))}
            hint={`${fmtNum(allSessions)} sessions in period, all platforms`} icon={<Timer className="h-4 w-4" />} />
        </div>

        {/* Acquisition */}
        <Section title="Downloads" description="From the App Store and Google Play.">
          <div className="grid gap-3 md:grid-cols-2">
            {([["App Store (iPhone)", d.downloads.appStore], ["Google Play (Android)", d.downloads.playStore]] as const).map(([name, s]: any) => (
              <div key={name} className="rounded-lg border border-[#02422B]/10 bg-white/60 p-3 text-sm">
                <p className="font-medium">{name}</p>
                {s.missing.length ? <><Pill tone="amber">Not connected</Pill><p className="mt-2 text-xs text-muted-foreground">Needs these server settings: {s.missing.join(", ")}.</p></>
                  : <><Pill tone="green">Connected</Pill><p className="mt-2 text-xs text-muted-foreground">Daily downloads are read from the store reports.</p></>}
              </div>
            ))}
          </div>
          <Note>Meanwhile, the closest measure of installs is people signing in to the app for the first time: {fmtNum(a?.new_app_users)} in this period ({fmtNum(a?.ios_users)} iPhone and {fmtNum(a?.android_users)} Android users in total).</Note>
        </Section>

        {/* Activation */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Activation funnel" description="Every investor login, from account to regular use (all time)." csv={<CsvButton name="accounts" rows={a ? [a] : []} />}>
            {a ? <Funnel steps={[
              { label: "Investor logins (accounts)", value: a.investors },
              { label: "Password set up", value: a.password_set, hint: `${fmtNum(a.new_password_setups)} set up in this period` },
              { label: "Signed in at least once", value: a.ever_signed_in },
              { label: "Used the app", value: a.app_users, hint: `${fmtNum(a.web_users)} have used the web portal` },
              { label: "Active in the last 30 days", value: a.active_30d },
            ]} /> : <EmptyState title="No account data" />}
          </Section>
          <Section title="Sign-in health" description={au ? `Every sign-in attempt and setup step, since ${au.since ?? "today"}.` : "Starts recording once the sign-in log is switched on."}
            csv={<CsvButton name="sign-in-events" rows={au?.byEvent} />}>
            {au ? <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="Sign-in success rate" value={au.successRate == null ? "–" : `${au.successRate}%`} icon={<KeyRound className="h-4 w-4" />} />
                <KpiCard label="Failed sign-ins" value={fmtNum(au.byEvent.find((x: any) => x.event === "login_failed")?.n)} />
                <KpiCard label="Setup codes verified" value={`${fmtNum(au.otp.verified)} / ${fmtNum(au.otp.sent)}`} hint={`${fmtNum(au.otp.failed)} rejected`} />
                <KpiCard label="Password resets" value={`${fmtNum(au.passwords.resetCompleted)} / ${fmtNum(au.passwords.resetRequested)}`} hint="completed / requested" />
              </div>
              <p className="mb-1 mt-4 text-xs font-medium">Why sign-ins failed</p>
              <Bars rows={(au.failedByReason || []).map((r: any) => ({ k: `${label(r.reason)} (${r.platform})`, n: r.n }))} v="n" unit="times" />
            </> : <EmptyState title="Recording starts with this release" description="Failed sign-ins, lockouts, setup codes and password resets are logged from the moment the sign-in log goes live." />}
          </Section>
        </div>

        {/* Engagement */}
        <Section title="Daily unique sign-ins" description="People who signed in each day, by where they signed in (India time)." csv={<CsvButton name="daily-sign-ins" rows={l?.daily} />}>
          <Chart h={260}>
            <BarChart data={l?.daily || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#02422B" strokeOpacity={0.08} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtShortDay} {...axis} minTickGap={20} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip labelFormatter={(v) => fmtShortDay(String(v))} /><Legend />
              <Bar dataKey="web" name="Web" stackId="a" fill={C.web} /><Bar dataKey="ios" name="iPhone" stackId="a" fill={C.ios} />
              <Bar dataKey="android" name="Android" stackId="a" fill={C.android} /><Bar dataKey="app" name="App (older builds)" stackId="a" fill={C.app} radius={[3, 3, 0, 0]} />
            </BarChart>
          </Chart>
          <Note>A person counted once per day per place. Older app builds didn't report iPhone vs Android, so they show as "App (older builds)".</Note>
        </Section>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Daily active users" description="Anyone who used the app or web that day (from screen views)." csv={<CsvButton name="daily-active-users" rows={u?.daily} />}>
            <Chart>
              <AreaChart data={u?.daily || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#02422B" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtShortDay} {...axis} minTickGap={20} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip labelFormatter={(v) => fmtShortDay(String(v))} /><Legend />
                <Area dataKey="web" name="Web" stackId="1" stroke={C.web} fill={C.web} fillOpacity={0.25} />
                <Area dataKey="ios" name="iPhone" stackId="1" stroke={C.ios} fill={C.ios} fillOpacity={0.3} />
                <Area dataKey="android" name="Android" stackId="1" stroke={C.android} fill={C.android} fillOpacity={0.35} />
              </AreaChart>
            </Chart>
          </Section>
          <Section title="When people sign in" description="Sign-ins by hour of the day (India time)." csv={<CsvButton name="sign-ins-by-hour" rows={l?.byHour} />}>
            <Chart>
              <BarChart data={l?.byHour || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#02422B" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} {...axis} interval={2} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip labelFormatter={(h) => `${h}:00 – ${h}:59`} /><Bar dataKey="logins" name="Sign-ins" fill={C.ios} radius={[3, 3, 0, 0]} />
              </BarChart>
            </Chart>
          </Section>
        </div>

        <Section title="Sessions" description="A session is one continuous visit; a new one starts after 30 minutes away. Length is capped at 2 hours." csv={<CsvButton name="sessions" rows={u?.sessions} />}>
          <Table><TableHeader><TableRow><TableHead>Platform</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Average length</TableHead><TableHead className="text-right">Median length</TableHead><TableHead className="text-right">Screens per session</TableHead></TableRow></TableHeader>
            <TableBody>{(u?.sessions || []).map((s: any) => (
              <TableRow key={s.platform}><TableCell className="capitalize">{s.platform === "ios" ? "iPhone" : s.platform}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(s.sessions)}</TableCell>
                <TableCell className="text-right tabular-nums">{secs(s.avg_secs)}</TableCell><TableCell className="text-right tabular-nums">{secs(s.median_secs)}</TableCell><TableCell className="text-right tabular-nums">{s.screens_per_session}</TableCell></TableRow>))}
            </TableBody></Table>
        </Section>

        <Section title="Screens" description="What people look at: views, unique people and average time on each screen, by platform." csv={<CsvButton name="screens" rows={u?.screens} />}>
          <Table><TableHeader><TableRow><TableHead>Screen</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">People</TableHead><TableHead className="text-right">Avg time</TableHead><TableHead className="text-right">Web</TableHead><TableHead className="text-right">iPhone</TableHead><TableHead className="text-right">Android</TableHead></TableRow></TableHeader>
            <TableBody>{(u?.screens || []).map((s: any) => (
              <TableRow key={s.screen}><TableCell className="max-w-[280px] truncate font-medium">{s.screen}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(s.views)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(s.users)}</TableCell><TableCell className="text-right tabular-nums">{secs(s.avg_secs)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(s.web)}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(s.ios)}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(s.android)}</TableCell></TableRow>))}
            </TableBody></Table>
          <Note>Time on screen is recorded by the new app builds; older builds show "–". Screens starting with "/" are the old web portal.</Note>
        </Section>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Key actions" description="PDF downloads, payments, requests, notification taps and more." csv={<CsvButton name="features" rows={u?.features} />}>
            <Bars rows={(u?.features || []).map((f: any) => ({ k: label(f.name), n: f.n, users: f.users }))} v="n" unit="times" />
          </Section>
          <Section title="Retention" description="Of the people who first signed in each week, how many came back." csv={<CsvButton name="retention" rows={d.retention} />}>
            {d.retention?.length ? <Table><TableHeader><TableRow><TableHead>First sign-in week</TableHead><TableHead className="text-right">People</TableHead><TableHead className="text-right">Back in week 1</TableHead><TableHead className="text-right">Week 2</TableHead><TableHead className="text-right">Days 15–30</TableHead></TableRow></TableHeader>
              <TableBody>{d.retention.map((r: any) => (
                <TableRow key={r.cohort}><TableCell>{fmtShortDay(r.cohort)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.users)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.age >= 7 ? pct(r.w1, r.users) : "…"}</TableCell><TableCell className="text-right tabular-nums">{r.age >= 14 ? pct(r.w2, r.users) : "…"}</TableCell><TableCell className="text-right tabular-nums">{r.age >= 30 ? pct(r.m1, r.users) : "…"}</TableCell></TableRow>))}
              </TableBody></Table> : <EmptyState title="Not enough history yet" />}
            <Note>"…" means the week hasn't finished yet for that group.</Note>
          </Section>
        </div>

        {/* Devices */}
        <Section title="Devices" description="From the new app builds (each session reports its device), and phones registered for notifications." csv={<CsvButton name="devices" rows={[...(dv?.models || []).map((x: any) => ({ type: "model", ...x })), ...(dv?.osVersions || []).map((x: any) => ({ type: "os", ...x })), ...(dv?.appVersions || []).map((x: any) => ({ type: "app_version", ...x }))]} />}>
          <div className="grid gap-6 md:grid-cols-3">
            <div><p className="mb-2 text-xs font-medium">Phone models</p><Bars rows={dv?.models || []} /></div>
            <div><p className="mb-2 text-xs font-medium">Operating system versions</p><Bars rows={dv?.osVersions || []} /></div>
            <div><p className="mb-2 text-xs font-medium">App versions in use</p><Bars rows={dv?.appVersions || []} /></div>
          </div>
          <Note>Phones registered for notifications: {(dv?.pushRegistered || []).map((p: any) => `${fmtNum(p.active)} ${p.platform === "ios" ? "iPhone" : "Android"}`).join(" · ") || "none yet"}.</Note>
        </Section>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Notifications" description="Sent in this period, by kind." csv={<CsvButton name="notifications" rows={d.notifications} />}>
            {d.notifications?.length ? <Table><TableHeader><TableRow><TableHead>Kind</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Opened</TableHead><TableHead className="text-right">Inbox only</TableHead></TableRow></TableHeader>
              <TableBody>{d.notifications.map((r: any) => (
                <TableRow key={r.category}><TableCell className="capitalize">{r.category}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.sent)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.delivered)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(r.read)} <span className="text-xs text-muted-foreground">{pct(r.read, r.sent)}</span></TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.inbox_only)}</TableCell></TableRow>))}
              </TableBody></Table> : <EmptyState title="No notifications in this period" />}
          </Section>
          <Section title="App errors" description="Errors the apps reported, most frequent first." csv={<CsvButton name="errors" rows={u?.errors} />}>
            {u?.errors?.length ? <Bars rows={u.errors.map((e: any) => ({ k: `${e.name} (${e.platform})`, n: e.n }))} v="n" unit="times" /> : <EmptyState title="No errors reported" icon={<Activity className="h-5 w-5" />} />}
          </Section>
        </div>

        <p className="text-xs text-muted-foreground">
          Data since: sign-ins 21 Jul 2026 · screen views web 21 Jul, iPhone 22 Sep, Android 21 Sep · sign-in attempts {d.sources.authEventsSince ?? "from this release"} · devices, time on screen and key actions from this release. Period {d.period.from} to {d.period.to}.
        </p>
      </> : null}
    </div>
  )
}
