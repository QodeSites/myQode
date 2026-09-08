"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STRATEGY_COLOR,
  NEUTRAL_COLOR,
  ONBOARDING_SEQUENCE,
  onboardingRank,
  shortStrategy,
  statusFor,
} from "@/lib/distributorVocabulary";

/**
 * One investor, in full, for the partner who referred them.
 *
 * Reads the partner's own journey payload and picks the matching investor,
 * rather than adding an endpoint: that payload is already scoped server-side
 * to this distributor's book, so a partner cannot reach an investor who is not
 * theirs simply by editing the URL.
 *
 * WHAT IS DELIBERATELY NOT SHOWN
 * `lastConversation` is a free-text internal note — real values include
 * "Called him, said will call back in 30 mins, didn't call back". That is the
 * Qode team's record of a client, written for an internal audience, and a
 * distributor is an external party. Same reasoning as
 * lib/zohoInvestorDetails.ts, which keeps its slice deliberately narrow.
 */

const QAW = "#008455";

/**
 * The four broad stages an account passes through, in the order they
 * actually happen.
 *
 * NOTE the order differs from INVESTOR_VISIBLE_STAGES in
 * lib/zohoInvestorJourney.ts, which lists First Fund Initiated before
 * Account Live. That order is wrong on this track: "Account Live" is an
 * opened account holding nothing, and "First Fund Initiated" is where money
 * actually arrives — the same reversal already documented in statusFor().
 *
 * The live book proves it. One investor sits at First Fund Initiated with
 * Activation_Date 2026-08-03 and Date_Of_1st_Investment 2026-07-06: the
 * account opened a month BEFORE the money came. Kept in CRM order, the card
 * would draw "Account opened" as a step not yet reached while showing a date
 * older than the current step.
 *
 * Kept as a literal so this client page does not pull in the server-only
 * Zoho module.
 */
const ACCOUNT_STAGES = [
  "Onboarding",
  "Account Live",
  "First Fund Initiated",
  "Regular Investor",
] as const;

/**
 * What each Zoho stage means, shown under its name. The names themselves are
 * used verbatim — see lib/distributorVocabulary — but two of them read
 * backwards to anyone outside the firm, so the meaning travels with them.
 */
const ACCOUNT_STAGE_MEANING: Record<string, string> = {
  Onboarding: "Opening the account",
  "Account Live": "Open, nothing invested",
  "First Fund Initiated": "Money invested",
  "Regular Investor": "Invested and active",
};

/** Which date on the record evidences each stage, where one exists. */
const ACCOUNT_STAGE_DATE: Record<string, string | null> = {
  Onboarding: null,
  "Account Live": "accountLiveDate",
  "First Fund Initiated": "activationDate",
  "Regular Investor": "firstTopUpDate",
};

type JourneyClient = {
  name: string | null;
  email: string | null;
  clientCode?: string | null;
  stage: string | null;
  onboardingStage?: string | null;
  stageEntryDate: string | null;
  activationDate: string | null;
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
  investedAmount: number | null;
  currentValue: number | null;
  strategies: string[];
  relationshipManager: string | null;
  mobile: string | null;
  city: string | null;
  occupation: string | null;
  nextContactDate: string | null;
  annualReviewStatus: string | null;
  hadWalkthrough: boolean;
};

type JourneyResponse = {
  distributor: { name: string; email: string };
  journey: { clients: JourneyClient[] } | null;
  zohoAvailable: boolean;
  crmLinked: boolean;
};

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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
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
        <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function InvestorDetailPage() {
  const params = useParams<{ email: string }>();
  const email = params?.email ? decodeURIComponent(params.email) : "";

  const [data, setData] = React.useState<JourneyResponse | null>(null);
  const [status, setStatus] = React.useState<
    "loading" | "ready" | "forbidden" | "notfound" | "error"
  >("loading");
  const [busy, setBusy] = React.useState(false);
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
        const body = (await res.json()) as JourneyResponse;
        setData(body);
        const found = (body.journey?.clients ?? []).some(
          (c) => String(c.email ?? "").toLowerCase() === email.toLowerCase(),
        );
        setStatus(found ? "ready" : "notfound");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  const investor = React.useMemo(
    () =>
      (data?.journey?.clients ?? []).find(
        (c) => String(c.email ?? "").toLowerCase() === email.toLowerCase(),
      ) ?? null,
    [data, email],
  );

  async function downloadSoa() {
    if (!investor?.email) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/distributor/investor-soa?email=${encodeURIComponent(investor.email)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setMessage("No SOA has been issued for this investor yet.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SOA - ${(investor.name ?? "investor").replace(/[^\w\s-]/g, "")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("We couldn't fetch the SOA. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openAccount() {
    if (!investor?.clientCode) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "impersonate", clientCode: investor.clientCode }),
      });
      const body = await res.json();
      if (!body?.success || !body?.redirectUrl) {
        setMessage("We couldn't open this account just now. Please try again.");
        return;
      }
      window.open(body.redirectUrl, "_blank", "noopener");
    } catch {
      setMessage("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Position on the four-stage arc. Stages outside the list (dropped,
  // dormant) have no place on a progress track — there is no partial journey
  // to draw for an account that stopped — so the card is omitted entirely
  // and the status chip above already says what happened.
  const accountJourney = React.useMemo(() => {
    if (!investor) return null;
    const i = ACCOUNT_STAGES.indexOf(
      investor.stage as (typeof ACCOUNT_STAGES)[number],
    );
    return i === -1 ? null : { index: i };
  }, [investor]);

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-4 pb-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-4 pb-10">
        <h1 className="text-2xl">Investor</h1>
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

  // "Not one of yours" and "does not exist" give the same answer, so a partner
  // cannot discover which investors exist by trying addresses.
  if (status === "notfound" || (status === "ready" && !investor)) {
    return (
      <div className="flex w-full flex-col gap-4 pb-10">
        <Link
          href="/distributors/investors"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Your investors
        </Link>
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t find that investor in your book.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || !investor) {
    return (
      <div className="flex w-full flex-col gap-4 pb-10">
        <h1 className="text-2xl">Investor</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load this investor. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const s = statusFor(investor.stage, investor.onboardingStage);

  const delta =
    investor.currentValue != null && investor.investedAmount != null
      ? investor.currentValue - investor.investedAmount
      : null;
  const deltaPct =
    delta != null && investor.investedAmount
      ? (delta / investor.investedAmount) * 100
      : null;
  const up = delta != null && delta >= 0;

  return (
    <div className="flex w-full flex-col gap-4 pb-10">
      <div>
        <Link
          href="/distributors/investors"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Your investors
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl">{investor.name ?? "Investor"}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              s.tone === "warn"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted-foreground/10 text-muted-foreground"
            }`}
          >
            {s.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.key === "onboarding" && investor.onboardingStage
            ? investor.onboardingStage
            : s.detail}
        </p>
      </div>

      {message ? (
        <div className="rounded-md border border-border/20 bg-card px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}

      {/* Actions first — they are why a partner opened this page. */}
      <div className="flex flex-wrap gap-2">
        {investor.email ? (
          <button
            type="button"
            onClick={downloadSoa}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border/20 bg-card px-4 text-sm font-bold text-primary hover:border-primary/50 disabled:opacity-50 dark:text-primary-foreground"
          >
            <Download className="size-4" />
            {busy ? "Working…" : "Download SOA"}
          </button>
        ) : null}
        {investor.clientCode ? (
          <button
            type="button"
            onClick={openAccount}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border/20 bg-card px-4 text-sm font-bold text-primary hover:border-primary/50 disabled:opacity-50 dark:text-primary-foreground"
          >
            <ExternalLink className="size-4" />
            {busy ? "Working…" : "View their portfolio"}
          </button>
        ) : null}
      </div>

      {/* Money */}
      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
          Current value
        </p>
        <p className="mt-1.5 font-sans text-[32px] font-bold leading-none tabular-nums text-foreground">
          {money(investor.currentValue)}
        </p>
        {delta != null && deltaPct != null ? (
          <p className="mt-2 text-sm">
            <span
              className="font-bold tabular-nums"
              style={{ color: up ? QAW : "var(--destructive)" }}
            >
              {up ? "▲" : "▼"} {money(Math.abs(delta))} ({up ? "+" : "−"}
              {Math.abs(deltaPct).toFixed(1)}%)
            </span>{" "}
            <span className="text-muted-foreground">
              against {money(investor.investedAmount)} invested
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Holdings are not yet priced in our records.
          </p>
        )}

        {investor.strategies.length ? (
          <div className="mt-4 border-t border-border/20 pt-3">
            <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
              Strategies
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {investor.strategies.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/20 px-2.5 py-1 text-[11.5px] text-foreground"
                >
                  <span
                    className="size-2 rounded-sm"
                    style={{ background: STRATEGY_COLOR[name] ?? NEUTRAL_COLOR }}
                  />
                  {shortStrategy(name)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* The account journey — the four broad stages an investor passes
          through. This card used to sit on the investor's own performance
          page; it belongs here, where a partner tracks their clients.

          It sits above the onboarding card deliberately: this is the whole
          arc, and the onboarding card below zooms into the current stage. */}
      {accountJourney ? (
        <Card
          title="Account journey"
          description="The stages an account passes through."
        >
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <ol className="flex min-w-max items-start">
              {ACCOUNT_STAGES.map((stage, i) => {
                const done = i < accountJourney.index;
                const here = i === accountJourney.index;
                const isLast = i === ACCOUNT_STAGES.length - 1;
                return (
                  <li
                    key={stage}
                    className="flex w-[150px] shrink-0 flex-col items-center"
                  >
                    <div className="flex w-full items-center">
                      <span
                        aria-hidden="true"
                        className={`h-px flex-1 ${
                          done || here ? "bg-primary/40" : "bg-border/30"
                        }`}
                        style={{ visibility: i === 0 ? "hidden" : undefined }}
                      />
                      <span
                        aria-hidden="true"
                        className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                          here
                            ? "border-primary bg-primary text-primary-foreground"
                            : done
                              ? "border-primary bg-primary/15 text-primary dark:text-primary-foreground"
                              : "border-border/30 bg-background text-muted-foreground"
                        }`}
                      >
                        {done ? "✓" : here ? "●" : i + 1}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`h-px flex-1 ${done ? "bg-primary/40" : "bg-border/30"}`}
                        style={{ visibility: isLast ? "hidden" : undefined }}
                      />
                    </div>

                    {/* Fixed height so a wrapped stage name cannot push its
                        meaning line out of step with its neighbours. */}
                    <div className="mt-2 flex h-[46px] flex-col px-1 text-center">
                      <p
                        className={`text-[12px] leading-snug ${
                          here
                            ? "font-bold text-foreground"
                            : done
                              ? "text-foreground"
                              : "text-muted-foreground/70"
                        }`}
                      >
                        {stage}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/80">
                        {ACCOUNT_STAGE_MEANING[stage]}
                      </p>
                      {ACCOUNT_STAGE_DATE[stage] ? (
                        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {formatDate(
                            investor[ACCOUNT_STAGE_DATE[stage] as keyof typeof investor] as
                              | string
                              | null,
                          ) || (here ? "In progress" : "")}
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

      {/* Where this investor has reached.
          Shown only while onboarding: once invested, the path they took to
          get there is history, and the money is what matters. */}
      {s.key === "onboarding" && investor.onboardingStage ? (
        <Card
          title="Onboarding progress"
          description="Steps completed, and what happens next."
        >
          {(() => {
            const current = onboardingRank(investor.onboardingStage);
            // A stage we don't know sorts past the end of the sequence, which
            // would draw every step complete and no current marker — telling a
            // partner their client finished onboarding when we simply don't
            // recognise the CRM value. Show the stage plainly instead.
            if (current >= ONBOARDING_SEQUENCE.length) {
              return (
                <p className="text-sm text-foreground">
                  {investor.onboardingStage}
                </p>
              );
            }
            // Everything up to and including the step after theirs — the next
            // step is the useful one to see; the rest of the path is not yet
            // their concern.
            const shown = ONBOARDING_SEQUENCE.slice(
              0,
              Math.min(current + 2, ONBOARDING_SEQUENCE.length),
            );
            return (
              /* Horizontal: the path reads left to right. Scrolls inside
                 its own container so the page never scrolls sideways. The
                 track behind a completed step is solid, so the distance
                 travelled is visible at a glance. */
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <ol className="flex min-w-max items-start">
                  {shown.map((step, i) => {
                    const done = i < current;
                    const here = i === current;
                    const isLast = i === shown.length - 1;
                    return (
                      <li
                        key={step}
                        className="flex w-[132px] shrink-0 flex-col items-center"
                      >
                        <div className="flex w-full items-center">
                          <span
                            aria-hidden="true"
                            className={`h-px flex-1 ${
                              done || here ? "bg-primary/40" : "bg-border/30"
                            }`}
                            style={{ visibility: i === 0 ? "hidden" : undefined }}
                          />
                          <span
                            aria-hidden="true"
                            className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                              here
                                ? "border-primary bg-primary text-primary-foreground"
                                : done
                                  ? "border-primary bg-primary/15 text-primary dark:text-primary-foreground"
                                  : "border-border/30 bg-background text-muted-foreground"
                            }`}
                          >
                            {done ? "✓" : here ? "●" : ""}
                          </span>
                          <span
                            aria-hidden="true"
                            className={`h-px flex-1 ${done ? "bg-primary/40" : "bg-border/30"}`}
                            style={{ visibility: isLast ? "hidden" : undefined }}
                          />
                        </div>

                        {/* Fixed height: the longest step name wraps to three
                            lines, which would otherwise drop its caption below
                            the captions either side of it. */}
                        <div className="mt-2 flex h-[58px] flex-col px-1 text-center">
                          <p
                            className={`text-[12px] leading-snug ${
                              here
                                ? "font-bold text-foreground"
                                : done
                                  ? "text-foreground"
                                  : "text-muted-foreground/70"
                            }`}
                          >
                            {step}
                          </p>
                          {here ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Currently here
                              {investor.stageEntryDate
                                ? ` since ${formatDate(investor.stageEntryDate)}`
                                : ""}
                            </p>
                          ) : null}
                          {!done && !here ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Next step
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })()}
        </Card>
      ) : null}

      {/* Their account */}
      <Card title="Account">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Account code" value={investor.clientCode ?? null} />
          <Field label="Activation date" value={formatDate(investor.activationDate)} />
          <Field
            label="First investment"
            value={formatDate(investor.accountLiveDate)}
          />
          <Field label="Last top-up" value={formatDate(investor.firstTopUpDate)} />
          {investor.onboardingStage ? (
            <Field label="Onboarding stage" value={investor.onboardingStage} />
          ) : null}
          <Field
            label="Annual review"
            value={investor.annualReviewStatus ?? null}
          />
          <Field
            label="Portal walkthrough"
            value={investor.hadWalkthrough ? "Done" : "Not done"}
          />
        </dl>
      </Card>

      {/* Who they are */}
      <Card title="Contact">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Email" value={investor.email} />
          <Field label="Mobile" value={investor.mobile} />
          <Field label="City" value={investor.city} />
          <Field label="Occupation" value={investor.occupation} />
          <Field
            label="Relationship manager"
            value={investor.relationshipManager}
          />
          <Field
            label="Next contact"
            value={formatDate(investor.nextContactDate)}
          />
        </dl>
      </Card>
    </div>
  );
}
