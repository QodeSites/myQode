"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  KeyRound,
  Lock,
  MessageSquare,
  RefreshCw,
  UserX,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  EmptyState,
  ErrorNote,
  KpiCard,
  PageHeader,
  Panel,
  Pill,
  boFetch,
  errorMessage,
  fmtDateTime,
  fmtNum,
  fmtRelative,
  fmtShortDay,
} from "@/components/admin-kit"

interface Overview {
  users: {
    investors: number
    distributors: number
    passwordSet: number
    needsSetup: number
    neverLoggedIn: number
    locked: number
  }
  logins: { today: number; last7: number; last30: number; web30: number; app30: number; ios30: number; android30: number }
  daily: { date: string; web: number; app: number }[]
  appVersions: { version: string; users: number }[]
  topScreens: { name: string; views: number }[]
  errors7: number
  recentErrors: { name: string; message: string; count: number; lastAt: string }[]
  recentLogins: { email: string; name: string; platform: string; os: string | null; at: string }[]
  openQueries: number
}

// Validated two-series pair (web, app): brand-derived green and gold.
const WEB_COLOR = "#237A56"
const APP_COLOR = "#A8841A"

function pct(part: number, whole: number) {
  if (!whole) return "0%"
  return `${Math.round((part / whole) * 100)}%`
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await boFetch<Overview>("/api/admin/bo/overview"))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Who can sign in, who is signing in, and where."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      {loading && !data ? <OverviewSkeleton /> : data ? <OverviewBody data={data} /> : null}
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[340px] rounded-xl" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

function OverviewBody({ data }: { data: Overview }) {
  const u = data.users
  const l = data.logins
  const totalUsers = (u.investors || 0) + (u.distributors || 0)
  const maxVersion = Math.max(1, ...data.appVersions.map((v) => v.users))
  const maxScreen = Math.max(1, ...data.topScreens.map((s) => s.views))

  return (
    <div className="space-y-6">
      {/* Users */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#02422B]/70">Users</p>
        <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
          <Link href="/admin/users?type=investor" className="block">
            <KpiCard label="Investors" value={fmtNum(u.investors)} icon={<Users className="h-4 w-4" />} accent />
          </Link>
          <Link href="/admin/users?type=distributor" className="block">
            <KpiCard label="Distributors" value={fmtNum(u.distributors)} icon={<Briefcase className="h-4 w-4" />} />
          </Link>
          <KpiCard
            label="Password set"
            value={fmtNum(u.passwordSet)}
            hint={`${pct(u.passwordSet, totalUsers)} of all users`}
            icon={<KeyRound className="h-4 w-4" />}
          />
          <Link href="/admin/users?status=needs-setup" className="block">
            <KpiCard label="Needs setup" value={fmtNum(u.needsSetup)} hint="No password yet" />
          </Link>
          <Link href="/admin/users?status=never" className="block">
            <KpiCard label="Never logged in" value={fmtNum(u.neverLoggedIn)} icon={<UserX className="h-4 w-4" />} />
          </Link>
          <Link href="/admin/users?status=locked" className="block">
            <KpiCard label="Locked" value={fmtNum(u.locked)} icon={<Lock className="h-4 w-4" />} />
          </Link>
        </div>
      </div>

      {/* Logins */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#02422B]/70">Logins</p>
        <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
          <KpiCard label="Today" value={fmtNum(l.today)} />
          <KpiCard label="Last 7 days" value={fmtNum(l.last7)} />
          <KpiCard label="Last 30 days" value={fmtNum(l.last30)} />
          <KpiCard label="Web, 30 days" value={fmtNum(l.web30)} hint={`${pct(l.web30, l.web30 + l.app30)} of logins`} />
          <KpiCard label="App, 30 days" value={fmtNum(l.app30)} hint={`${pct(l.app30, l.web30 + l.app30)} of logins`} />
          <KpiCard
            label="iOS vs Android, 30 days"
            value={
              <span>
                {fmtNum(l.ios30)} <span className="text-base font-normal text-muted-foreground">/</span>{" "}
                {fmtNum(l.android30)}
              </span>
            }
            hint={`${pct(l.ios30, l.ios30 + l.android30)} iOS`}
          />
        </div>
      </div>

      {/* Daily chart */}
      <Panel
        title="Daily logins, last 30 days"
        description="Web portal and app sign-ins per day"
        action={
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: WEB_COLOR }} /> Web
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: APP_COLOR }} /> App
            </span>
          </div>
        }
      >
        {data.daily.length === 0 ? (
          <EmptyState title="No logins in the last 30 days" />
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="bo-web" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={WEB_COLOR} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={WEB_COLOR} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="bo-app" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={APP_COLOR} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={APP_COLOR} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#02422B" strokeOpacity={0.08} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtShortDay}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => fmtNum(v)}
                  width={48}
                />
                <Tooltip
                  cursor={{ stroke: "#02422B", strokeOpacity: 0.25 }}
                  content={({ active, payload, label }) =>
                    active && payload && payload.length ? (
                      <div className="rounded-lg border border-[#02422B]/10 bg-white px-3 py-2 text-xs shadow-md">
                        <p className="mb-1 font-semibold text-[#002017]">{fmtShortDay(String(label))}</p>
                        {payload.map((p) => (
                          <p key={String(p.dataKey)} className="flex items-center gap-2 text-[#002017]">
                            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                            {p.dataKey === "web" ? "Web" : "App"}
                            <span className="ml-auto pl-4 font-semibold tabular-nums">{fmtNum(Number(p.value))}</span>
                          </p>
                        ))}
                      </div>
                    ) : null
                  }
                />
                <Area type="monotone" dataKey="web" stroke={WEB_COLOR} strokeWidth={2} fill="url(#bo-web)" />
                <Area type="monotone" dataKey="app" stroke={APP_COLOR} strokeWidth={2} fill="url(#bo-app)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-3 gap-4">
        <Panel title="App versions" description="Users by version, last 30 days">
          {data.appVersions.length === 0 ? (
            <EmptyState title="No app activity yet" />
          ) : (
            <ul className="space-y-2.5">
              {data.appVersions.slice(0, 8).map((v) => (
                <li key={v.version}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#002017]">{v.version || "Unknown"}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtNum(v.users)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[#EFECD3]">
                    <div
                      className="h-1.5 rounded-full bg-[#237A56]"
                      style={{ width: `${(v.users / maxVersion) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top screens" description="Views, last 30 days">
          {data.topScreens.length === 0 ? (
            <EmptyState title="No screen views yet" />
          ) : (
            <ul className="space-y-2.5">
              {data.topScreens.slice(0, 8).map((s) => (
                <li key={s.name}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium text-[#002017]">{s.name}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtNum(s.views)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[#EFECD3]">
                    <div
                      className="h-1.5 rounded-full bg-[#237A56]"
                      style={{ width: `${(s.views / maxScreen) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent errors"
          description={`${fmtNum(data.errors7)} in the last 7 days`}
          action={data.errors7 > 0 ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : null}
        >
          {data.recentErrors.length === 0 ? (
            <EmptyState title="No errors reported" description="The app has not reported any errors recently." />
          ) : (
            <ul className="divide-y divide-[#02422B]/10">
              {data.recentErrors.slice(0, 6).map((e, i) => (
                <li key={`${e.name}-${i}`} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#002017]">{e.name}</span>
                    <Pill tone="red">{fmtNum(e.count)}x</Pill>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Last seen {fmtRelative(e.lastAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-4">
        <Panel title="Recent logins" description="Latest 20 sign-ins" bodyClassName="p-0">
          {data.recentLogins.length === 0 ? (
            <EmptyState title="No recent logins" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">User</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead className="pr-5 text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentLogins.map((r, i) => (
                  <TableRow key={`${r.email}-${r.at}-${i}`}>
                    <TableCell className="pl-5">
                      <Link
                        href={`/admin/users/${encodeURIComponent(r.email)}`}
                        className="font-medium text-[#002017] hover:underline"
                      >
                        {r.name || r.email}
                      </Link>
                      {r.name ? <p className="text-xs text-muted-foreground">{r.email}</p> : null}
                    </TableCell>
                    <TableCell>
                      {r.platform === "app" ? <Pill tone="gold">App</Pill> : <Pill tone="green">Web</Pill>}
                    </TableCell>
                    <TableCell className="text-sm capitalize text-muted-foreground">{r.os || "Unknown"}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <p className="text-sm text-[#002017]">{fmtRelative(r.at)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(r.at)}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Link
          href="/admin/queries"
          className="group flex h-fit flex-col rounded-xl border border-[#02422B]/10 bg-[#002017] p-5 text-[#EFECD3] shadow-sm"
        >
          <MessageSquare className="h-5 w-5 text-[#DABD38]" />
          <p className="mt-4 text-sm text-[#EFECD3]/80">Open queries</p>
          <p className="mt-1 font-serif text-4xl font-bold text-white">{fmtNum(data.openQueries)}</p>
          <span className="mt-4 flex items-center gap-1 text-sm font-medium text-[#DABD38]">
            Go to queries <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>
    </div>
  )
}
