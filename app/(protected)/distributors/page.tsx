"use client";

import * as React from "react";
import { Check, Copy, Mail, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Partner dashboard — everything a distributor needs about their own book.
 *
 * Scoped entirely server-side: /api/distributor/journey resolves the partner
 * from the httpOnly session and can only ever return their own investors.
 */

/** Funnel order first, inactive last. Mirrors STAGE_ORDER in
 *  lib/zohoDistributorJourney.ts, kept as a literal so the client bundle does
 *  not pull in the server-only Zoho module. */
const STAGE_ORDER = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
  "Dormant Investor",
  "Dropped before account opening",
  "Dropped after account opening",
] as const;

const DROP_STAGES = new Set<string>([
  "Dormant Investor",
  "Dropped before account opening",
  "Dropped after account opening",
]);

const QAW = "#008455";

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

/** Renders an ISO date as "07 Jul 2026". Null-safe. */
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

/** Indian grouping, crore/lakh shorthand above a lakh. */
function money(n: number | null): string {
  if (n == null) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function CopyLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The
      // full URL is on screen and selectable, so a failed copy is an
      // inconvenience rather than a dead end.
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

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-xl border border-border/20 bg-card px-4 py-3.5">
      <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-1.5 font-sans text-[26px] font-bold leading-none tabular-nums"
        style={{
          color: tone === "good" ? QAW : tone === "warn" ? "var(--destructive)" : undefined,
        }}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
      </div>
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
  const [stageFilter, setStageFilter] = React.useState<string>("");

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

  const visible = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (stageFilter && c.stage !== stageFilter) return false;
      if (!needle) return true;
      return [c.name, c.email, c.city, c.stage, ...c.strategies]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [clients, q, stageFilter]);

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[96px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Partner dashboard</h1>
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
        <h1 className="text-2xl">Partner dashboard</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load your dashboard. Please refresh the page, or contact{" "}
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

  const stageCounts = data.journey?.stageCounts ?? {};
  const live = (stageCounts["Account Live"] ?? 0) + (stageCounts["Regular Investor"] ?? 0);
  const inProgress =
    (stageCounts["Onboarding"] ?? 0) + (stageCounts["First Fund Initiated"] ?? 0);
  const needsAttention = clients.filter(
    (c) => c.annualReviewStatus === "Not Done",
  ).length;

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Partner dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.distributor.name}
        </p>
      </header>

      {/* Headline figures */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Investors referred"
          value={String(data.totals.investors)}
          detail={`${data.portalClientCount} accounts with us`}
        />
        <Tile
          label="Book value"
          value={money(data.totals.currentValue)}
          detail={
            data.totals.pricedCount && data.totals.pricedCount < data.totals.investors
              ? `${data.totals.pricedCount} of ${data.totals.investors} valued`
              : data.totals.invested != null
                ? `${money(data.totals.invested)} invested`
                : undefined
          }
          tone="good"
        />
        <Tile
          label="Live investors"
          value={String(live)}
          detail={`${inProgress} still onboarding`}
        />
        <Tile
          label="Reviews due"
          value={String(needsAttention)}
          detail="annual review not done"
          tone={needsAttention > 0 ? "warn" : undefined}
        />
      </div>

      {/* Referral links */}
      <Section
        title="Please use these links to refer to your investors"
        description="Anyone who onboards through your link is recorded against your name. Use the Individual link for a person, and the Non-Individual link for a company, LLP, HUF or trust."
      >
        {data.referralLinks ? (
          <div className="flex flex-col gap-3">
            <CopyLinkRow label="Individual" url={data.referralLinks.individual} />
            <CopyLinkRow
              label="Non-Individual"
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

      {/* Journey */}
      <Section
        title="Your investors"
        description={
          data.zohoAvailable && data.crmLinked
            ? "Where each investor you referred currently stands."
            : undefined
        }
      >
        {!data.zohoAvailable ? (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load investor data from our CRM just now. Your referral
              links above are unaffected — please try again shortly.
            </p>
          </div>
        ) : !data.crmLinked ? (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t link this login to your CRM record, so your investors
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
              No investors have been referred through your links yet. Share a link above
              to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Stage filters — the counts double as the control. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStageFilter("")}
                aria-pressed={stageFilter === ""}
                className={`min-h-[36px] rounded-full border px-3 text-xs font-bold transition-colors ${
                  stageFilter === ""
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/20 bg-background text-muted-foreground hover:border-primary/50"
                }`}
              >
                All {clients.length}
              </button>
              {STAGE_ORDER.filter((st) => (stageCounts[st] ?? 0) > 0).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStageFilter(stageFilter === st ? "" : st)}
                  aria-pressed={stageFilter === st}
                  className={`min-h-[36px] rounded-full border px-3 text-xs font-bold transition-colors ${
                    stageFilter === st
                      ? "border-primary bg-primary text-primary-foreground"
                      : DROP_STAGES.has(st)
                        ? "border-destructive/30 bg-background text-destructive hover:border-destructive"
                        : "border-border/20 bg-background text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {st} {stageCounts[st]}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, email, city or strategy"
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
                  No investors match this view. Try a different search or clear the
                  stage filter.
                </p>
              </div>
            ) : (
              <>
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing {visible.length} of {clients.length}
                </p>

                {/* Desktop table */}
                <div className="mt-2 hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[860px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/20 text-left">
                        {[
                          "Investor",
                          "Stage",
                          "Strategies",
                          "Invested",
                          "Value",
                          "Account live",
                        ].map((h, i) => (
                          <th
                            key={h}
                            className={`py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground last:pr-0 ${
                              i === 3 || i === 4 ? "text-right" : ""
                            }`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((c, i) => (
                        <tr
                          key={`${c.email ?? "no-email"}-${i}`}
                          className="border-b border-border/10 last:border-0"
                        >
                          <td className="py-2.5 pr-4">
                            <span className="text-foreground">{c.name ?? "—"}</span>
                            {c.city ? (
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                {c.city}
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={`py-2.5 pr-4 ${
                              c.stage && DROP_STAGES.has(c.stage)
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {c.stage ?? "—"}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {c.strategies.length
                              ? c.strategies
                                  .map((st) =>
                                    st.replace("Qode ", "").replace(" Fund", ""),
                                  )
                                  .join(", ")
                              : "—"}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                            {money(c.investedAmount)}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                            {money(c.currentValue)}
                          </td>
                          <td className="py-2.5 tabular-nums text-muted-foreground">
                            {formatDate(c.accountLiveDate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: stacked cards, per the design system — a six-column
                    table is unreadable on a phone even with a scroll wrapper. */}
                <ul className="mt-2 flex flex-col gap-2 sm:hidden">
                  {visible.map((c, i) => (
                    <li
                      key={`${c.email ?? "no-email"}-m-${i}`}
                      className="rounded-md border border-border/20 bg-background px-4 py-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {c.name ?? "—"}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-foreground">
                          {money(c.currentValue)}
                        </span>
                      </div>
                      <p
                        className={`mt-1 text-xs ${
                          c.stage && DROP_STAGES.has(c.stage)
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {c.stage ?? "—"}
                        {c.city ? ` · ${c.city}` : ""}
                      </p>
                      {c.strategies.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.strategies.map((st) => (
                            <span
                              key={st}
                              className="rounded-full border border-border/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                            >
                              {st.replace("Qode ", "").replace(" Fund", "")}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Section>

      {/* Payout */}
      <Section title="Payout status">
        <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Payout status will appear here once it is published from our operations
            system.
          </p>
        </div>
      </Section>

      {/* Contact */}
      <Section
        title="Need help?"
        description="For questions about your investors, referral links or payouts, email us and the partnerships team will get back to you."
      >
        <a
          href="mailto:partnerships@qodeinvest.com"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border/20 bg-card px-4 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground dark:text-primary-foreground"
        >
          <Mail className="size-4" />
          partnerships@qodeinvest.com
        </a>
      </Section>
    </div>
  );
}
