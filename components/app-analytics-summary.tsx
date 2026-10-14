"use client"

// The headline of App analytics (/admin/analytics) for other admin pages: the same numbers from the same place
// (GET /api/admin/bo/analytics/clients), so they can never disagree with that page. Names and details stay there.
import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { boFetch, fmtNum } from "@/components/admin-kit"
import { ORDER, STATUS, ownersBridge, shares, type Status } from "@/components/app-analytics-shared"

export type AppAnalyticsData = { summary: Record<string, number>; clients: { status: Status }[]; newAppVersion: string; generatedAt: string }
const parts = (xs: [number, string][]) => xs.filter((x) => x[0]).map((x) => `${fmtNum(x[0])} ${x[1]}`).join(" + ")

function Fact({ label, value, of, hint }: { label: string; value: number; of?: string; hint: ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{fmtNum(value)}{of ? <span className="ml-1.5 text-sm font-medium text-muted-foreground">{of}</span> : null}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

/** `data`: pass the figures when the page already has them (undefined = still loading, null = failed); leave out to load here. */
export function AppAnalyticsSummary(props: { data?: AppAnalyticsData | null }) {
  const own = !("data" in props), data = props.data
  const [loaded, setD] = useState<AppAnalyticsData | null>(null)
  const [loadFailed, setFailed] = useState(false)
  useEffect(() => { if (own) boFetch<AppAnalyticsData>("/api/admin/bo/analytics/clients?days=30").then(setD).catch(() => setFailed(true)) }, [own])
  const d = own ? loaded : data ?? null, failed = own ? loadFailed : data === null
  const S = d?.summary
  const counts = ORDER.map((s) => (d ? d.clients.filter((c) => c.status === s).length : 0)), share = shares(counts)
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{S ? `Where our ${fmtNum(S.clients)} clients stand` : "Where our clients stand"}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {S ? `${ownersBridge(S)} ` : ""}The same figures as the App analytics page. Every current client is in exactly one group{S ? `, so the groups add up to ${fmtNum(S.clients)}` : ""}.
            </p>
          </div>
          <Link href="/admin/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02422B] underline-offset-2 hover:underline">Names and details in App analytics<ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed ? <p className="text-sm text-muted-foreground">Could not load these figures. Open App analytics to see them.</p>
          : !d || !S ? <Skeleton className="h-40 w-full" />
          : <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-200">
              {ORDER.map((s, i) => (counts[i] ? <div key={s} title={`${STATUS[s].label}: ${counts[i]}`} style={{ width: `${(counts[i] / S.clients) * 100}%`, background: STATUS[s].color }} /> : null))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {ORDER.map((s, i) => (counts[i] ? (
                <div key={s} className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS[s].color }} />{STATUS[s].label}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">{fmtNum(counts[i])}<span className="ml-1.5 text-sm font-medium text-muted-foreground">{share[i]}%</span></div>
                  <div className="mt-1 text-xs text-muted-foreground">{STATUS[s].meaning}</div>
                </div>
              ) : null))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Fact label="Used myQode today" value={S.usedToday} hint={`${fmtNum(S.usedTodayApp)} on the phone app + ${fmtNum(S.usedToday - S.usedTodayApp)} on the website only`} />
              <Fact label="Used it in the last 7 days" value={S.used7} hint={`${fmtNum(S.used7App)} on the phone app + ${fmtNum(S.used7 - S.used7App)} on the website only`} />
              <Fact label="Have the phone app" value={S.hasApp} of={`of ${fmtNum(S.clients)}`}
                hint={<>{fmtNum(S.newApp)} new app + {fmtNum(S.oldApp)} old app.<br />{parts([[S.iphoneOnly, "iPhone"], [S.androidOnly, "Android"], [S.bothPhones, "both"], [S.phoneUnknown, "on an old app that does not say which phone"]])}</>} />
              <Fact label="Don't have the app" value={S.noApp} of={`of ${fmtNum(S.clients)}`}
                hint={parts([[S.noPassword, "no password"], [S.neverSignedIn, "never signed in"], [S.websiteOnly, "website only"], [S.familyCovered, "seen by the family head"]])} />
              <Fact label="Phone alerts switched on" value={S.phoneAlerts} of={`of ${fmtNum(S.hasApp)} with the app`}
                hint={`${fmtNum(S.alertsOn)} on the new app + ${fmtNum(S.phoneAlerts - S.alertsOn)} on the old app. ${fmtNum(S.alertsOff)} on the new app have them switched off, and the other ${fmtNum(S.oldApp - (S.phoneAlerts - S.alertsOn))} on the old app cannot get them.`} />
            </div>
          </>}
      </CardContent>
    </Card>
  )
}
