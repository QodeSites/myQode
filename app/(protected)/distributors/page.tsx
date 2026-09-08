"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  STATUS_ORDER,
  STRATEGY_COLOR,
  NEUTRAL_COLOR,
  statusFor,
  onboardingRank,
  ONBOARDING_SEQUENCE,
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

/** Ranges offered on the book chart. days=null means the whole series. */
const BOOK_RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "3m", label: "3M", days: 90 },
  { key: "6m", label: "6M", days: 180 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "Since inception", days: null },
];

type BookPoint = {
  date: string;
  value: number;
  drawdown: number;
  accounts: number;
};

/** "12 Aug" — dense enough for a daily axis. */
function shortDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

type JourneyClient = {
  name: string | null;
  email: string | null;
  stage: string | null;
  accountLiveDate: string | null;
  activationDate: string | null;
  investedAmount: number | null;
  currentValue: number | null;
  strategies: string[];
  city: string | null;
  onboardingStage?: string | null;
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
      const key = statusFor(c.stage, c.onboardingStage).key;
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

  // Breakdown of the "Paperwork in progress" group, in the order an account
  // actually progresses — a partner wants to see who is nearly done and who
  // has barely started, which sorting by count would hide.
  const onboardingSteps = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      if (statusFor(c.stage, c.onboardingStage).key !== "onboarding") continue;
      if (!c.onboardingStage) continue;
      counts.set(c.onboardingStage, (counts.get(c.onboardingStage) ?? 0) + 1);
    }
    if (!counts.size) return [];

    // Show the whole path, not only the steps someone happens to be sitting
    // on. An empty step between two occupied ones is information: it says the
    // stage was passed, and a journey with gaps in it reads as a journey.
    //
    // Trimmed to the span actually in use — rendering all eleven when the
    // furthest anyone has reached is step five would pad the card with
    // stages nobody is near.
    const occupied = [...counts.keys()].map(onboardingRank);
    const last = Math.max(...occupied);
    return ONBOARDING_SEQUENCE.slice(0, last + 1).map((step) => ({
      step,
      count: counts.get(step) ?? 0,
    }));
  }, [clients]);

  // Book value history. Fetched separately from the journey: that payload
  // has one snapshot per investor, and a drawdown needs a curve.
  const [bookSeries, setBookSeries] = React.useState<BookPoint[]>([]);
  const [bookRange, setBookRange] = React.useState("all");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/distributor/book-history", {
          cache: "no-store",
        });
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { series?: BookPoint[] };
        if (!cancelled) setBookSeries(body.series ?? []);
      } catch {
        // The rest of the overview stands without this card.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // True when a range reaches further back than the data begins. Used to hide
  // ranges that would redraw an identical chart.
  const rangeHasData = React.useCallback(
    (days: number | null) => {
      if (!bookSeries.length) return false;
      if (days == null) return true;
      const first = new Date(bookSeries[0].date);
      const last = new Date(bookSeries[bookSeries.length - 1].date);
      const spanDays = (last.getTime() - first.getTime()) / 86400000;
      // Offer a window only if the data is meaningfully longer than it.
      return spanDays > days * 1.05;
    },
    [bookSeries],
  );

  const bookWindow = React.useMemo(() => {
    const empty = {
      points: [] as BookPoint[],
      last: 0,
      change: 0,
      changePct: 0,
      maxDrawdown: 0,
    };
    if (!bookSeries.length) return empty;

    const def = BOOK_RANGES.find((r) => r.key === bookRange) ?? BOOK_RANGES[3];
    let points = bookSeries;
    if (def.days != null) {
      const end = new Date(bookSeries[bookSeries.length - 1].date);
      const from = new Date(end);
      from.setDate(from.getDate() - def.days);
      points = bookSeries.filter((p) => new Date(p.date) >= from);
    }
    if (points.length < 2) return empty;

    // Drawdown is recomputed against the peak WITHIN the window. Carrying the
    // all-time peak into a 3M view would show a fall the period never had.
    let peak = 0;
    let maxDrawdown = 0;
    const rebased = points.map((p) => {
      if (p.value > peak) peak = p.value;
      const dd = peak > 0 ? ((p.value - peak) / peak) * 100 : 0;
      if (dd < maxDrawdown) maxDrawdown = dd;
      return { ...p, drawdown: dd };
    });

    const first = rebased[0].value;
    const last = rebased[rebased.length - 1].value;
    return {
      points: rebased,
      last,
      change: last - first,
      changePct: first > 0 ? ((last - first) / first) * 100 : 0,
      maxDrawdown,
    };
  }, [bookSeries, bookRange]);

  // Money brought in per month, by the date each investor was activated.
  // This is the strongest signal a partner has about their own momentum, and
  // nothing on the page showed it before.
  const monthlyInflow = React.useMemo(() => {
    const by = new Map<string, { amount: number; investors: number }>();
    for (const c of clients) {
      if (!c.activationDate || !c.investedAmount) continue;
      const key = String(c.activationDate).slice(0, 7);
      const row = by.get(key) ?? { amount: 0, investors: 0 };
      row.amount += c.investedAmount;
      row.investors += 1;
      by.set(key, row);
    }
    // Fill the gaps: a month where nobody invested is a real zero, and
    // skipping it would draw a flat line between two distant points.
    const keys = [...by.keys()].sort();
    if (!keys.length) return [];
    const out: { month: string; label: string; amount: number; investors: number }[] = [];
    const [sy, sm] = keys[0].split("-").map(Number);
    const [ey, em] = keys[keys.length - 1].split("-").map(Number);
    for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? (m = 1, y++) : m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const row = by.get(key);
      out.push({
        month: key,
        label: new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short" }),
        amount: row?.amount ?? 0,
        investors: row?.investors ?? 0,
      });
    }
    return out;
  }, [clients]);

  // Rupees per strategy, not just headcount. An investor holding three
  // strategies has their money split evenly across them: the per-strategy
  // amount is not in the payload, so this is an apportionment, and the card
  // says so rather than implying an exactness we do not have.
  const strategyMoney = React.useMemo(() => {
    const by = new Map<string, { value: number; investors: number }>();
    for (const c of clients) {
      if (!c.currentValue || !c.strategies.length) continue;
      const share = c.currentValue / c.strategies.length;
      for (const t of c.strategies) {
        const row = by.get(t) ?? { value: 0, investors: 0 };
        row.value += share;
        row.investors += 1;
        by.set(t, row);
      }
    }
    return [...by.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value);
  }, [clients]);

  // How much of the book rests on its largest few investors. A partner whose
  // top handful carry most of the money is exposed in a way a total hides.
  const concentration = React.useMemo(() => {
    const vals = clients
      .map((c) => c.currentValue ?? 0)
      .filter((v) => v > 0)
      .sort((a, b) => b - a);
    if (vals.length < 5) return null;
    const total = vals.reduce((a, b) => a + b, 0);
    if (!total) return null;
    return {
      topFivePct: (vals.slice(0, 5).reduce((a, b) => a + b, 0) / total) * 100,
      largest: vals[0],
      median: vals[Math.floor(vals.length / 2)],
      count: vals.length,
    };
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
             or call{" "}
            <a
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
              href="tel:+919326535470"
            >
              +91 9326535470
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
    (statusCounts.get("opened") ?? 0) + (statusCounts.get("onboarding") ?? 0);

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
                    First Fund Initiated
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
                    Not yet funded
                  </p>
                  <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-foreground">
                    {notYet}
                  </p>
                </div>
              </div>
            </div>

            {/* {partial || data.portalClientCount !== totals.investors ? (
              <p className="mt-4 border-t border-border/20 pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                {partial
                  ? `Values cover the ${totals.pricedCount} of ${totals.investors} investors whose holdings are priced in our records. `
                  : ""}
                {data.portalClientCount !== totals.investors
                  ? `You have ${data.portalClientCount} accounts across ${totals.investors} investors — one investor can hold several strategy accounts.`
                  : ""}
              </p>
            ) : null} */}
          </section>

          {/* Book value and drawdown over time.

              This is the one place a partner sees their book as a curve
              rather than a snapshot. Drawdown cannot come from the journey
              payload — that carries one current value per investor and no
              history — so it is read from pms_master_sheet and recomputed
              over the summed book. */}
          {bookSeries.length >= 2 ? (
            <Card
              title="Your book over time"
              description="Total value of every account you referred, and how far it has fallen below its peak."
            >
              <div className="flex flex-wrap items-center gap-2">
                {BOOK_RANGES.map((r) => {
                  // A range that reaches no further back than the data does
                  // is not offered — three buttons drawing the same chart
                  // would imply history that is not there.
                  if (!rangeHasData(r.days)) return null;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setBookRange(r.key)}
                      className={`min-h-[36px] rounded-md border px-3 text-[12px] font-semibold ${
                        bookRange === r.key
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/20 bg-background text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>

              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Value today
                  </dt>
                  <dd className="mt-0.5 font-sans text-xl font-bold tabular-nums text-foreground">
                    {money(bookWindow.last)}
                  </dd>
                </div>
                {/* Deliberately NOT a percentage. The book grew from 2
                    accounts to 82 over this history, so a percentage change in
                    total value reads as +663% and looks like a return. It is
                    almost entirely new money arriving. The rupee change is
                    honest about being a size change; performance belongs to
                    the investor-level figures above. */}
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Growth over period
                  </dt>
                  <dd
                    className="mt-0.5 font-sans text-xl font-bold tabular-nums"
                    style={{
                      color: bookWindow.change >= 0 ? QAW : "var(--destructive)",
                    }}
                  >
                    {bookWindow.change >= 0 ? "+" : "−"}
                    {money(Math.abs(bookWindow.change))}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Deepest fall
                  </dt>
                  <dd
                    className="mt-0.5 font-sans text-xl font-bold tabular-nums"
                    style={{ color: "var(--destructive)" }}
                  >
                    {bookWindow.maxDrawdown.toFixed(1)}%
                  </dd>
                </div>
              </dl>

              {/* Value */}
              <div className="mt-4 h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={bookWindow.points}
                    margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                  >
                    <defs>
                      <linearGradient id="bookval" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={QAW} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={QAW} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={40}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={shortDay}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={(v: number) =>
                        v >= 10000000
                          ? `${(v / 10000000).toFixed(1)}Cr`
                          : `${Math.round(v / 100000)}L`
                      }
                    />
                    <Tooltip
                      cursor={{ stroke: QAW, strokeOpacity: 0.3 }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        fontSize: 12,
                      }}
                      labelFormatter={(d: string) => formatDate(d)}
                      formatter={(v: number) => [money(v), "Book value"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={QAW}
                      strokeWidth={2}
                      fill="url(#bookval)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Drawdown, on its own axis beneath. Kept as a separate chart
                  rather than a second series: value in rupees and drawdown in
                  percent share no scale, and overlaying them would flatten
                  one of the two into a straight line. */}
              <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Below peak
              </p>
              <div className="mt-1 h-[110px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={bookWindow.points}
                    margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
                  >
                    <defs>
                      <linearGradient id="bookdd" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#550E0E" stopOpacity={0.05} />
                        <stop offset="100%" stopColor="#550E0E" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={40}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={shortDay}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      domain={[(dataMin: number) => Math.min(dataMin * 1.15, -0.5), 0]}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    />
                    <Tooltip
                      cursor={{ stroke: "#550E0E", strokeOpacity: 0.3 }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        fontSize: 12,
                      }}
                      labelFormatter={(d: string) => formatDate(d)}
                      formatter={(v: number) => [`${v.toFixed(2)}%`, "Below peak"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="drawdown"
                      stroke="#550E0E"
                      strokeWidth={1.5}
                      fill="url(#bookdd)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Early history is thin — the book began with two accounts and
                  grew to eighty-odd, so a rise here is mostly new money
                  arriving rather than markets moving. Saying so keeps the
                  curve from being read as performance. */}
              {bookWindow.points[0]?.accounts != null &&
              bookWindow.points[bookWindow.points.length - 1]?.accounts >
                bookWindow.points[0].accounts ? (
                <p className="mt-3 border-t border-border/20 pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  Accounts grew from {bookWindow.points[0].accounts} to{" "}
                  {bookWindow.points[bookWindow.points.length - 1].accounts} over
                  this period, so most of the rise in value is new money rather
                  than market movement.
                </p>
              ) : null}
            </Card>
          ) : null}

          {/* Money brought in, month by month. Two series in one reading:
              the area is rupees, the tooltip says how many investors that
              month accounted for. */}
          {monthlyInflow.length >= 2 ? (
            <Card
              title="Money you have brought in"
              description="By the month each investor started investing."
            >
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={monthlyInflow}
                    margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                  >
                    <defs>
                      <linearGradient id="inflow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={QAW} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={QAW} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={(v: number) =>
                        v >= 10000000
                          ? `${(v / 10000000).toFixed(1)}Cr`
                          : `${Math.round(v / 100000)}L`
                      }
                    />
                    <Tooltip
                      cursor={{ stroke: QAW, strokeOpacity: 0.3 }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        fontSize: 12,
                      }}
                      formatter={(v: number, _n: unknown, item: { payload?: { investors?: number } }) => [
                        `${money(v)} from ${item?.payload?.investors ?? 0} ${
                          item?.payload?.investors === 1 ? "investor" : "investors"
                        }`,
                        "Brought in",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke={QAW}
                      strokeWidth={2}
                      fill="url(#inflow)"
                      dot={{ r: 3, fill: QAW }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          {/* Where the money sits, and how exposed the book is. Side by side:
              both answer the same question about the shape of the book. */}
          <div className="grid gap-5 md:grid-cols-2">
            {strategyMoney.length ? (
              <Card
                title="Where the money sits"
                description="Split evenly for investors holding more than one strategy."
              >
                <div className="flex items-center gap-4">
                  <div className="h-[150px] w-[150px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={strategyMoney}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={44}
                          outerRadius={70}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {strategyMoney.map((d) => (
                            <Cell
                              key={d.name}
                              fill={STRATEGY_COLOR[d.name] ?? NEUTRAL_COLOR}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "var(--card)",
                            fontSize: 12,
                          }}
                          formatter={(v: number) => money(v)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-2">
                    {strategyMoney.map((d) => (
                      <li key={d.name} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1 size-2.5 shrink-0 rounded-full"
                          style={{
                            background: STRATEGY_COLOR[d.name] ?? NEUTRAL_COLOR,
                          }}
                        />
                        <span className="min-w-0">
                          <Link
                            href={`/distributors/investors?strategy=${encodeURIComponent(d.name)}`}
                            className="block truncate text-[13px] text-foreground underline-offset-4 hover:underline"
                          >
                            {d.name}
                          </Link>
                          <span className="text-[12px] tabular-nums text-muted-foreground">
                            {money(d.value)} · {d.investors}{" "}
                            {d.investors === 1 ? "investor" : "investors"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            ) : null}

            {concentration ? (
              <Card
                title="How concentrated your book is"
                description="A book resting on a few large investors carries a risk a total hides."
              >
                <p className="font-sans text-[32px] font-bold leading-none tabular-nums text-foreground">
                  {concentration.topFivePct.toFixed(0)}%
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  of your book sits with the largest 5 of {concentration.count}{" "}
                  funded clients.
                </p>
                {/* A bar reads faster than the number alone. */}
                <div
                  className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Top five investors hold ${concentration.topFivePct.toFixed(0)} percent of the book`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(concentration.topFivePct, 100)}%`,
                      background: QAW,
                    }}
                  />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border/20 pt-3">
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Largest
                    </dt>
                    <dd className="mt-0.5 font-sans text-lg font-bold tabular-nums text-foreground">
                      {money(concentration.largest)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Typical
                    </dt>
                    <dd className="mt-0.5 font-sans text-lg font-bold tabular-nums text-foreground">
                      {money(concentration.median)}
                    </dd>
                  </div>
                </dl>
              </Card>
            ) : null}
          </div>

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

          {/* Onboarding journey — the path an account takes to open */}
          {onboardingSteps.length ? (
            <Card
              title="The onboarding journey"
              description="Where your investors have reached on the way to opening an account."
            >
              {/* Horizontal: the path reads left to right, the way a
                  journey is drawn. Long step names and up to eleven steps
                  cannot fit across a phone, so this scrolls inside its own
                  container — never the page. */}
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <ol className="flex min-w-max items-start">
                  {onboardingSteps.map(({ step, count }, i) => {
                    const isLast = i === onboardingSteps.length - 1;
                    const here = count > 0;
                    return (
                      <li
                        key={step}
                        className="flex w-[132px] shrink-0 flex-col items-center"
                      >
                        {/* Marker, with the connecting line running through
                            it at the same height on both sides. */}
                        <div className="flex w-full items-center">
                          <span
                            aria-hidden="true"
                            className="h-px flex-1 bg-border/30"
                            style={{ visibility: i === 0 ? "hidden" : undefined }}
                          />
                          <span
                            aria-hidden="true"
                            className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-black tabular-nums ${
                              here
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/30 bg-background text-muted-foreground"
                            }`}
                          >
                            {here ? count : ""}
                          </span>
                          <span
                            aria-hidden="true"
                            className="h-px flex-1 bg-border/30"
                            style={{ visibility: isLast ? "hidden" : undefined }}
                          />
                        </div>

                        {/* Step name. Occupied steps are links; empty ones
                            are not — there is nobody there to look at. */}
                        {/* Fixed height: step names run to three lines
                            ("Form Sent to Investor for Signature") and a
                            taller label would otherwise push its own count
                            below its neighbours', breaking the line the
                            journey is meant to read along. */}
                        <div className="mt-2 flex h-[52px] flex-col px-1 text-center">
                          {here ? (
                            <Link
                              href="/distributors/investors?status=onboarding"
                              className="text-[12px] leading-snug text-foreground underline-offset-4 hover:underline"
                            >
                              {step}
                            </Link>
                          ) : (
                            <span className="text-[12px] leading-snug text-muted-foreground/70">
                              {step}
                            </span>
                          )}
                          {here ? (
                            <p className="mt-auto pt-0.5 text-[11px] text-muted-foreground">
                              {count} {count === 1 ? "investor" : "investors"}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
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
              title="Recently funded"
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
