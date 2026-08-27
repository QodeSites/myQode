"use client";

import * as React from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type ClientRow = {
  id: number;
  clientid: string | null;
  clientname: string | null;
  clientcode: string | null;
  email: string | null;
  mobile: string | null;
  groupid: string | null;
  groupname: string | null;
  headOfFamily: boolean | null;
  onboardingStatus: string | null;
  lastLoginAt: string | null;
};

type ListResponse = {
  rows: ClientRow[];
  total: number;
  page: number;
  pageSize: number;
};

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
];

/** Renders an ISO timestamp as "07 Jul 2026". Null-safe. */
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

export default function AdminClientsPage() {
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "unauthorized" | "error">(
    "loading",
  );
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [page, setPage] = React.useState(1);

  // Debounce the search box so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const params = new URLSearchParams();
        if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
        if (statusFilter) params.set("status", statusFilter);
        params.set("page", String(page));

        const res = await fetch(`/api/admin/clients?${params}`, { cache: "no-store" });
        if (cancelled) return;

        if (res.status === 401 || res.status === 403) {
          setStatus("unauthorized");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }

        setData((await res.json()) as ListResponse);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQ, statusFilter, page]);

  if (status === "unauthorized") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl">Clients</h1>
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Your session has expired.{" "}
            <a
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
              href="/admin/login?redirect=/admin/clients"
            >
              Sign in again
            </a>{" "}
            to continue.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl">Clients</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load the client list. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl">Clients</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search every investor account, and open one to edit their details or set
          their head of family.
        </p>
      </header>

      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => {
                  setStatusFilter(f.key);
                  setPage(1);
                }}
                aria-pressed={statusFilter === f.key}
                className={`min-h-[36px] rounded-full border px-3 text-xs font-bold transition-colors ${
                  statusFilter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/20 bg-background text-muted-foreground hover:border-primary/50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, client code or family"
              aria-label="Search clients"
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
        </div>

        {status === "loading" ? (
          <div className="mt-5 flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="mt-5 rounded-md border border-border/20 bg-background px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No clients match this search. Try a different name, email or client code.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {from}–{to} of {total}
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/20 text-left">
                    {["Name", "Client code", "Email", "Family", "Status", "Last login"].map(
                      (h) => (
                        <th
                          key={h}
                          className="py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground last:pr-0"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border/10 last:border-0 hover:bg-background/60"
                    >
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {c.clientname ?? "—"}
                        </Link>
                        {c.headOfFamily ? (
                          <span className="ml-2 inline-block rounded-full border border-border/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary dark:text-primary-foreground">
                            Head
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                        {c.clientcode ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 break-all text-muted-foreground">
                        {c.email ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {c.groupname ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {c.onboardingStatus ?? "—"}
                      </td>
                      <td className="py-2.5 tabular-nums text-muted-foreground">
                        {formatDate(c.lastLoginAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="min-h-[44px] rounded-md border border-border/20 bg-background px-4 text-sm font-bold text-primary disabled:opacity-40 dark:text-primary-foreground"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={to >= total}
                className="min-h-[44px] rounded-md border border-border/20 bg-background px-4 text-sm font-bold text-primary disabled:opacity-40 dark:text-primary-foreground"
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
