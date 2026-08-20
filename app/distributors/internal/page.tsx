"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors STAGE_ORDER in lib/zohoDistributorJourney.ts. Kept as a literal so
 *  the client bundle does not pull in the server-only Zoho module. */
const STAGE_ORDER = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
  "Dropped before account opening",
  "Dropped after account opening",
] as const;

const DROP_STAGES = new Set<string>([
  "Dropped before account opening",
  "Dropped after account opening",
]);

type DistributorRow = {
  zohoId: string;
  zohoName: string | null;
  portalName: string | null;
  email: string | null;
  clientCount: number;
  stageCounts: Record<string, number>;
  hasPortalLogin: boolean;
};

type OverviewResponse = {
  distributors: DistributorRow[];
  totals: Record<string, number>;
  zohoOnlyCount: number;
};

export default function InternalDistributorOverviewPage() {
  const [data, setData] = React.useState<OverviewResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "unauthorized" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/distributor/internal-overview", {
          cache: "no-store",
        });
        if (cancelled) return;

        if (res.status === 401 || res.status === 403) {
          setStatus("unauthorized");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }

        setData((await res.json()) as OverviewResponse);
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
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "unauthorized") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Distributor Overview</h1>
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            This page is for the Qode team.{" "}
            <a
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
              href="/admin/login?redirect=/distributors/internal"
            >
              Sign in to the admin panel
            </a>{" "}
            to continue.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Distributor Overview</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load the distributor overview. This usually means the CRM
            was unreachable — please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const totalClients = data.distributors.reduce((sum, d) => sum + d.clientCount, 0);

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Distributor Overview — Internal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All distribution partners and the current stage of every referred investor.
        </p>
      </header>

      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <h2 className="text-lg font-semibold text-foreground">Across all partners</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <div className="rounded-md border border-border/20 bg-background px-4 py-3">
            <p className="text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
              Total investors
            </p>
            <p className="mt-1 font-serif text-2xl tabular-nums text-foreground">
              {totalClients}
            </p>
          </div>
          {STAGE_ORDER.map((stage) => {
            const count = data.totals[stage] ?? 0;
            return (
              <div
                key={stage}
                className="rounded-md border border-border/20 bg-background px-4 py-3"
              >
                <p className="text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
                  {stage}
                </p>
                <p
                  className={`mt-1 font-serif text-2xl tabular-nums ${
                    DROP_STAGES.has(stage) && count > 0
                      ? "text-destructive"
                      : "text-foreground"
                  }`}
                >
                  {count}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {data.zohoOnlyCount > 0 ? (
        <div className="rounded-xl border border-border/20 bg-background px-5 py-4">
          <p className="text-sm text-foreground">
            <span className="font-bold">{data.zohoOnlyCount}</span>{" "}
            {data.zohoOnlyCount === 1 ? "distributor" : "distributors"} in the CRM{" "}
            {data.zohoOnlyCount === 1 ? "has" : "have"} no portal login and cannot sign
            in to myQode. They are listed below without a partner name.
          </p>
        </div>
      ) : null}

      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <h2 className="text-lg font-semibold text-foreground">By partner</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/20 text-left">
                <th className="py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Distributor
                </th>
                <th className="py-2 pr-4 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Clients
                </th>
                {STAGE_ORDER.map((stage) => (
                  <th
                    key={stage}
                    className="py-2 pr-4 text-right text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground last:pr-0"
                  >
                    {stage}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.distributors.map((d) => (
                <tr key={d.zohoId} className="border-b border-border/10 last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="text-foreground">
                      {d.portalName ?? d.zohoName ?? "—"}
                    </span>
                    {!d.hasPortalLogin ? (
                      <span className="ml-2 inline-block rounded-full border border-border/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        No portal login
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                    {d.clientCount}
                  </td>
                  {STAGE_ORDER.map((stage) => {
                    const count = d.stageCounts[stage] ?? 0;
                    return (
                      <td
                        key={stage}
                        className={`py-2.5 pr-4 text-right tabular-nums last:pr-0 ${
                          DROP_STAGES.has(stage) && count > 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {count}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
