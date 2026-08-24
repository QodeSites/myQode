"use client";

import * as React from "react";
import { AlertTriangle, ArrowUpDown, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Internal distributor management view.
 *
 * Built around what needs doing rather than what exists: 140 partners is too
 * many to read, so the page leads with the exceptions (unlinked logins,
 * overdue follow-ups, missing CRM fields) and lets the team filter down to a
 * working set. Every filter is a saved question the team actually asks.
 */

type DistributorRow = {
  zohoId: string;
  name: string | null;
  email: string | null;
  secondaryEmail: string | null;
  stage: string | null;
  type: string | null;
  aum: number | null;
  lastContactDate: string | null;
  nextContactDate: string | null;
  sharePct: number | null;
  revenueSharingModel: string | null;
  portalName: string | null;
  portalEmail: string | null;
  hasPortalLogin: boolean;
  referredCount: number;
  portalClientCount: number;
  stageCounts: Record<string, number> | null;
  followUpOverdue: boolean;
  loginUnlinked: boolean;
};

type UnlinkedLogin = { email: string; clientname: string; clientCount: number };

type Overview = {
  summary: {
    totalDistributors: number;
    withPortalLogin: number;
    withReferrals: number;
    overdueFollowUps: number;
    missingSecondaryEmail: number;
    unlinkedLoginCount: number;
    totalReferredInvestors: number;
  };
  distributors: DistributorRow[];
  unlinkedLogins: UnlinkedLogin[];
  investorTotals: Record<string, number>;
  stageOrder: string[];
};

type FilterKey =
  | "all"
  | "active"
  | "referring"
  | "portal"
  | "overdue"
  | "noSecondary"
  | "lost";

const FILTERS: { key: FilterKey; label: string; hint: string }[] = [
  { key: "all", label: "All", hint: "Every distributor in the CRM" },
  { key: "active", label: "Active", hint: "Not marked lost" },
  { key: "referring", label: "Referring", hint: "Has referred at least one investor" },
  { key: "portal", label: "Portal login", hint: "Can sign in to myQode" },
  { key: "overdue", label: "Follow-up overdue", hint: "Next contact date has passed" },
  { key: "noSecondary", label: "No secondary email", hint: "Cannot match a portal login" },
  { key: "lost", label: "Lost", hint: "Marked lost, no follow-up" },
];

type SortKey = "name" | "referred" | "nextContact" | "share";

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

function isLost(stage: string | null): boolean {
  return Boolean(stage && stage.toLowerCase().startsWith("lost"));
}

function StatTile({
  label,
  value,
  tone = "normal",
  onClick,
  active,
}: {
  label: string;
  value: number;
  tone?: "normal" | "warn";
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <>
      <p className="text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-serif text-2xl tabular-nums ${
          tone === "warn" && value > 0 ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </>
  );

  if (!onClick) {
    return (
      <div className="rounded-md border border-border/20 bg-background px-4 py-3">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-4 py-3 text-left transition-colors hover:border-primary/50 ${
        active ? "border-primary bg-primary/5" : "border-border/20 bg-background"
      }`}
    >
      {content}
    </button>
  );
}

export default function InternalDistributorOverviewPage() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [status, setStatus] = React.useState<
    "loading" | "ready" | "unauthorized" | "error"
  >("loading");
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("referred");
  const [expanded, setExpanded] = React.useState<string | null>(null);

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
        setData((await res.json()) as Overview);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = React.useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();

    const filtered = data.distributors.filter((d) => {
      switch (filter) {
        case "active":
          if (isLost(d.stage)) return false;
          break;
        case "referring":
          if (d.referredCount === 0) return false;
          break;
        case "portal":
          if (!d.hasPortalLogin) return false;
          break;
        case "overdue":
          if (!d.followUpOverdue) return false;
          break;
        case "noSecondary":
          if (d.secondaryEmail) return false;
          break;
        case "lost":
          if (!isLost(d.stage)) return false;
          break;
        default:
          break;
      }

      if (!needle) return true;
      return [d.name, d.email, d.secondaryEmail, d.portalName, d.stage]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return String(a.name ?? "").localeCompare(String(b.name ?? ""));
        case "nextContact":
          // Nulls last, so the soonest due date leads.
          if (!a.nextContactDate) return 1;
          if (!b.nextContactDate) return -1;
          return a.nextContactDate.localeCompare(b.nextContactDate);
        case "share":
          return (b.sharePct ?? -1) - (a.sharePct ?? -1);
        default:
          return b.referredCount - a.referredCount;
      }
    });

    return sorted;
  }, [data, filter, q, sort]);

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "unauthorized") {
    return (
      <div className="flex w-full flex-col gap-5">
        <h1 className="text-2xl">Distributor Management</h1>
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
      <div className="flex w-full flex-col gap-5">
        <h1 className="text-2xl">Distributor Management</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load the distributor data. This usually means the CRM was
            unreachable — please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="flex w-full flex-col gap-5">
      <header>
        <h1 className="text-2xl">Distributor Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.totalDistributors} partners in the CRM · {s.withPortalLogin} can sign in ·{" "}
          {s.totalReferredInvestors} investors referred
        </p>
      </header>

      {/* Needs attention. Leads the page because these are the only rows that
          imply an action; the rest is reference. */}
      {s.unlinkedLoginCount > 0 || s.overdueFollowUps > 0 ? (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-foreground">Needs attention</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {data.unlinkedLogins.map((u) => (
                  <li key={u.email}>
                    <span className="font-bold text-foreground">{u.clientname}</span>{" "}
                    signs in as <code className="text-xs">{u.email}</code>, which is on
                    no CRM record — their journey page is empty despite{" "}
                    {u.clientCount} {u.clientCount === 1 ? "account" : "accounts"}. Add
                    the address to <code className="text-xs">Secondary_Email</code> in
                    Zoho.
                  </li>
                ))}
                {s.overdueFollowUps > 0 ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setFilter("overdue");
                        setSort("nextContact");
                      }}
                      className="font-bold text-foreground underline underline-offset-4"
                    >
                      {s.overdueFollowUps} follow-ups are overdue
                    </button>{" "}
                    — their next contact date has passed.
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {/* Summary tiles double as filters — the numbers are the entry point. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="All partners"
          value={s.totalDistributors}
          onClick={() => setFilter("all")}
          active={filter === "all"}
        />
        <StatTile
          label="Referring"
          value={s.withReferrals}
          onClick={() => setFilter("referring")}
          active={filter === "referring"}
        />
        <StatTile
          label="Portal login"
          value={s.withPortalLogin}
          onClick={() => setFilter("portal")}
          active={filter === "portal"}
        />
        <StatTile
          label="Follow-up overdue"
          value={s.overdueFollowUps}
          tone="warn"
          onClick={() => setFilter("overdue")}
          active={filter === "overdue"}
        />
        <StatTile
          label="No secondary email"
          value={s.missingSecondaryEmail}
          tone="warn"
          onClick={() => setFilter("noSecondary")}
          active={filter === "noSecondary"}
        />
        <StatTile label="Investors referred" value={s.totalReferredInvestors} />
      </div>

      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        {/* Controls */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                title={f.hint}
                aria-pressed={filter === f.key}
                className={`min-h-[36px] rounded-full border px-3 text-xs font-bold transition-colors ${
                  filter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/20 bg-background text-muted-foreground hover:border-primary/50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email or stage"
              aria-label="Search distributors"
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

        <p className="mt-3 text-xs text-muted-foreground">
          Showing {rows.length} of {s.totalDistributors}
          {filter !== "all" ? ` · ${FILTERS.find((f) => f.key === filter)?.hint}` : ""}
        </p>

        {rows.length === 0 ? (
          <div className="mt-4 rounded-md border border-border/20 bg-background px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No distributors match this view. Try a different filter, or clear the
              search.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/20 text-left">
                  <th className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setSort("name")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      Distributor <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Stage
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSort("referred")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      Referred <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSort("share")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      Share <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSort("nextContact")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      Next contact <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Access
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const open = expanded === d.zohoId;
                  return (
                    <React.Fragment key={d.zohoId}>
                      <tr
                        onClick={() => setExpanded(open ? null : d.zohoId)}
                        className="cursor-pointer border-b border-border/10 last:border-0 hover:bg-background/60"
                      >
                        <td className="py-2.5 pr-4">
                          <span className="text-foreground">{d.name ?? "—"}</span>
                          {d.type ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {d.type}
                            </span>
                          ) : null}
                        </td>
                        <td
                          className={`py-2.5 pr-4 ${
                            isLost(d.stage) ? "text-muted-foreground" : "text-foreground"
                          }`}
                        >
                          {d.stage ?? "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                          {d.referredCount || "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                          {d.sharePct != null ? `${d.sharePct}%` : "—"}
                        </td>
                        <td
                          className={`py-2.5 pr-4 text-right tabular-nums ${
                            d.followUpOverdue
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatDate(d.nextContactDate)}
                        </td>
                        <td className="py-2.5">
                          {d.hasPortalLogin ? (
                            <span className="text-xs text-muted-foreground">
                              Portal login
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/70">—</span>
                          )}
                        </td>
                      </tr>

                      {open ? (
                        <tr className="border-b border-border/10 bg-background/40">
                          <td colSpan={6} className="px-4 py-4">
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  CRM email
                                </dt>
                                <dd className="mt-0.5 break-all text-sm text-foreground">
                                  {d.email ?? "—"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Secondary email
                                </dt>
                                <dd className="mt-0.5 break-all text-sm text-foreground">
                                  {d.secondaryEmail ?? (
                                    <span className="text-destructive">Not set</span>
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Portal account
                                </dt>
                                <dd className="mt-0.5 text-sm text-foreground">
                                  {d.portalName ?? "No portal login"}
                                  {d.portalClientCount > 0
                                    ? ` · ${d.portalClientCount} accounts`
                                    : ""}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Revenue model
                                </dt>
                                <dd className="mt-0.5 text-sm text-foreground">
                                  {d.revenueSharingModel ?? "—"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Last contact
                                </dt>
                                <dd className="mt-0.5 text-sm tabular-nums text-foreground">
                                  {formatDate(d.lastContactDate)}
                                </dd>
                              </div>
                              {d.stageCounts ? (
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Their investors
                                  </dt>
                                  <dd className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground">
                                    {data.stageOrder
                                      .filter((st) => (d.stageCounts?.[st] ?? 0) > 0)
                                      .map((st) => (
                                        <span key={st}>
                                          <span className="tabular-nums font-bold">
                                            {d.stageCounts?.[st]}
                                          </span>{" "}
                                          <span className="text-muted-foreground">
                                            {st}
                                          </span>
                                        </span>
                                      ))}
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
