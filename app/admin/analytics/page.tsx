"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Consolidated analytics for the leadership team.
 *
 * Built for business decisions, so every panel answers a question rather than
 * displaying a number: where investors stall between activation and first
 * login, which AUM bands actually engage, which RMs have dormant books, and
 * whether each activation cohort is improving.
 *
 * Panels fetch independently and degrade independently — one failing endpoint
 * shows its own message rather than blanking the page.
 */

const QAW = "#008455";
const QGF = "#0A3452";
const QTF = "#550E0E";
const NEUTRAL = "#9CA3AF";

type Console = {
  totals: {
    accounts: number;
    households: number;
    completed: number;
    pending: number;
    neverLoggedIn: number;
  };
  funnel: { created: number; passwordSet: number; firstLogin: number; web: number; app: number };
  families: { multiAccount: number; missingHead: number; conflicting: number };
};

type Usage = {
  days: number;
  summary: { users: number; sessions: number; events: number; since: string | null; sessionsPerUser: number };
  platforms: { platform: string; users: number; events: number }[];
  screens: { screen: string; views: number; users: number }[];
  daily: { day: string; users: number }[];
  versions: { version: string; users: number }[];
};

type SourceRow = {
  source: string;
  totalInvestors: number;
  installed: number;
  installedIos: number;
  installedAndroid: number;
  web: number;
  usingNow: number;
  nothing: number;
};

type PlatformActivity = {
  summary: {
    investors: {
      total: number;
      installed: number;
      installedIos: number;
      installedAndroid: number;
      web: number;
      app: number;
      never: number;
      usingNow: number;
    };
  };
  sourceInsights: SourceRow[];
  usageTrend: { date: string; app: number; web: number; both: number; total: number }[];
};

type Insights = {
  onboardingGap: {
    activatedCount: number;
    loggedInWithTimestamp: number;
    loggedInNoTimestamp: number;
    neverLoggedInCount: number;
    coverageNote: string;
    avgDays: number | null;
    medianDays: number | null;
  };
  aumBreakdown: {
    bucket: string;
    total: number;
    web: number;
    app: number;
    both: number;
    never: number;
  }[];
  rmLeaderboard: { rmName: string; total: number; never: number; engagementRate: number }[];
  cohortTrend: { month: string; total: number; never: number; engagementRate: number }[];
  reviewDueWorklist: { email: string; name: string; rmName: string; daysSinceLastLogin: number | null }[];
};

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function Panel({
  title,
  subtitle,
  failed,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  failed?: boolean;
  /** True while this panel's own endpoint is still in flight. */
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border/20 bg-card">
      <div className="border-b border-border/20 px-4 py-3">
        <h2 className="text-[14.5px] font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="px-4 py-4">
        {failed ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This section couldn&apos;t load. Refresh to try again.
          </p>
        ) : loading ? (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full rounded-md" />
            ))}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  detail,
  attention,
}: {
  label: string;
  value: string;
  detail: string;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card px-4 py-3.5 ${
        attention ? "border-destructive/40" : "border-border/20"
      }`}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1.5 font-sans text-[27px] font-bold leading-none tabular-nums ${
          attention ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

/** A horizontal bar split into engaged / never-logged-in. */
function EngagementBar({
  label,
  total,
  never,
  max,
}: {
  label: string;
  total: number;
  never: number;
  max: number;
}) {
  const engaged = total - never;
  const width = pct(total, max);
  return (
    <div className="min-w-0 text-[12px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] font-black uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {engaged}/{total}
        </span>
      </div>
      <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-muted-foreground/[0.07]">
        <div
          className="h-full"
          style={{ width: `${(width * pct(engaged, total || 1)) / 100}%`, background: QAW }}
          title={`${engaged} engaged`}
        />
        <div
          className="h-full"
          style={{ width: `${(width * pct(never, total || 1)) / 100}%`, background: NEUTRAL }}
          title={`${never} never logged in`}
        />
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [consoleData, setConsoleData] = React.useState<Console | null>(null);
  const [insights, setInsights] = React.useState<Insights | null>(null);
  const [consoleFailed, setConsoleFailed] = React.useState(false);
  const [insightsFailed, setInsightsFailed] = React.useState(false);
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [usageFailed, setUsageFailed] = React.useState(false);
  const [platform, setPlatform] = React.useState<PlatformActivity | null>(null);
  const [platformFailed, setPlatformFailed] = React.useState(false);
  const [status, setStatus] = React.useState<
    "loading" | "ready" | "unauthorized" | "forbidden"
  >("loading");

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const [c, i, u, pa] = await Promise.allSettled([
        fetch("/api/admin/console", { cache: "no-store" }),
        fetch("/api/admin/investor-insights", { cache: "no-store" }),
        fetch("/api/admin/usage?days=30", { cache: "no-store" }),
        fetch("/api/admin/client-platform-activity", { cache: "no-store" }),
      ]);
      if (cancelled) return;

      // Auth state is decided by whichever response we can see first — both
      // endpoints share the same session and role rules.
      const first = c.status === "fulfilled" ? c.value : i.status === "fulfilled" ? i.value : null;
      if (first?.status === 401) {
        setStatus("unauthorized");
        return;
      }
      if (first?.status === 403) {
        setStatus("forbidden");
        return;
      }

      if (c.status === "fulfilled" && c.value.ok) {
        setConsoleData((await c.value.json()) as Console);
      } else {
        setConsoleFailed(true);
      }

      if (i.status === "fulfilled" && i.value.ok) {
        setInsights((await i.value.json()) as Insights);
      } else {
        setInsightsFailed(true);
      }

      if (u.status === "fulfilled" && u.value.ok) {
        setUsage((await u.value.json()) as Usage);
      } else {
        setUsageFailed(true);
      }

      if (pa.status === "fulfilled" && pa.value.ok) {
        setPlatform((await pa.value.json()) as PlatformActivity);
      } else {
        setPlatformFailed(true);
      }

      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    // Shaped like the finished page — same row structure and heights — so
    // nothing shifts as the three endpoints land.
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
          <Skeleton className="h-[300px] rounded-xl" />
          <Skeleton className="h-[300px] rounded-xl" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>

        <Skeleton className="h-56 rounded-xl" />

        <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>

        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (status === "unauthorized") {
    return (
      <div className="rounded-xl border border-border/20 bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Your session has expired.{" "}
          <a
            className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
            href="/admin/login?redirect=/admin/analytics"
          >
            Sign in again
          </a>{" "}
          to continue.
        </p>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="rounded-xl border border-border/20 bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          This dashboard is for the leadership team. If you need access, contact your
          administrator.
        </p>
      </div>
    );
  }

  const totals = consoleData?.totals;
  const funnel = consoleData?.funnel;
  const gap = insights?.onboardingGap;
  const drop = funnel ? funnel.passwordSet - funnel.firstLogin : 0;

  const aum = insights?.aumBreakdown ?? [];
  const aumMax = aum.length ? Math.max(...aum.map((a) => a.total)) : 1;
  const rms = (insights?.rmLeaderboard ?? []).slice(0, 8);
  const cohorts = (insights?.cohortTrend ?? []).slice(-8);
  const cohortMax = cohorts.length ? Math.max(...cohorts.map((c) => c.total)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How investors are onboarding, engaging and using myQode.
        </p>
      </header>

      {/* Headline */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Client accounts"
          value={totals ? String(totals.accounts) : "—"}
          detail={totals ? `${totals.households} households` : "unavailable"}
        />
        <Kpi
          label="Onboarding complete"
          value={totals ? String(totals.completed) : "—"}
          detail={
            totals
              ? `${pct(totals.completed, totals.accounts)}% · ${totals.pending} pending`
              : "unavailable"
          }
        />
        <Kpi
          label="Never logged in"
          value={totals ? String(totals.neverLoggedIn) : "—"}
          detail="activated but never signed in"
          attention={Boolean(totals && totals.neverLoggedIn > 0)}
        />
        <Kpi
          label="Families without a head"
          value={consoleData ? String(consoleData.families.missingHead) : "—"}
          detail={
            consoleData
              ? `of ${consoleData.families.multiAccount} multi-account families`
              : "unavailable"
          }
          attention={Boolean(consoleData && consoleData.families.missingHead > 0)}
        />
      </div>

      {/* Activation gap + funnel */}
      <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
        <div className="min-w-0">
          <Panel
            title="The activation gap"
            subtitle="How long after activation an investor first signs in"
            failed={insightsFailed}
            loading={!insights && !insightsFailed}
          >
            {gap ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                      Median days
                    </p>
                    <p className="mt-1 font-sans text-[27px] font-bold leading-none tabular-nums text-foreground">
                      {gap.medianDays ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                      Average days
                    </p>
                    <p className="mt-1 font-sans text-[27px] font-bold leading-none tabular-nums text-foreground">
                      {gap.avgDays ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-border/20 pt-3 text-[12.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Activated</span>
                    <span className="tabular-nums text-foreground">{gap.activatedCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Signed in, measurable</span>
                    <span className="tabular-nums text-foreground">
                      {gap.loggedInWithTimestamp}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Never signed in</span>
                    <span className="tabular-nums font-bold text-destructive">
                      {gap.neverLoggedInCount}
                    </span>
                  </div>
                </div>

                {/* Shown verbatim: dropping it would overstate the precision
                    of the average above. */}
                <p className="mt-3 border-t border-border/20 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                  {gap.coverageNote}
                </p>
              </>
            ) : null}
          </Panel>
        </div>

        <div className="min-w-0">
          <Panel
            title="Onboarding funnel"
            subtitle="Distinct investors, distributors excluded"
            failed={consoleFailed}
            loading={!consoleData && !consoleFailed}
          >
            {funnel ? (
              <>
                <div className="flex flex-col gap-2.5">
                  {[
                    { label: "Account created", value: funnel.created, color: "#02422B" },
                    { label: "Password set", value: funnel.passwordSet, color: QAW },
                    { label: "First login", value: funnel.firstLogin, color: QGF },
                    { label: "— via app", value: funnel.app, color: "rgba(10,52,82,0.55)" },
                    { label: "— via web", value: funnel.web, color: "rgba(10,52,82,0.38)" },
                  ].map((row) => {
                    const share = pct(row.value, funnel.created);
                    return (
                      <div key={row.label} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                            {row.label}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {row.value} · {share}%
                          </span>
                        </div>
                        <div className="mt-1 h-5 overflow-hidden rounded-[5px] bg-muted-foreground/[0.07]">
                          <div
                            className="h-full rounded-[5px]"
                            style={{
                              width: `${Math.max(share, 2)}%`,
                              background: row.color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {drop > 0 ? (
                  <p className="mt-3.5 border-t border-border/20 pt-3 text-[11.5px] text-muted-foreground">
                    <span className="font-bold text-destructive">−{drop}</span> set a
                    password but never signed in — the largest leak in the funnel.
                  </p>
                ) : null}
              </>
            ) : null}
          </Panel>
        </div>
      </div>

      {/* Engagement by AUM + RM leaderboard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <Panel
            title="Engagement by AUM band"
            subtitle="Do larger investors actually use the portal?"
            failed={insightsFailed}
            loading={!insights && !insightsFailed}
          >
            {aum.length ? (
              <>
                <div className="flex flex-col gap-3">
                  {aum.map((a) => (
                    <EngagementBar
                      key={a.bucket}
                      label={a.bucket}
                      total={a.total}
                      never={a.never}
                      max={aumMax}
                    />
                  ))}
                </div>
                <div className="mt-3.5 flex gap-3.5 border-t border-border/20 pt-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: QAW }} />
                    Signed in
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ background: NEUTRAL }}
                    />
                    Never signed in
                  </span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No AUM data available yet.
              </p>
            )}
          </Panel>
        </div>

        <div className="min-w-0">
          <Panel
            title="Relationship managers"
            subtitle="Engagement rate across each book"
            failed={insightsFailed}
            loading={!insights && !insightsFailed}
          >
            {rms.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border/20 text-left">
                      {["Manager", "Clients", "Dormant", "Engaged"].map((h, i) => (
                        <th
                          key={h}
                          className={`py-2 pr-3 text-[9.5px] font-black uppercase tracking-[0.1em] text-muted-foreground last:pr-0 ${
                            i > 0 ? "text-right" : ""
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rms.map((r) => (
                      <tr key={r.rmName} className="border-b border-border/10 last:border-0">
                        <td className="py-2 pr-3 text-foreground">{r.rmName}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {r.total}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${
                            r.never > 0 ? "text-destructive" : "text-muted-foreground"
                          }`}
                        >
                          {r.never}
                        </td>
                        <td className="py-2 text-right font-bold tabular-nums text-foreground">
                          {r.engagementRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No relationship manager data available yet.
              </p>
            )}
          </Panel>
        </div>
      </div>

      {/* Cohort trend */}
      <Panel
        title="Activation cohorts"
        subtitle="Is each month's intake engaging better than the last?"
        failed={insightsFailed}
        loading={!insights && !insightsFailed}
      >
        {cohorts.length ? (
          <>
            <div className="flex items-end gap-2 overflow-x-auto pb-1">
              {cohorts.map((c) => (
                <div key={c.month} className="flex min-w-[56px] flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-black tabular-nums text-foreground">
                    {c.engagementRate}%
                  </span>
                  <div
                    className="flex h-[110px] w-full items-end overflow-hidden rounded-t-[4px] bg-muted-foreground/[0.07]"
                  >
                    <div
                      className="w-full rounded-t-[4px]"
                      style={{
                        height: `${Math.max(pct(c.total, cohortMax), 4)}%`,
                        background: c.engagementRate >= 50 ? QAW : QTF,
                      }}
                      title={`${c.total} investors, ${c.never} never signed in`}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {c.month}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">
                    n={c.total}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-border/20 pt-3 text-[11px] text-muted-foreground">
              Bar height is cohort size; the percentage above is how many of that cohort
              have ever signed in. Green at 50% or better.
            </p>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No activation cohorts recorded yet.
          </p>
        )}
      </Panel>

      {/* The big picture — app adoption among funded investors */}
      <Panel
        title="The big picture"
        subtitle="Funded investors from Zoho CRM — how many installed the app, and how many actually use it"
        failed={platformFailed}
        loading={!platform && !platformFailed}
      >
        {platform ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                label: "Funded investors",
                value: platform.summary.investors.total,
                detail: "funded accounts in Zoho CRM",
                tone: "plain" as const,
              },
              {
                label: "Installed the app",
                value: platform.summary.investors.installed,
                detail: `${platform.summary.investors.installedIos} iPhone · ${platform.summary.investors.installedAndroid} Android`,
                tone: "app" as const,
              },
              {
                label: "Using the app",
                value: platform.summary.investors.app,
                detail: "opened the app recently",
                tone: "good" as const,
              },
              {
                label: "Used web",
                value: platform.summary.investors.web,
                detail: "signed in on the browser",
                tone: "good" as const,
              },
              {
                label: "Active anywhere",
                value: platform.summary.investors.usingNow,
                detail: "app or web, recently",
                tone: "app" as const,
              },
              {
                label: "Never signed in",
                value: platform.summary.investors.never,
                detail: "funded but never used myQode",
                tone: "warn" as const,
              },
            ].map((t) => (
              <div
                key={t.label}
                className="rounded-lg border border-border/20 bg-background px-4 py-3"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                  {t.label}
                </p>
                <p
                  className="mt-1.5 font-sans text-[26px] font-bold leading-none tabular-nums"
                  style={{
                    color:
                      t.tone === "app"
                        ? QGF
                        : t.tone === "good"
                          ? QAW
                          : t.tone === "warn"
                            ? "var(--destructive)"
                            : undefined,
                  }}
                >
                  {t.value}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t.detail}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      {/* Where investors come from */}
      <Panel
        title="Where investors come from"
        subtitle="For each acquisition source: how many funded, installed the app, use it now, and have done nothing yet"
        failed={platformFailed}
        loading={!platform && !platformFailed}
      >
        {platform?.sourceInsights?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border/20 text-left">
                  {[
                    "How they found us",
                    "Funded",
                    "Installed",
                    "iPhone",
                    "Android",
                    "On web",
                    "Using now",
                    "Nothing yet",
                  ].map((h, i) => (
                    <th
                      key={h}
                      className={`py-2 pr-4 text-[9.5px] font-black uppercase tracking-[0.1em] text-muted-foreground last:pr-0 ${
                        i > 0 ? "text-right" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {platform.sourceInsights
                  .slice()
                  .sort((a, b) => b.totalInvestors - a.totalInvestors)
                  .map((r) => (
                    <tr key={r.source} className="border-b border-border/10 last:border-0">
                      <td className="py-2 pr-4 text-foreground">{r.source}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-foreground">
                        {r.totalInvestors}
                      </td>
                      <td
                        className="py-2 pr-4 text-right font-bold tabular-nums"
                        style={{ color: QGF }}
                      >
                        {r.installed}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {r.installedIos}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {r.installedAndroid}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {r.web}
                      </td>
                      <td
                        className="py-2 pr-4 text-right font-bold tabular-nums"
                        style={{ color: QAW }}
                      >
                        {r.usingNow}
                      </td>
                      <td
                        className={`py-2 text-right font-bold tabular-nums ${
                          r.nothing > 0 ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {r.nothing}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/20">
                  <td className="py-2 pr-4 font-bold text-foreground">Total</td>
                  {(() => {
                    const sum = (k: keyof SourceRow) =>
                      platform.sourceInsights.reduce(
                        (a, r) => a + Number(r[k] ?? 0),
                        0,
                      );
                    return (
                      <>
                        <td className="py-2 pr-4 text-right font-bold tabular-nums text-foreground">
                          {sum("totalInvestors")}
                        </td>
                        <td
                          className="py-2 pr-4 text-right font-bold tabular-nums"
                          style={{ color: QGF }}
                        >
                          {sum("installed")}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {sum("installedIos")}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {sum("installedAndroid")}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {sum("web")}
                        </td>
                        <td
                          className="py-2 pr-4 text-right font-bold tabular-nums"
                          style={{ color: QAW }}
                        >
                          {sum("usingNow")}
                        </td>
                        <td className="py-2 text-right font-bold tabular-nums text-destructive">
                          {sum("nothing")}
                        </td>
                      </>
                    );
                  })()}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No acquisition-source data available.
          </p>
        )}
      </Panel>

      {/* Usage trend — app vs web over time */}
      <Panel
        title="Usage trend — app, web and both"
        subtitle="Weekly active investors on each platform, against total investors on the books"
        failed={platformFailed}
        loading={!platform && !platformFailed}
      >
        {platform?.usageTrend?.length ? (
          (() => {
            const pts = platform.usageTrend.slice(-26);
            const max = Math.max(
              ...pts.map((q) => Math.max(q.total, q.web, q.app, q.both)),
              1,
            );
            const W = 900;
            const H = 190;
            const xAt = (i: number) => (pts.length > 1 ? (i * W) / (pts.length - 1) : 0);
            const yAt = (v: number) => H - (v / max) * (H - 16) - 8;
            const line = (key: "total" | "web" | "app" | "both") =>
              pts
                .map((q, i) => `${Math.round(xAt(i))},${Math.round(yAt(q[key]))}`)
                .join(" ");
            const series = [
              {
                key: "total" as const,
                color: NEUTRAL,
                label: "Total investors",
                dash: "5 4",
              },
              { key: "web" as const, color: QGF, label: "Web", dash: undefined },
              { key: "app" as const, color: QAW, label: "App", dash: undefined },
              { key: "both" as const, color: QTF, label: "Both", dash: undefined },
            ];
            const last = pts[pts.length - 1];
            return (
              <>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="block h-[190px] w-full"
                  role="img"
                  aria-label={`Weekly active investors. Latest: ${last.web} web, ${last.app} app, ${last.both} both, of ${last.total} total.`}
                >
                  {[0.25, 0.5, 0.75].map((f) => (
                    <line
                      key={f}
                      x1="0"
                      y1={H * f}
                      x2={W}
                      y2={H * f}
                      stroke="currentColor"
                      strokeWidth="1"
                      className="text-border/20"
                    />
                  ))}
                  {series.map((se) => (
                    <polyline
                      key={se.key}
                      points={line(se.key)}
                      fill="none"
                      stroke={se.color}
                      strokeWidth="2.2"
                      strokeDasharray={se.dash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-3.5 text-[11px] text-muted-foreground">
                    {series.map((se) => (
                      <span key={se.key} className="flex items-center gap-1.5">
                        <span
                          className="h-0.5 w-4 rounded-full"
                          style={{ background: se.color }}
                        />
                        {se.label}
                      </span>
                    ))}
                  </div>
                  <span className="text-[10.5px] tabular-nums text-muted-foreground">
                    {pts[0].date} → {last.date}
                  </span>
                </div>
              </>
            );
          })()
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No usage trend recorded yet.
          </p>
        )}
      </Panel>

      {/* Portal usage — how investors actually move through myQode */}
      <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
        <div className="min-w-0">
          <Panel
            title="Portal usage"
            subtitle={usage ? `Last ${usage.days} days` : "Last 30 days"}
            failed={usageFailed}
            loading={!usage && !usageFailed}
          >
            {usage ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                      Active users
                    </p>
                    <p className="mt-1 font-sans text-[27px] font-bold leading-none tabular-nums text-foreground">
                      {usage.summary.users}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                      Sessions
                    </p>
                    <p className="mt-1 font-sans text-[27px] font-bold leading-none tabular-nums text-foreground">
                      {usage.summary.sessions}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 border-t border-border/20 pt-3 text-[12.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sessions per user</span>
                    <span className="tabular-nums text-foreground">
                      {usage.summary.sessionsPerUser}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Page views</span>
                    <span className="tabular-nums text-foreground">
                      {usage.summary.events.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>

                {usage.platforms.length ? (
                  <div className="mt-4 border-t border-border/20 pt-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                      Platform
                    </p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {usage.platforms.map((pl) => (
                        <div
                          key={pl.platform}
                          className="flex justify-between text-[12.5px]"
                        >
                          <span className="capitalize text-muted-foreground">
                            {pl.platform}
                          </span>
                          <span className="tabular-nums text-foreground">
                            {pl.users} users
                          </span>
                        </div>
                      ))}
                    </div>
                    {usage.platforms.length === 1 &&
                    usage.platforms[0].platform === "web" ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Only web sessions are being recorded — the mobile app is not
                        yet reporting to this table.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </Panel>
        </div>

        <div className="min-w-0">
          <Panel
            title="Most used screens"
            subtitle="Page views across the portal"
            failed={usageFailed}
            loading={!usage && !usageFailed}
          >
            {usage?.screens?.length ? (
              <div className="flex flex-col gap-2.5">
                {usage.screens.slice(0, 8).map((sc) => {
                  const max = usage.screens[0].views || 1;
                  return (
                    <div key={sc.screen} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[11.5px] text-foreground">
                          {sc.screen}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {sc.views.toLocaleString("en-IN")} · {sc.users} users
                        </span>
                      </div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted-foreground/[0.07]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(pct(sc.views, max), 2)}%`,
                            background: QGF,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No page views recorded in this period.
              </p>
            )}
          </Panel>
        </div>
      </div>

      {/* Daily active users */}
      <Panel
        title="Daily active users"
        subtitle={usage ? `Distinct users per day, last ${usage.days} days` : undefined}
        failed={usageFailed}
        loading={!usage && !usageFailed}
      >
        {usage?.daily?.length ? (
          <>
            <div className="flex items-end gap-1 overflow-x-auto pb-1">
              {usage.daily.map((d) => {
                const max = Math.max(...usage.daily.map((x) => x.users)) || 1;
                return (
                  <div
                    key={d.day}
                    className="flex min-w-[26px] flex-1 flex-col items-center gap-1"
                    title={`${d.day}: ${d.users} users`}
                  >
                    <div className="flex h-[90px] w-full items-end overflow-hidden rounded-t-[3px] bg-muted-foreground/[0.07]">
                      <div
                        className="w-full rounded-t-[3px]"
                        style={{
                          height: `${Math.max(pct(d.users, max), 3)}%`,
                          background: QAW,
                        }}
                      />
                    </div>
                    <span className="whitespace-nowrap text-[9px] tabular-nums text-muted-foreground">
                      {d.day}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 border-t border-border/20 pt-3 text-[11px] text-muted-foreground">
              Peak {Math.max(...usage.daily.map((d) => d.users))} users in a day across
              this period.
            </p>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No daily activity recorded in this period.
          </p>
        )}
      </Panel>

      {/* Worklist */}
      <Panel
        title="Annual review due"
        subtitle="Review not done, and dormant for 30 days or more"
        failed={insightsFailed}
        loading={!insights && !insightsFailed}
      >
        {insights?.reviewDueWorklist?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border/20 text-left">
                  {["Investor", "Manager", "Days since login"].map((h, i) => (
                    <th
                      key={h}
                      className={`py-2 pr-4 text-[9.5px] font-black uppercase tracking-[0.1em] text-muted-foreground last:pr-0 ${
                        i === 2 ? "text-right" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {insights.reviewDueWorklist.slice(0, 12).map((r) => (
                  <tr key={r.email} className="border-b border-border/10 last:border-0">
                    <td className="py-2 pr-4">
                      <span className="text-foreground">{r.name}</span>
                      <span className="ml-2 break-all text-[11px] text-muted-foreground">
                        {r.email}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.rmName}</td>
                    <td className="py-2 text-right tabular-nums text-destructive">
                      {r.daysSinceLastLogin ?? "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No investors are currently due a review.
          </p>
        )}
      </Panel>
    </div>
  );
}
