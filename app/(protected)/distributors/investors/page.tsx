"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATUS_ORDER,
  shortStrategy,
  statusFor,
  type StatusInfo,
} from "@/lib/distributorVocabulary";

/**
 * The partner's investor list.
 *
 * Separated from the overview so neither page has to be long. This one is for
 * finding a specific investor and acting on them; the overview is for the
 * shape of the book.
 */

const QAW = "#008455";

type JourneyClient = {
  name: string | null;
  email: string | null;
  clientCode?: string | null;
  stage: string | null;
  onboardingStage?: string | null;
  accountLiveDate: string | null;
  activationDate: string | null;
  investedAmount: number | null;
  currentValue: number | null;
  strategies: string[];
  city: string | null;
};

type JourneyResponse = {
  distributor: { name: string; email: string };
  journey: { clients: JourneyClient[]; stageCounts: Record<string, number> } | null;
  totals: { investors: number };
  zohoAvailable: boolean;
  crmLinked: boolean;
  portalClientCount: number;
};

function money(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * When an investor was funded.
 *
 * Activation_Date is the primary record, but all five investors whose
 * Onboarding_Stage reads "Funded less than 50L" have it empty — they are
 * counted as funded in the status chips while being invisible to a filter
 * that reads Activation_Date alone. Date_Of_1st_Investment is populated for
 * those records, so it stands in.
 *
 * The two are not the same field and the fallback is deliberate rather than
 * an equivalence: for an investor with both, Activation_Date wins.
 */
function fundedDate(c: JourneyClient): string | null {
  if (c.activationDate) return c.activationDate;
  // Only for records the CRM itself calls funded. Falling back for everyone
  // pulls in Account Live investors, who have a Date_Of_1st_Investment despite
  // holding nothing — that widened an August range from 9 to 15 and broke the
  // match with the CRM's own drill-down.
  return c.onboardingStage === "Funded less than 50L"
    ? c.accountLiveDate
    : null;
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

/** One filter tab: short label, count badge, underline when active. */
function FilterTab({
  label,
  count,
  active,
  onClick,
  title,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
  tone?: "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`-mb-px flex min-h-[40px] items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${
        active
          ? "border-primary font-bold text-foreground"
          : tone === "warn"
            ? "border-transparent text-destructive hover:border-destructive/40"
            : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
          active
            ? "bg-primary text-primary-foreground"
            : tone === "warn"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted-foreground/10 text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export default function DistributorInvestorsPage() {
  const [data, setData] = React.useState<JourneyResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "forbidden" | "error">(
    "loading",
  );
  // Arriving from the overview pre-selects a filter, so a partner who clicked
  // "33 Invested" lands on those 33 rather than the whole book.
  const searchParams = useSearchParams();
  const [q, setQ] = React.useState("");
  const [statusKey, setStatusKey] = React.useState<string>(
    () => searchParams.get("status") ?? "",
  );
  const [strategy, setStrategy] = React.useState<string>(
    () => searchParams.get("strategy") ?? "",
  );
  // Arriving from a step on the overview's onboarding journey. Every step used
  // to link to ?status=onboarding, so clicking "CML Pending" showed all
  // thirteen onboarding investors rather than the one actually at that step.
  const [onboardingStage, setOnboardingStage] = React.useState<string>(
    () => searchParams.get("stage") ?? "",
  );
  // Date filter. Two bases, because "when they came" and "when the account
  // opened" are different questions with different fields behind them.
  //
  // Stage_Entry_Date is deliberately NOT offered: on the live book all 21
  // populated values are the same day (2026-06-25), which is a CRM bulk-edit
  // artifact rather than a real arrival date. First_Top_Up_Date is empty for
  // every investor. Offering either would give a partner a filter that
  // quietly lies.
  // Arriving from a bar on the overview's inflow chart, which links with a
  // month range so a partner can see exactly who that month is made of.
  const [dateBasis, setDateBasis] = React.useState<"" | "opened" | "invested">(
    () => {
      const b = searchParams.get("basis");
      return b === "opened" || b === "invested" ? b : "";
    },
  );
  const [fromDate, setFromDate] = React.useState(
    () => searchParams.get("from") ?? "",
  );
  const [toDate, setToDate] = React.useState(() => searchParams.get("to") ?? "");
  const [shown, setShown] = React.useState(10);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

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

  const visible = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients
      .filter((c) => {
        if (statusKey && statusFor(c.stage, c.onboardingStage).key !== statusKey) return false;
        if (strategy && !c.strategies.includes(strategy)) return false;
        if (onboardingStage && c.onboardingStage !== onboardingStage) return false;
        if (dateBasis && (fromDate || toDate)) {
          const raw =
            dateBasis === "opened" ? c.accountLiveDate : fundedDate(c);
          // No date on record means we cannot say it falls in the range. The
          // count line below says how many were set aside, so a partner is
          // never silently shown a short list.
          if (!raw) return false;
          const day = String(raw).slice(0, 10);
          if (fromDate && day < fromDate) return false;
          if (toDate && day > toDate) return false;
        }
        if (!needle) return true;
        return [c.name, c.email, c.city, ...c.strategies]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));
  }, [clients, q, statusKey, strategy, onboardingStage, dateBasis, fromDate, toDate]);

  // Zoho holds more than one record for the same person in some cases —
  // four identical rows for one investor on the live book. That inflates the
  // headcount, so it is reported rather than quietly deduplicated: the count
  // is a number a partner may reconcile against other reports, and the
  // duplication is a CRM problem worth someone fixing at source.
  const duplicateRows = React.useMemo(() => {
    const seen = new Set<string>();
    let extra = 0;
    for (const c of clients) {
      const key = `${(c.email ?? "").toLowerCase()}|${(c.name ?? "").toLowerCase()}`;
      if (seen.has(key)) extra++;
      else seen.add(key);
    }
    return extra;
  }, [clients]);

  // How many the date filter excluded purely for lacking a date — reported
  // to the partner rather than silently dropped.
  const undatedCount = React.useMemo(() => {
    if (!dateBasis || (!fromDate && !toDate)) return 0;
    return clients.filter((c) => {
      if (statusKey && statusFor(c.stage, c.onboardingStage).key !== statusKey)
        return false;
      if (strategy && !c.strategies.includes(strategy)) return false;
      return !(dateBasis === "opened" ? c.accountLiveDate : fundedDate(c));
    }).length;
  }, [clients, statusKey, strategy, dateBasis, fromDate, toDate]);

  // A narrowed list must never open part-way down.
  React.useEffect(() => {
    setShown(10);
  }, [q, statusKey, strategy, onboardingStage, dateBasis, fromDate, toDate]);

  /**
   * Downloads the investor's SOA.
   *
   * The list does not know who has one — the journey endpoint reads Zoho by
   * COQL and SOA_Reports is a fileupload field, unavailable that way. Probing
   * per investor would cost one extra Zoho read each on every page load, so
   * the button is offered to all and absence is reported here.
   */
  async function downloadStatement(email: string | null, name: string | null) {
    if (!email) return;
    setBusy(email);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/distributor/investor-soa?email=${encodeURIComponent(email)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setMessage(
          `No SOA has been issued for ${name ?? "this investor"} yet.`,
        );
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SOA - ${(name ?? "investor").replace(/[^\w\s-]/g, "")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("We couldn't fetch the SOA. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  /** Opens the investor's own portal view in a new tab. */
  async function openAccount(clientCode: string, name: string | null) {
    setBusy(clientCode);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "impersonate", clientCode }),
      });
      const body = await res.json();
      if (!body?.success || !body?.redirectUrl) {
        setMessage(
          `We couldn't open ${name ?? "that"} account just now. Please try again.`,
        );
        return;
      }
      window.open(body.redirectUrl, "_blank", "noopener");
    } catch {
      setMessage("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Your investors</h1>
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
        <h1 className="text-2xl">Your investors</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load your investors. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const live = data.crmLinked && data.zohoAvailable;
  const activeStatuses = STATUS_ORDER.filter((s) => (statusCounts.get(s.key) ?? 0) > 0);

  return (
    <div className="flex w-full flex-col gap-4 pb-10">
      <div>
        <Link
          href="/distributors"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Overview
        </Link>
        <h1 className="mt-2 text-2xl">Your investors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone who joined Qode through your links.
        </p>
      </div>

      {message ? (
        <div className="rounded-md border border-border/20 bg-card px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}

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
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No investors have joined through your links yet.{" "}
            <Link
              href="/distributors/referrals"
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
            >
              Share a link
            </Link>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
          {/* Filter tabs. Underlined rather than pills: with seven statuses
              the pills wrapped to two rows and the row read as a pile of
              buttons rather than one control.

              Tabs carry the short label with the full CRM value as the
              tooltip, so the bar stays scannable and the exact Zoho name is
              one hover away. Stalled statuses sit to the right, away from the
              progression they are not part of. */}
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-center gap-1 border-b border-border/20">
              <FilterTab
                label="All"
                count={clients.length}
                active={statusKey === ""}
                onClick={() => setStatusKey("")}
              />
              {activeStatuses
                .filter((s: StatusInfo) => s.tone !== "warn")
                .map((s: StatusInfo) => (
                  <FilterTab
                    key={s.key}
                    label={s.short}
                    title={`${s.label} — ${s.detail}`}
                    count={statusCounts.get(s.key) ?? 0}
                    active={statusKey === s.key}
                    onClick={() =>
                      setStatusKey(statusKey === s.key ? "" : s.key)
                    }
                  />
                ))}
              <span className="ml-auto flex items-center gap-1 pl-6">
                {activeStatuses
                  .filter((s: StatusInfo) => s.tone === "warn")
                  .map((s: StatusInfo) => (
                    <FilterTab
                      key={s.key}
                      label={s.short}
                      title={`${s.label} — ${s.detail}`}
                      count={statusCounts.get(s.key) ?? 0}
                      active={statusKey === s.key}
                      tone="warn"
                      onClick={() =>
                        setStatusKey(statusKey === s.key ? "" : s.key)
                      }
                    />
                  ))}
              </span>
            </div>
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

          {/* Date filter. Hidden behind a basis choice: with no basis picked
              there is nothing to range over, and two empty date boxes on
              first load would just be clutter. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="date-basis">
              Filter by date
            </label>
            <select
              id="date-basis"
              value={dateBasis}
              onChange={(e) => {
                const v = e.target.value as "" | "opened" | "invested";
                setDateBasis(v);
                if (!v) {
                  setFromDate("");
                  setToDate("");
                }
              }}
              className="min-h-[44px] rounded-md border border-border/20 bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">Any date</option>
              <option value="opened">Account opened between</option>
              <option value="invested">First Fund Initiated between</option>
            </select>

            {dateBasis ? (
              <>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  aria-label="From date"
                  className="min-h-[44px] rounded-md border border-border/20 bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  aria-label="To date"
                  className="min-h-[44px] rounded-md border border-border/20 bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDateBasis("");
                    setFromDate("");
                    setToDate("");
                  }}
                  className="min-h-[44px] rounded-md px-3 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Clear dates
                </button>
              </>
            ) : null}
          </div>

          {/* Say plainly how many were set aside for having no date on
              record, so a shortened list is never mistaken for the whole
              picture. */}
          {undatedCount > 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {undatedCount}{" "}
              {undatedCount === 1 ? "investor has" : "investors have"} no{" "}
              {dateBasis === "opened" ? "Account Live" : "First Fund Initiated"}{" "}
              date on record and {undatedCount === 1 ? "is" : "are"} not shown.
            </p>
          ) : null}

          {visible.length === 0 ? (
            <div className="mt-4 rounded-md border border-border/20 bg-background px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No investors match this view. Try a different search, or choose
                &ldquo;All&rdquo; above.
              </p>
            </div>
          ) : (
            <>
              {/* An active sub-stage filter is otherwise invisible: the list
                  would just look short with nothing explaining why. */}
              {onboardingStage ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex min-h-[32px] items-center gap-2 rounded-full border border-primary bg-primary/10 px-3 text-[12px] font-semibold text-foreground">
                    {onboardingStage}
                    <button
                      type="button"
                      onClick={() => setOnboardingStage("")}
                      aria-label={`Clear the ${onboardingStage} filter`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                {visible.length === clients.length
                  ? `${clients.length} investors, largest holdings first`
                  : `Showing ${visible.length} of ${clients.length}`}
                {duplicateRows > 0
                  ? ` · includes ${duplicateRows} duplicate ${
                      duplicateRows === 1 ? "record" : "records"
                    } from the CRM`
                  : ""}
              </p>

              <ul className="mt-2 flex flex-col gap-1.5">
                {visible.slice(0, shown).map((c, i) => {
                  const s = statusFor(c.stage, c.onboardingStage);
                  const delta =
                    c.currentValue != null && c.investedAmount != null
                      ? c.currentValue - c.investedAmount
                      : null;
                  const up = delta != null && delta >= 0;
                  // Email is NOT unique: Zoho holds four identical records
                  // for one investor (ranojoyster@gmail.com, verified
                  // 2026-09-01), and clientCode is null for 30 of 59 so it
                  // cannot disambiguate either. Index makes the key stable
                  // for React; the duplicates themselves are a CRM data
                  // problem, flagged to the partner below rather than hidden.
                  const key = `${c.email ?? "row"}-${i}`;

                  return (
                    <li
                      key={key}
                      className="rounded-md border border-border/20 bg-background px-4 py-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Position in the list as filtered and sorted, so
                                a partner can say "number 7" on a call. It
                                renumbers when the filter changes, which is why
                                it is not treated as an identifier. */}
                            <span className="shrink-0 text-[12px] font-bold tabular-nums text-muted-foreground">
                              {i + 1}.
                            </span>
                            {c.email ? (
                              <Link
                                href={`/distributors/investors/${encodeURIComponent(c.email)}`}
                                className="text-sm font-bold text-foreground underline-offset-4 hover:underline"
                              >
                                {c.name ?? "—"}
                              </Link>
                            ) : (
                              <span className="text-sm font-bold text-foreground">
                                {c.name ?? "—"}
                              </span>
                            )}
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wider ${
                                s.tone === "warn"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-muted-foreground/10 text-muted-foreground"
                              }`}
                            >
                              {s.label}
                            </span>
                          </div>
                          {/* Only while onboarding: once invested, how they
                              got there is no longer the useful fact. */}
                          {s.key === "onboarding" && c.onboardingStage ? (
                            <p className="mt-1 text-[12px] text-foreground">
                              {c.onboardingStage}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {[
                              c.city,
                              c.strategies.join(", ") || null,
                              c.accountLiveDate
                                ? `${
                                    c.currentValue != null ? "Funded" : "Account opened"
                                  } ${formatDate(c.accountLiveDate)}`
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
                              className="text-[12px] tabular-nums"
                              style={{ color: up ? QAW : "var(--destructive)" }}
                            >
                              {up ? "▲" : "▼"} {money(Math.abs(delta))}
                            </p>
                          ) : (
                            <p className="text-[12px] text-muted-foreground">
                              No holdings yet
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {c.email ? (
                          <>
                          <Link
                            href={`/distributors/investors/${encodeURIComponent(c.email)}`}
                            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-border/20 px-2.5 text-[12px] font-bold text-primary hover:border-primary/50 dark:text-primary-foreground"
                          >
                            View details
                          </Link>
                          <button
                            type="button"
                            onClick={() => downloadStatement(c.email, c.name)}
                            disabled={busy === c.email}
                            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-border/20 px-2.5 text-[12px] font-bold text-primary hover:border-primary/50 disabled:opacity-50 dark:text-primary-foreground"
                          >
                            <Download className="size-3" />
                            {busy === c.email ? "Fetching…" : "SOA"}
                          </button>
                          </>
                        ) : null}
                        {c.clientCode ? (
                          <button
                            type="button"
                            onClick={() => openAccount(c.clientCode!, c.name)}
                            disabled={busy === c.clientCode}
                            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-border/20 px-2.5 text-[12px] font-bold text-primary hover:border-primary/50 disabled:opacity-50 dark:text-primary-foreground"
                          >
                            <ExternalLink className="size-3" />
                            {busy === c.clientCode ? "Opening…" : "View account"}
                          </button>
                        ) : null}
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
        </section>
      )}
    </div>
  );
}
