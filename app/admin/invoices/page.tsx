"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Invoice review for the finance team.
 *
 * Read-only by design: invoices are raised from the distributor portal, and
 * this surface exists so finance can check them without needing an investor
 * login.
 */

type InvoiceRow = {
  id: number;
  distributorEmail: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  createdAt: string | null;
};

type InvoicesResponse = {
  invoices: InvoiceRow[];
  totals: { count: number; beforeTax: number; tax: number; total: number };
  distributors: string[];
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

/** Indian grouping, two decimals, always — per the design system. */
function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/20 bg-card px-4 py-3.5">
      <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-sans text-[22px] font-bold leading-none tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

export default function AdminInvoicesPage() {
  const [data, setData] = React.useState<InvoicesResponse | null>(null);
  const [status, setStatus] = React.useState<
    "loading" | "ready" | "unauthorized" | "forbidden" | "error"
  >("loading");
  const [distributor, setDistributor] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const params = new URLSearchParams();
        if (distributor) params.set("distributor", distributor);
        if (from) params.set("from", from);
        if (to) params.set("to", to);

        const res = await fetch(`/api/admin/invoices?${params}`, { cache: "no-store" });
        if (cancelled) return;

        if (res.status === 401) {
          setStatus("unauthorized");
          return;
        }
        if (res.status === 403) {
          setStatus("forbidden");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }

        setData((await res.json()) as InvoicesResponse);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [distributor, from, to]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-52" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
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
            href="/admin/login?redirect=/admin/invoices"
          >
            Sign in again
          </a>{" "}
          to continue.
        </p>
      </div>
    );
  }

  if (status === "forbidden") {
    // Deliberately vague: someone without the role should not learn what
    // lives here.
    return (
      <div className="rounded-xl border border-border/20 bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          This page is for the finance team. If you need access, contact your
          administrator.
        </p>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <p className="text-sm text-foreground">
          We couldn&apos;t load the invoice list. Please refresh to try again.
        </p>
      </div>
    );
  }

  const hasFilters = Boolean(distributor || from || to);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl">Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issued distributor invoices. Review only — invoices are raised from the
          distributor portal.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Invoices" value={String(data.totals.count)} />
        <Tile label="Before tax" value={money(data.totals.beforeTax)} />
        <Tile label="Tax" value={money(data.totals.tax)} />
        <Tile label="Total" value={money(data.totals.total)} />
      </div>

      <section className="rounded-xl border border-border/20 bg-card">
        <div className="flex flex-col gap-3 border-b border-border/20 px-4 py-3 lg:flex-row lg:items-end">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="inv-distributor"
              className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground"
            >
              Distributor
            </label>
            <select
              id="inv-distributor"
              value={distributor}
              onChange={(e) => setDistributor(e.target.value)}
              className="min-h-[38px] rounded-md border border-border/20 bg-background px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">All distributors</option>
              {data.distributors.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="inv-from"
              className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground"
            >
              From
            </label>
            <input
              id="inv-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="min-h-[38px] rounded-md border border-border/20 bg-background px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="inv-to"
              className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground"
            >
              To
            </label>
            <input
              id="inv-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="min-h-[38px] rounded-md border border-border/20 bg-background px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setDistributor("");
                setFrom("");
                setTo("");
              }}
              className="ml-auto min-h-[38px] rounded-md border border-border/20 px-3 text-[12px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {data.invoices.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {hasFilters
                ? "No invoices match these filters. Try a wider date range."
                : "No invoices have been issued yet. They'll appear here once the first one is raised from the distributor portal."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border/20 text-left">
                  {[
                    "Invoice",
                    "Distributor",
                    "Period",
                    "Date",
                    "Before tax",
                    "Tax",
                    "Total",
                  ].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 text-[9.5px] font-black uppercase tracking-[0.1em] text-muted-foreground ${
                        i >= 4 ? "text-right" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-border/10 last:border-0 hover:bg-background/60"
                  >
                    <td className="px-4 py-2.5 tabular-nums text-foreground">
                      {inv.invoiceNumber || "—"}
                    </td>
                    <td className="px-4 py-2.5 break-all text-muted-foreground">
                      {inv.distributorEmail || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {inv.periodLabel ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {formatDate(inv.invoiceDate)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {money(inv.amountBeforeTax)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {money(inv.taxAmount)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-foreground">
                      {money(inv.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
