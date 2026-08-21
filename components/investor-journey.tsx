"use client";

import * as React from "react";
import { Check } from "lucide-react";

/**
 * The signed-in investor's onboarding progress.
 *
 * Renders NOTHING when there is no journey to show — no CRM record, a CRM
 * outage, or a stage deliberately withheld from investors (dropped/dormant).
 * That silence is intentional: this is a supplementary section, and an empty
 * or apologetic box on someone's portfolio page is worse than its absence.
 */

/** Mirrors INVESTOR_VISIBLE_STAGES in lib/zohoInvestorJourney.ts. Kept as a
 *  literal so the client bundle does not pull in the server-only Zoho module. */
const STAGES = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
] as const;

/** Investor-facing wording. The CRM's own labels are internal shorthand
 *  ("First Fund Initiated" means the first investment is on its way), so each
 *  step gets a plain-English caption beneath it. */
const STAGE_CAPTION: Record<string, string> = {
  Onboarding: "Setting up your account",
  "First Fund Initiated": "Your first investment is on its way",
  "Account Live": "Your portfolio is live",
  "Regular Investor": "Invested and active",
};

type InvestorJourney = {
  stage: string;
  stageIndex: number;
  activationDate: string | null;
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
};

/** Renders an ISO date as "07 Jul 2026". Null-safe: returns null. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function InvestorJourneyCard() {
  const [journey, setJourney] = React.useState<InvestorJourney | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/investor/journey", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { journey: InvestorJourney | null };
        if (!cancelled) setJourney(data.journey);
      } catch {
        // Silent by design — see the file comment.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!journey) return null;

  const activation = formatDate(journey.activationDate);
  const accountLive = formatDate(journey.accountLiveDate);
  const firstTopUp = formatDate(journey.firstTopUpDate);

  return (
    <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
      <h2 className="text-lg font-semibold text-foreground">Your account journey</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {STAGE_CAPTION[journey.stage] ?? "Your account is progressing."}
      </p>

      <ol className="mt-5 flex flex-col gap-3 sm:flex-row sm:gap-2">
        {STAGES.map((stage, i) => {
          const done = i < journey.stageIndex;
          const current = i === journey.stageIndex;

          return (
            <li key={stage} className="flex flex-1 items-start gap-3 sm:flex-col sm:gap-2">
              {/* Connector + marker. On desktop the bar sits above the label so
                  the four steps read as a horizontal track. */}
              <div className="flex items-center gap-2 sm:w-full">
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : current
                        ? "border-primary bg-background text-primary dark:text-primary-foreground"
                        : "border-border/30 bg-background text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span
                  aria-hidden="true"
                  className={`hidden h-px flex-1 sm:block ${
                    done ? "bg-primary" : "bg-border/30"
                  }`}
                />
              </div>

              <div className="min-w-0">
                <p
                  className={`text-sm ${
                    current
                      ? "font-bold text-foreground"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {stage}
                  {current ? (
                    <span className="sr-only"> — your current stage</span>
                  ) : done ? (
                    <span className="sr-only"> — completed</span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {activation || accountLive || firstTopUp ? (
        <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-border/20 pt-4 sm:grid-cols-3">
          {activation ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Activated
              </dt>
              <dd className="mt-0.5 text-sm tabular-nums text-foreground">{activation}</dd>
            </div>
          ) : null}
          {accountLive ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Account live
              </dt>
              <dd className="mt-0.5 text-sm tabular-nums text-foreground">{accountLive}</dd>
            </div>
          ) : null}
          {firstTopUp ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                First top-up
              </dt>
              <dd className="mt-0.5 text-sm tabular-nums text-foreground">{firstTopUp}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
