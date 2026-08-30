"use client";

import * as React from "react";
import { Check, ChevronRight, Copy, Mail, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Partner dashboard.
 *
 * Structured around the three questions a partner opens this to answer, in
 * order: how is my book doing, what changed since I last looked, and who are
 * my investors. Referral links and contact sit below that — they are setup,
 * not daily use.
 *
 * Scoped entirely server-side: /api/distributor/journey resolves the partner
 * from the httpOnly session and can only ever return their own investors.
 */

const QAW = "#008455";

/**
 * CRM stages translated into what they mean for a partner.
 *
 * The raw values are internal vocabulary — a distributor should not have to
 * work out the difference between "Account Live" and "Regular Investor", or
 * what "First Fund Initiated" implies. Each group carries a one-line
 * explanation so the number never needs decoding.
 */
const STAGE_GROUPS = [
  {
    key: "investing",
    label: "Investing",
    detail: "Money is in the market",
    stages: ["Account Live", "Regular Investor"],
    tone: "good" as const,
  },
  {
    key: "funding",
    label: "Funding",
    detail: "First investment on its way",
    stages: ["First Fund Initiated"],
    tone: "normal" as const,
  },
  {
    key: "onboarding",
    label: "Onboarding",
    detail: "Still completing paperwork",
    stages: ["Onboarding"],
    tone: "normal" as const,
  },
  {
    key: "inactive",
    label: "Not proceeding",
    detail: "Dropped out or dormant",
    stages: [
      "Dormant Investor",
      "Dropped before account opening",
      "Dropped after account opening",
    ],
    tone: "warn" as const,
  },
];

/** Short label shown on each investor row, in the partner's language. */
const STAGE_LABEL: Record<string, string> = {
  "Account Live": "Investing",
  "Regular Investor": "Investing",
  "First Fund Initiated": "Funding",
  Onboarding: "Onboarding",
  "Dormant Investor": "Dormant",
  "Dropped before account opening": "Dropped",
  "Dropped after account opening": "Dropped",
};

const INACTIVE = new Set(
  STAGE_GROUPS.find((g) => g.key === "inactive")!.stages,
);

type JourneyClient = {
  name: string | null;
  email: string | null;
  stage: string | null;
  stageEntryDate: string | null;
  activationDate: string | null;
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
  investedAmount: number | null;
  currentValue: number | null;
  strategies: string[];
  relationshipManager: string | null;
  city: string | null;
  nextContactDate: string | null;
  annualReviewStatus: string | null;
};

type JourneyResponse = {
  distributor: { name: string; email: string };
  /** Null when no onboarding slug is recorded for this partner. */
  referralLinks: { individual: string; nonIndividual: string } | null;
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

/** Indian grouping, crore/lakh shorthand above a lakh. Sign-aware. */
function money(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function CopyLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The URL
      // is on screen and selectable, so this is an inconvenience, not a dead end.
      setCopied(false);
    }
  }, [url]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/20 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <code className="mt-1 block break-all text-xs text-foreground">{url}</code>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label} referral link`}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md border border-border/20 bg-card px-4 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground dark:text-primary-foreground"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Section({
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
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DistributorsPage() {
  const [data, setData] = React.useState<JourneyResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "forbidden" | "error">(
    "loading",
  );
  const [q, setQ] = React.useState("");
  const [group, setGroup] = React.useState<string>("");
  // How many investor rows are rendered. Kept small by default — the list is
  // for scanning the top of the book, not reading end to end.
  const [shown, setShown] = React.useState(10);

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

  const groupCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of STAGE_GROUPS) {
      counts[g.key] = clients.filter(
        (c) => c.stage && g.stages.includes(c.stage),
      ).length;
    }
    return counts;
  }, [clients]);

  const visible = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const g = STAGE_GROUPS.find((x) => x.key === group);
    return clients
      .filter((c) => {
        if (g && !(c.stage && g.stages.includes(c.stage))) return false;
        if (!needle) return true;
        return [c.name, c.email, c.city, ...c.strategies]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      // Largest holdings first — what a partner scans for.
      .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));
  }, [clients, q, group]);

  React.useEffect(() => {
    setShown(10);
  }, [q, group]);

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Dashboard</h1>
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
        <h1 className="text-2xl">Dashboard</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load your dashboard. Please refresh, or contact{" "}
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
  const partialPricing = totals.pricedCount > 0 && totals.pricedCount < totals.investors;
  const live = data.crmLinked && data.zohoAvailable;

  // Accounts that went live in the last 30 days — the "something happened
  // since I last looked" signal, which is what brings someone back daily.
  const recent = clients
    .filter((c) => {
      if (!c.accountLiveDate) return false;
      const d = new Date(c.accountLiveDate).getTime();
      return !Number.isNaN(d) && Date.now() - d < 30 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => String(b.accountLiveDate).localeCompare(String(a.accountLiveDate)));

  const inProgress = (groupCounts.onboarding ?? 0) + (groupCounts.funding ?? 0);

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.distributor.name}</p>
      </header>

      {/* ── 1. How is my book doing? ──────────────────────────────────────── */}
      {live && totals.investors > 0 ? (
        <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Your book today
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
                    against {money(invested)} invested
                  </span>
                </p>
              ) : null}
            </div>

            <div className="flex gap-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Investors
                </p>
                <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-foreground">
                  {totals.investors}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Investing
                </p>
                <p
                  className="mt-1 font-sans text-2xl font-bold tabular-nums"
                  style={{ color: QAW }}
                >
                  {groupCounts.investing ?? 0}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  In progress
                </p>
                <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-foreground">
                  {inProgress}
                </p>
              </div>
            </div>
          </div>

          {/* Two numbers that otherwise look contradictory, explained where
              they appear rather than left for the reader to reconcile. */}
          {partialPricing || data.portalClientCount !== totals.investors ? (
            <p className="mt-4 border-t border-border/20 pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              {partialPricing
                ? `Values cover the ${totals.pricedCount} of ${totals.investors} investors whose holdings are priced in our records. `
                : ""}
              {data.portalClientCount !== totals.investors
                ? `You have ${data.portalClientCount} accounts across ${totals.investors} investors — one investor can hold several strategy accounts.`
                : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── 2. What changed since I last looked? ──────────────────────────── */}
      {live && recent.length > 0 ? (
        <Section
          title="Recently started investing"
          description={`${recent.length} ${recent.length === 1 ? "investor" : "investors"} went live in the last 30 days.`}
        >
          <ul className="flex flex-col gap-2">
            {recent.slice(0, 3).map((c, i) => (
              <li
                key={`${c.email ?? "x"}-recent-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/20 bg-background px-4 py-2.5"
              >
                <div className="min-w-0">
                  <span className="text-sm text-foreground">{c.name ?? "—"}</span>
                  {c.strategies.length ? (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {c.strategies
                        .map((s) => s.replace("Qode ", "").replace(" Fund", ""))
                        .join(", ")}
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
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ── 3. Who are my investors? ──────────────────────────────────────── */}
      <Section title="Your investors">
        {!data.zohoAvailable ? (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load investor data just now. Please try again shortly.
            </p>
          </div>
        ) : !data.crmLinked ? (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t link this login to your records, so your investors
              can&apos;t be shown yet.
              {data.portalClientCount > 0 ? (
                <>
                  {" "}
                  You currently have{" "}
                  <span className="font-bold text-foreground">
                    {data.portalClientCount}
                  </span>{" "}
                  {data.portalClientCount === 1 ? "account" : "accounts"} with us.
                </>
              ) : null}{" "}
              Email{" "}
              <a
                className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
                href="mailto:partnerships@qodeinvest.com"
              >
                partnerships@qodeinvest.com
              </a>{" "}
              and we&apos;ll connect it.
            </p>
          </div>
        ) : clients.length === 0 ? (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No investors have been referred through your links yet. Share a link
              below to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Plain-language groups. Each card explains its own number, so a
                partner never has to interpret CRM wording. */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <button
                type="button"
                onClick={() => setGroup("")}
                aria-pressed={group === ""}
                className={`rounded-md border px-3 py-2.5 text-left transition-colors hover:border-primary/50 ${
                  group === ""
                    ? "border-primary bg-primary/5"
                    : "border-border/20 bg-background"
                }`}
              >
                <p className="font-sans text-xl font-bold tabular-nums text-foreground">
                  {clients.length}
                </p>
                <p className="mt-0.5 text-[11px] font-bold text-foreground">
                  All investors
                </p>
                <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
                  Everyone you referred
                </p>
              </button>

              {STAGE_GROUPS.filter((g) => (groupCounts[g.key] ?? 0) > 0).map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroup(group === g.key ? "" : g.key)}
                  aria-pressed={group === g.key}
                  className={`rounded-md border px-3 py-2.5 text-left transition-colors hover:border-primary/50 ${
                    group === g.key
                      ? "border-primary bg-primary/5"
                      : "border-border/20 bg-background"
                  }`}
                >
                  <p
                    className="font-sans text-xl font-bold tabular-nums"
                    style={{
                      color:
                        g.tone === "good"
                          ? QAW
                          : g.tone === "warn"
                            ? "var(--destructive)"
                            : undefined,
                    }}
                  >
                    {groupCounts[g.key]}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-foreground">
                    {g.label}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
                    {g.detail}
                  </p>
                </button>
              ))}
            </div>

            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, city or strategy"
                aria-label="Search your investors"
                className="min-h-[44px] w-full rounded-md border border-border/20 bg-background py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
              />
              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            {visible.length === 0 ? (
              <div className="mt-4 rounded-md border border-border/20 bg-background px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No investors match this view. Try a different search, or choose
                  &ldquo;All investors&rdquo; above.
                </p>
              </div>
            ) : (
              <>
                <p className="mt-3 text-xs text-muted-foreground">
                  {visible.length === clients.length
                    ? `${clients.length} investors, largest holdings first`
                    : `Showing ${visible.length} of ${clients.length}`}
                </p>

                {/* One row per investor, same shape at every width — no table
                    to scroll sideways on a phone. Value leads on the right
                    because that is what gets scanned. */}
                <ul className="mt-2 flex flex-col gap-1.5">
                  {visible.slice(0, shown).map((c, i) => {
                    const inactive = c.stage ? INACTIVE.has(c.stage) : false;
                    const delta =
                      c.currentValue != null && c.investedAmount != null
                        ? c.currentValue - c.investedAmount
                        : null;
                    const up = delta != null && delta >= 0;

                    return (
                      <li
                        key={`${c.email ?? "x"}-${i}`}
                        className="rounded-md border border-border/20 bg-background px-4 py-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-foreground">
                                {c.name ?? "—"}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                  inactive
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-muted-foreground/10 text-muted-foreground"
                                }`}
                              >
                                {c.stage ? (STAGE_LABEL[c.stage] ?? c.stage) : "—"}
                              </span>
                            </div>
                            <p className="mt-1 text-[11.5px] text-muted-foreground">
                              {[
                                c.city,
                                c.strategies
                                  .map((s) =>
                                    s.replace("Qode ", "").replace(" Fund", ""),
                                  )
                                  .join(", ") || null,
                                c.accountLiveDate
                                  ? `Live ${formatDate(c.accountLiveDate)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "No details recorded yet"}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="font-sans text-base font-bold tabular-nums text-foreground">
                              {money(c.currentValue)}
                            </p>
                            {delta != null ? (
                              <p
                                className="text-[11px] tabular-nums"
                                style={{ color: up ? QAW : "var(--destructive)" }}
                              >
                                {up ? "▲" : "▼"} {money(Math.abs(delta))}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">
                                Not yet valued
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {visible.length > shown ? (
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + 25)}
                    className="mt-3 min-h-[44px] w-full rounded-md border border-border/20 bg-background text-sm font-bold text-primary hover:border-primary/50 dark:text-primary-foreground"
                  >
                    Show {Math.min(25, visible.length - shown)} more
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      ({visible.length - shown} remaining)
                    </span>
                  </button>
                ) : null}
              </>
            )}
          </>
        )}
      </Section>

      {/* ── Setup: referral links and help, paired ────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Section
        title="Refer a new investor"
        description="Share your link. Anyone who onboards through it is recorded against your name."
      >
        {data.referralLinks ? (
          <div className="flex flex-col gap-3">
            <CopyLinkRow label="Individual" url={data.referralLinks.individual} />
            <CopyLinkRow
              label="Company, LLP, HUF or trust"
              url={data.referralLinks.nonIndividual}
            />
          </div>
        ) : (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Your referral links haven&apos;t been set up yet. Email{" "}
              <a
                className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
                href="mailto:partnerships@qodeinvest.com"
              >
                partnerships@qodeinvest.com
              </a>{" "}
              and we&apos;ll create them for you.
            </p>
          </div>
        )}
        </Section>

        <a
          href="mailto:partnerships@qodeinvest.com"
          className="flex items-start gap-3 rounded-xl border border-border/20 bg-card px-5 py-5 shadow-sm hover:border-primary/50"
        >
          <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">
              Questions about your investors or payouts?
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Email partnerships@qodeinvest.com — we usually reply the same day.
            </p>
          </div>
          <ChevronRight className="ml-auto mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </a>
      </div>
    </div>
  );
}
