"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATUS_ORDER,
  STRATEGY_COLOR,
  NEUTRAL_COLOR,
  statusFor,
  type StatusInfo,
} from "@/lib/distributorVocabulary";

/**
 * Partner overview — the shape of their book at a glance.
 *
 * Charts and figures only. The investor list lives at
 * /distributors/investors, so this page answers "how am I doing?" without
 * anyone scrolling past a table to find out.
 */

const QAW = "#008455";

type JourneyClient = {
  name: string | null;
  email: string | null;
  stage: string | null;
  accountLiveDate: string | null;
  investedAmount: number | null;
  currentValue: number | null;
  strategies: string[];
  city: string | null;
};

type JourneyResponse = {
  distributor: { name: string; email: string };
  journey: { clients: JourneyClient[]; stageCounts: Record<string, number> } | null;
  totals: {
    investors: number;
    invested: number | null;
    currentValue: number | null;
    pricedCount: number;
  };
  zohoAvailable: boolean;
  crmLinked: boolean;
  portalClientCount: number;
};

/** Indian grouping, crore/lakh shorthand above a lakh. Sign-aware. */
function money(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toneColor(tone: StatusInfo["tone"]): string {
  if (tone === "good") return QAW;
  if (tone === "warn") return "var(--destructive)";
  return NEUTRAL_COLOR;
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DistributorOverviewPage() {
  const [data, setData] = React.useState<JourneyResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "forbidden" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/distributor/journey", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setStatus("forbidden");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        setData((await res.json()) as JourneyResponse);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clients = data?.journey?.clients ?? [];

  const statusCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      const key = statusFor(c.stage).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [clients]);

  const strategyCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      for (const s of c.strategies) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [clients]);

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Overview</h1>
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            This page is for Qode distribution partners. If you think you should have
            access, email{" "}
            <a
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
              href="mailto:partnerships@qodeinvest.com"
            >
              partnerships@qodeinvest.com
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Overview</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load your overview. Please refresh, or contact{" "}
            <a
              className="font-bold underline underline-offset-4"
              href="mailto:partnerships@qodeinvest.com"
            >
              partnerships@qodeinvest.com
            </a>{" "}
            if this keeps happening.
          </p>
        </div>
      </div>
    );
  }

  const { totals } = data;
  const invested = totals.invested;
  const value = totals.currentValue;
  const gain = invested != null && value != null ? value - invested : null;
  const gainPct = gain != null && invested ? (gain / invested) * 100 : null;
  const partial = totals.pricedCount > 0 && totals.pricedCount < totals.investors;
  const live = data.crmLinked && data.zohoAvailable;

  const investedCount = statusCounts.get("invested") ?? 0;
  const notYet =
    (statusCounts.get("opened") ?? 0) + (statusCounts.get("paperwork") ?? 0);

  // "Recently started investing" must mean exactly that. accountLiveDate is
  // set when the account opens, which for an opened-but-unfunded investor is
  // not an investment date — requiring a value keeps the heading truthful.
  const recent = clients
    .filter((c) => {
      if (!c.accountLiveDate || c.currentValue == null) return false;
      const d = new Date(c.accountLiveDate).getTime();
      return !Number.isNaN(d) && Date.now() - d < 30 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => String(b.accountLiveDate).localeCompare(String(a.accountLiveDate)));

  const strategyMax = strategyCounts.length ? strategyCounts[0][1] : 1;
  const visibleStatuses = STATUS_ORDER.filter((s) => (statusCounts.get(s.key) ?? 0) > 0);

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.distributor.name}</p>
      </header>

      {!live ? (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {!data.zohoAvailable
              ? "We couldn't load your investor data just now. Please try again shortly."
              : "We couldn't link this login to your records, so your investors can't be shown yet."}
            {data.crmLinked ? null : (
              <>
                {" "}
                Email{" "}
                <a
                  className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
                  href="mailto:partnerships@qodeinvest.com"
                >
                  partnerships@qodeinvest.com
                </a>{" "}
                and we&apos;ll connect it.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          {/* Total value today */}
          <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Total value today
                </p>
                <p className="mt-1.5 font-sans text-[38px] font-bold leading-none tabular-nums text-foreground">
                  {money(value)}
                </p>
                {gain != null && gainPct != null ? (
                  <p className="mt-2 text-sm">
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: gain >= 0 ? QAW : "var(--destructive)" }}
                    >
                      {gain >= 0 ? "▲" : "▼"} {money(Math.abs(gain))} (
                      {gain >= 0 ? "+" : "−"}
                      {Math.abs(gainPct).toFixed(1)}%)
                    </span>{" "}
                    <span className="text-muted-foreground">
                      against {money(invested)} put in
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="flex gap-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Your investors
                  </p>
                  <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-foreground">
                    {totals.investors}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Invested
                  </p>
                  <p
                    className="mt-1 font-sans text-2xl font-bold tabular-nums"
                    style={{ color: QAW }}
                  >
                    {investedCount}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Not yet invested
                  </p>
                  <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-foreground">
                    {notYet}
                  </p>
                </div>
              </div>
            </div>

            {partial || data.portalClientCount !== totals.investors ? (
              <p className="mt-4 border-t border-border/20 pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                {partial
                  ? `Values cover the ${totals.pricedCount} of ${totals.investors} investors whose holdings are priced in our records. `
                  : ""}
                {data.portalClientCount !== totals.investors
                  ? `You have ${data.portalClientCount} accounts across ${totals.investors} investors — one investor can hold several strategy accounts.`
                  : ""}
              </p>
            ) : null}
          </section>

          {/* Where your investors are */}
          {visibleStatuses.length ? (
            <Card
              title="Where your investors are"
              description="Every investor you referred, by how far along they are."
            >
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted-foreground/[0.07]">
                {visibleStatuses.map((s) => {
                  const n = statusCounts.get(s.key) ?? 0;
                  return (
                    <div
                      key={s.key}
                      title={`${n} ${s.label}`}
                      style={{
                        width: `${(n / Math.max(clients.length, 1)) * 100}%`,
                        background: toneColor(s.tone),
                      }}
                    />
                  );
                })}
              </div>

              {/* Each row filters the investor list. The label carries its own
                  meaning — an explanatory clause beside it would be padding. */}
              <ul className="mt-4 flex flex-col gap-1">
                {visibleStatuses.map((s) => (
                  <li key={s.key}>
                    <Link
                      href={`/distributors/investors?status=${s.key}`}
                      className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-background"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ background: toneColor(s.tone) }}
                      />
                      <span className="font-sans text-sm font-bold tabular-nums text-foreground">
                        {statusCounts.get(s.key)}
                      </span>
                      <span className="text-sm text-foreground">{s.label}</span>
                      <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Strategy split */}
          {strategyCounts.length ? (
            <Card
              title="Which strategies they hold"
              description="An investor holding two strategies is counted in both."
            >
              <div className="flex flex-col gap-3">
                {strategyCounts.map(([name, n]) => (
                  <Link
                    key={name}
                    href={`/distributors/investors?strategy=${encodeURIComponent(name)}`}
                    className="-mx-2 block min-w-0 rounded-md px-2 py-1 hover:bg-background"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] text-foreground">{name}</span>
                      <span className="text-[11.5px] tabular-nums text-muted-foreground">
                        {n} {n === 1 ? "investor" : "investors"}
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted-foreground/[0.07]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(n / strategyMax) * 100}%`,
                          background: STRATEGY_COLOR[name] ?? NEUTRAL_COLOR,
                        }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Recently invested */}
          {recent.length ? (
            <Card
              title="Recently started investing"
              description={`${recent.length} ${recent.length === 1 ? "investor" : "investors"} in the last 30 days.`}
            >
              <ul className="flex flex-col gap-2">
                {recent.slice(0, 3).map((c, i) => (
                  <li key={`${c.email ?? "x"}-${i}`}>
                    <Link
                      href={
                        c.email
                          ? `/distributors/investors/${encodeURIComponent(c.email)}`
                          : "/distributors/investors"
                      }
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/20 bg-background px-4 py-2.5 hover:border-primary/50"
                    >
                    <div className="min-w-0">
                      <span className="text-sm text-foreground">{c.name ?? "—"}</span>
                      {c.strategies.length ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {c.strategies.join(", ")}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums text-foreground">
                        {money(c.currentValue)}
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {formatDate(c.accountLiveDate)}
                      </span>
                    </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}

      {/* Where to go next */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/distributors/investors"
          className="flex items-center gap-3 rounded-xl border border-border/20 bg-card px-5 py-4 shadow-sm hover:border-primary/50"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">See all your investors</p>
            <p className="text-[11.5px] text-muted-foreground">
              Search, filter and download statements
            </p>
          </div>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </Link>

        <Link
          href="/distributors/referrals"
          className="flex items-center gap-3 rounded-xl border border-border/20 bg-card px-5 py-4 shadow-sm hover:border-primary/50"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Refer an investor</p>
            <p className="text-[11.5px] text-muted-foreground">
              Your onboarding links
            </p>
          </div>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}
