"use client";

import * as React from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Ops console — the back office landing screen.
 *
 * Answers "what needs me today?" before showing any list. Work is ranked by
 * client impact and actionable in place, so clearing the family backlog does
 * not require navigating to another page first.
 */

type ConsoleData = {
  asOf: string;
  totals: {
    accounts: number;
    households: number;
    completed: number;
    pending: number;
    neverLoggedIn: number;
  };
  funnel: {
    created: number;
    passwordSet: number;
    firstLogin: number;
    web: number;
    app: number;
  };
  families: { multiAccount: number; missingHead: number; conflicting: number };
  schemes: { scheme: string; count: number }[];
  logins: { week: string; count: number }[];
  loginDelta: number | null;
  distributors: { name: string; count: number }[];
};

/** Strategy identity colours, per the design system. Grey for everything
 *  outside the three named strategies. */
const SCHEME_COLOR: Record<string, string> = {
  QAW: "#008455",
  QGF: "#0A3452",
  QTF: "#550E0E",
};
const SCHEME_LABEL: Record<string, string> = {
  QAW: "All Weather",
  QGF: "Growth Fund",
  QTF: "Tactical Fund",
};
const NEUTRAL = "#9CA3AF";

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

function Kpi({
  label,
  value,
  detail,
  attention,
}: {
  label: string;
  value: number;
  detail: React.ReactNode;
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
        className={`mt-1.5 font-serif text-[27px] leading-none tabular-nums ${
          attention ? "text-destructive" : "text-foreground"
        }`}
      >
        {value.toLocaleString("en-IN")}
      </p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border/20 bg-card">
      <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function FunnelRow({
  label,
  value,
  total,
  color,
  muted,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  muted?: boolean;
}) {
  const share = pct(value, total);
  return (
    <div className="grid grid-cols-[110px_1fr_58px] items-center gap-3">
      <span
        className={`text-[10px] font-black uppercase tracking-[0.11em] ${
          muted ? "text-muted-foreground/70" : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <div className="h-6 overflow-hidden rounded-[5px] bg-muted-foreground/[0.07]">
        <div
          className="flex h-full items-center justify-end rounded-[5px] pr-2 text-[10.5px] font-black text-white"
          style={{ width: `${Math.max(share, 6)}%`, background: color }}
        >
          {value}
        </div>
      </div>
      <span className="text-right text-[11.5px] tabular-nums text-muted-foreground">
        {share}%
      </span>
    </div>
  );
}

function TriageCard({
  count,
  title,
  detail,
  tone,
  href,
}: {
  count: number;
  title: string;
  detail: string;
  tone: "bad" | "warn" | "good";
  href?: string;
}) {
  const styles = {
    bad: { border: "border-l-destructive", bg: "bg-destructive/[0.06]", num: "text-destructive" },
    warn: { border: "border-l-primary", bg: "bg-primary/[0.07]", num: "text-primary dark:text-primary-foreground" },
    good: { border: "border-l-[#008455]", bg: "bg-[#008455]/[0.08]", num: "text-[#008455]" },
  }[tone];

  const inner = (
    <div className={`flex gap-3 rounded-lg border-l-[3px] px-3 py-2.5 ${styles.border} ${styles.bg}`}>
      <span className={`min-w-[34px] shrink-0 font-serif text-xl leading-none tabular-nums ${styles.num}`}>
        {count}
      </span>
      <div className="min-w-0">
        <p className="text-[12.5px] font-bold text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
      </div>
      {href ? <span className="ml-auto self-center text-[11px] text-muted-foreground">→</span> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default function AdminConsolePage() {
  const [data, setData] = React.useState<ConsoleData | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "unauthorized" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/console", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setStatus("unauthorized");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        setData((await res.json()) as ConsoleData);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-72 rounded-xl lg:col-span-7" />
          <Skeleton className="h-72 rounded-xl lg:col-span-5" />
        </div>
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
            href="/admin/login?redirect=/admin/console"
          >
            Sign in again
          </a>{" "}
          to continue.
        </p>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <p className="text-sm text-foreground">
          We couldn&apos;t load the console. Please refresh to try again.
        </p>
      </div>
    );
  }

  const { totals, funnel, families, schemes, logins, loginDelta, distributors } = data;
  const latestLogins = logins.length ? logins[logins.length - 1].count : 0;
  const passwordToLoginDrop = funnel.passwordSet - funnel.firstLogin;
  const schemeMax = schemes.length ? Math.max(...schemes.map((s) => s.count)) : 1;
  const loginMax = logins.length ? Math.max(...logins.map((l) => l.count)) : 1;
  const distributorMax = distributors.length ? distributors[0].count : 1;

  // Area chart geometry. Computed here rather than in the markup so the
  // polyline and its fill cannot drift apart.
  const W = 760;
  const H = 150;
  const stepX = logins.length > 1 ? W / (logins.length - 1) : W;
  const points = logins.map((l, i) => {
    const x = Math.round(i * stepX);
    const y = Math.round(H - (l.count / loginMax) * (H - 18) - 8);
    return { x, y, ...l };
  });
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area =
    points.length > 1
      ? `M${points[0].x},${points[0].y} ` +
        points.slice(1).map((p) => `L${p.x},${p.y}`).join(" ") +
        ` L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`
      : "";

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl">Console</h1>
        <p className="text-[11px] text-muted-foreground">
          As of {formatDateTime(data.asOf)}
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Client accounts"
          value={totals.accounts}
          detail={`across ${totals.households} households`}
        />
        <Kpi
          label="Onboarding complete"
          value={totals.completed}
          detail={
            <>
              <span className="font-bold text-[#008455]">
                {pct(totals.completed, totals.accounts)}%
              </span>{" "}
              of {totals.accounts} · {totals.pending} pending
            </>
          }
        />
        <Kpi
          label="Families without a head"
          value={families.missingHead}
          detail={`of ${families.multiAccount} multi-account families`}
          attention={families.missingHead > 0}
        />
        <Kpi
          label="Never logged in"
          value={totals.neverLoggedIn}
          detail="activated but never signed in"
          attention={totals.neverLoggedIn > 0}
        />
        <Kpi
          label="Logins this week"
          value={latestLogins}
          detail={
            loginDelta === null ? (
              "no prior week to compare"
            ) : (
              <>
                <span
                  className={`font-bold ${
                    loginDelta >= 0 ? "text-[#008455]" : "text-destructive"
                  }`}
                >
                  {loginDelta >= 0 ? "▲" : "▼"} {Math.abs(loginDelta)}%
                </span>{" "}
                vs last week
              </>
            )
          }
        />
      </div>

      {/* Funnel + triage */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel
            title="Onboarding funnel"
            subtitle="Distinct investors, distributors excluded"
          >
            <div className="flex flex-col gap-2.5">
              <FunnelRow label="Account created" value={funnel.created} total={funnel.created} color="#02422B" />
              <FunnelRow label="Password set" value={funnel.passwordSet} total={funnel.created} color="#008455" />
              <FunnelRow label="First login" value={funnel.firstLogin} total={funnel.created} color="#0A3452" />
              <FunnelRow label="— via app" value={funnel.app} total={funnel.created} color="rgba(10,52,82,0.55)" muted />
              <FunnelRow label="— via web" value={funnel.web} total={funnel.created} color="rgba(10,52,82,0.38)" muted />
            </div>
            {passwordToLoginDrop > 0 ? (
              <p className="mt-3.5 border-t border-border/20 pt-3 text-[11.5px] text-muted-foreground">
                <span className="font-bold text-destructive">
                  −{passwordToLoginDrop} drop
                </span>{" "}
                between password set and first login — the largest single leak in the
                funnel.
              </p>
            ) : null}
          </Panel>
        </div>

        <div className="lg:col-span-5">
          <Panel title="Needs attention" subtitle="Ranked by client impact">
            <div className="flex flex-col gap-2">
              {families.missingHead > 0 ? (
                <TriageCard
                  count={families.missingHead}
                  title="Families without a head"
                  detail="Their logins can't see the household view"
                  tone="bad"
                  href="/admin/families"
                />
              ) : null}
              {totals.neverLoggedIn > 0 ? (
                <TriageCard
                  count={totals.neverLoggedIn}
                  title="Activated, never signed in"
                  detail="Onboarding email may not have landed"
                  tone="bad"
                  href="/admin/clients"
                />
              ) : null}
              {totals.pending > 0 ? (
                <TriageCard
                  count={totals.pending}
                  title="Onboarding still pending"
                  detail="Account created but setup incomplete"
                  tone="warn"
                  href="/admin/clients"
                />
              ) : null}
              <TriageCard
                count={families.conflicting}
                title="Families with conflicting heads"
                detail={
                  families.conflicting === 0
                    ? "Single-head invariant is holding"
                    : "More than one head assigned — needs review"
                }
                tone={families.conflicting === 0 ? "good" : "bad"}
              />
            </div>
          </Panel>
        </div>
      </div>

      {/* Logins + schemes */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel
            title="Login activity"
            subtitle="Distinct clients signing in, by week"
          >
            {points.length < 2 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Not enough login history yet to draw a trend.
              </p>
            ) : (
              <>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="block h-[150px] w-full"
                  role="img"
                  aria-label={`Weekly logins: ${logins.map((l) => `${l.week} ${l.count}`).join(", ")}`}
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
                  <defs>
                    <linearGradient id="loginFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#008455" stopOpacity="0.26" />
                      <stop offset="100%" stopColor="#008455" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={area} fill="url(#loginFill)" />
                  <polyline
                    points={line}
                    fill="none"
                    stroke="#008455"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={points[points.length - 1].x}
                    cy={points[points.length - 1].y}
                    r="4.5"
                    fill="#008455"
                  />
                </svg>
                <div className="mt-1 flex justify-between gap-2 overflow-x-auto text-[10.5px] tabular-nums text-muted-foreground">
                  {logins.map((l, i) => (
                    <span
                      key={l.week}
                      className={
                        i === logins.length - 1 ? "font-black text-[#008455]" : ""
                      }
                    >
                      {l.week} · {l.count}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-4">
          <Panel
            title="Accounts by strategy"
            subtitle={`${totals.accounts} accounts`}
          >
            <div className="flex flex-col gap-3">
              {schemes.map((s) => (
                <div
                  key={s.scheme}
                  className="grid grid-cols-[44px_1fr_38px] items-center gap-2.5 text-xs"
                >
                  <span className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                    {s.scheme}
                  </span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted-foreground/[0.07]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct(s.count, schemeMax)}%`,
                        background: SCHEME_COLOR[s.scheme] ?? NEUTRAL,
                      }}
                    />
                  </div>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] text-muted-foreground">
              {Object.entries(SCHEME_LABEL).map(([code, label]) => (
                <span key={code} className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: SCHEME_COLOR[code] }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Distributor book */}
      <Panel
        title="Distributor book"
        subtitle="Client accounts by partner"
        action={
          <Link
            href="/distributors/internal"
            className="rounded-md border border-border/20 px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            Manage partners
          </Link>
        }
      >
        {distributors.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No distributor-sourced accounts yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {distributors.map((d) => (
              <div
                key={d.name}
                className="grid grid-cols-[1fr_auto] items-center gap-3 text-[12.5px]"
              >
                <div className="min-w-0">
                  <p className="truncate text-foreground">{d.name}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted-foreground/[0.07]">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct(d.count, distributorMax)}%` }}
                    />
                  </div>
                </div>
                <span className="tabular-nums text-muted-foreground">{d.count}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
