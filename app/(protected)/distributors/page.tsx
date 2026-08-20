"use client";

import * as React from "react";
import { Check, Copy, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/** Funnel order first, drop states last — mirrors STAGE_ORDER in
 *  lib/zohoDistributorJourney.ts. Kept as a literal here so the client bundle
 *  does not pull in the server-only Zoho module. */
const STAGE_ORDER = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
  "Dropped before account opening",
  "Dropped after account opening",
] as const;

/** The two stages that mean the investor did not proceed. */
const DROP_STAGES = new Set<string>([
  "Dropped before account opening",
  "Dropped after account opening",
]);

type JourneyClient = {
  name: string | null;
  email: string | null;
  stage: string | null;
  stageEntryDate: string | null;
  activationDate: string | null;
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
};

type JourneyResponse = {
  distributor: { name: string; email: string };
  referralLinks: { individual: string; nonIndividual: string };
  journey: { clients: JourneyClient[]; stageCounts: Record<string, number> } | null;
  zohoAvailable: boolean;
  portalClientCount: number;
};

/** Renders an ISO date as "07 Jul 2026". Null-safe: returns an em dash. */
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

function CopyLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The
      // full URL is on screen and selectable, so the copy button failing is
      // an inconvenience rather than a dead end.
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

function StageTile({ stage, count }: { stage: string; count: number }) {
  const isDrop = DROP_STAGES.has(stage);
  return (
    <div className="rounded-md border border-border/20 bg-background px-4 py-3">
      <p className="text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
        {stage}
      </p>
      <p
        className={`mt-1 font-serif text-2xl tabular-nums ${
          isDrop && count > 0 ? "text-destructive" : "text-foreground"
        }`}
      >
        {count}
      </p>
    </div>
  );
}

function SectionShell({
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

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Distributor Portal</h1>
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
        <h1 className="text-2xl">Distributor Portal</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load your distributor details. Please refresh the page, or
            contact{" "}
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

  const clients = data.journey?.clients ?? [];
  const stageCounts = data.journey?.stageCounts ?? {};

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Distributor Portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.distributor.name}</p>
      </header>

      <SectionShell
        title="Please use these links to refer to your investors"
        description="Anyone who onboards through your link is recorded against your name. Use the Individual link for a person, and the Non-Individual link for a company, LLP, HUF or trust."
      >
        <div className="flex flex-col gap-3">
          <CopyLinkRow label="Individual" url={data.referralLinks.individual} />
          <CopyLinkRow label="Non-Individual" url={data.referralLinks.nonIndividual} />
        </div>
      </SectionShell>

      <SectionShell
        title="Your clients' journey"
        description={
          data.zohoAvailable
            ? "Where each investor you referred currently stands."
            : undefined
        }
      >
        {!data.zohoAvailable ? (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load client journey data from our CRM just now. Your
              referral links above are unaffected — please try again shortly.
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {STAGE_ORDER.map((stage) => (
                <StageTile key={stage} stage={stage} count={stageCounts[stage] ?? 0} />
              ))}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/20 text-left">
                    <th className="py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Investor
                    </th>
                    <th className="py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Stage
                    </th>
                    <th className="py-2 pr-4 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Stage entry
                    </th>
                    <th className="py-2 pr-4 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Activation
                    </th>
                    <th className="py-2 pr-4 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Account live
                    </th>
                    <th className="py-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      First top-up
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => (
                    <tr
                      key={`${c.email ?? "no-email"}-${i}`}
                      className="border-b border-border/10 last:border-0"
                    >
                      <td className="py-2.5 pr-4 text-foreground">{c.name ?? "—"}</td>
                      <td
                        className={`py-2.5 pr-4 ${
                          c.stage && DROP_STAGES.has(c.stage)
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {c.stage ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                        {formatDate(c.stageEntryDate)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                        {formatDate(c.activationDate)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                        {formatDate(c.accountLiveDate)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatDate(c.firstTopUpDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionShell>

      <SectionShell title="Payout status">
        <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Payout status will appear here once it is published from our operations
            system.
          </p>
        </div>
      </SectionShell>

      <SectionShell title="Need help?">
        <p className="text-sm text-muted-foreground">
          For questions about your clients, referral links or payouts, email us and the
          partnerships team will get back to you.
        </p>
        <a
          href="mailto:partnerships@qodeinvest.com"
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border/20 bg-card px-4 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground dark:text-primary-foreground"
        >
          <Mail className="size-4" />
          partnerships@qodeinvest.com
        </a>
      </SectionShell>
    </div>
  );
}
