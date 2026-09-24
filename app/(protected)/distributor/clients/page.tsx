"use client";

import * as React from "react";
import { ChevronRight, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type ClientRow = {
  id: number;
  name: string;
  accountcode: string;
  /** Identifies the person, not the account — one investor may hold several. */
  investorKey?: string;
  scheme: string | null;
  latestAum: string;
  investedAmount: string;
  sinceInception: string | null;
  /** From Zoho CRM. Null when the investor has no CRM record, or when Zoho
   *  was unreachable — the portal's own figures still render either way. */
  activationDate?: string | null;
  relationshipManager?: string | null;
  annualReviewStatus?: string | null;
};

/** One investor, with every strategy account they hold. */
type Investor = {
  key: string;
  name: string;
  accounts: ClientRow[];
  totalAum: number;
  totalInvested: number;
  /** Earliest inception across their accounts — when they became a client. */
  since: string | null;
  /** From Zoho CRM — describes the person, so identical across their rows. */
  relationshipManager: string | null;
  activationDate: string | null;
};

/** Shared by the detail header, its rows and the total row — one definition so
 *  the three cannot drift out of alignment. Widths are sized to their widest
 *  header label, so nothing has to wrap or truncate. */
const DETAIL_GRID =
  "grid grid-cols-[minmax(180px,1.3fr)_130px_140px_130px_100px] gap-4";

// Strategy identity colours (design tokens — tied to the real products).
const SCHEME_COLOUR: Record<string, string> = {
  QAW: "#008455",
  QGF: "#0A3452",
  QTF: "#550E0E",
};
const SCHEME_NAME: Record<string, string> = {
  QAW: "Qode All Weather",
  QGF: "Qode Growth Fund",
  QTF: "Qode Tactical Fund",
  QFH: "Qode Fund of Holdings",
  QLF: "Qode Liquid Fund",
};

/**
 * Resolves a strategy label from either form of code.
 *
 * The API's `scheme` field is sometimes the 3-letter code ("QAW") and
 * sometimes the full account code ("QAW00098"). SCHEME_NAME only keys on the
 * prefix, so a full code fell through to the raw value and the account code
 * was printed twice — once as the "name" and once beneath it.
 */
function schemeName(scheme: string | null | undefined, accountcode: string | undefined): string {
  const prefix = String(scheme ?? accountcode ?? "").slice(0, 3).toUpperCase();
  return SCHEME_NAME[prefix] ?? scheme ?? accountcode ?? "—";
}

function schemeColour(scheme: string | null | undefined, accountcode: string | undefined): string {
  const prefix = String(scheme ?? accountcode ?? "").slice(0, 3).toUpperCase();
  return SCHEME_COLOUR[prefix] ?? "#9CA3AF";
}

/** Zoho returns ISO dates ("2026-07-08"); the portal shows "08 Jul 2026". */
function formatCrmDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const parseAmount = (s: string) => parseFloat(String(s ?? "").replace(/,/g, "")) || 0;

const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Compact form for the summary tiles — ₹1.84 Cr reads faster than ₹1,84,52,300.00 */
const inrCompact = (n: number) => {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  return `₹${inr(n)}`;
};

/** Parses the API's "dd-mm-yyyy" so inception dates can be compared. */
const parseDate = (s: string | null): number => {
  if (!s) return Number.POSITIVE_INFINITY;
  const [dd, mm, yyyy] = s.split("-");
  const t = new Date(`${yyyy}-${mm}-${dd}`).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

export default function DistributorClientsPage() {
  const [rows, setRows] = React.useState<ClientRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const fetchClients = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/distributor/clients", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Failed to load clients (${res.status})`);
        }
        const data = (await res.json()) as ClientRow[];
        setRows(data);
      } catch (e: any) {
        setError(e.message || "Failed to load clients");
        setRows([]);
      }
      setLoading(false);
    };

    fetchClients();
  }, []);

  // ── Group accounts by investor ────────────────────────────────────────────
  // The API returns one row per strategy account. A client holding QAW + QGF +
  // QTF appears three times, which made the list read as three clients and hid
  // what any one of them is actually worth. Group first, then sort by total
  // AUM — with values spanning ₹0 to ₹47 crore, an unsorted list buries the
  // accounts that matter.
  const investors = React.useMemo<Investor[]>(() => {
    const byKey = new Map<string, Investor>();

    for (const row of rows) {
      const key = row.investorKey || `account:${row.accountcode}`;
      let inv = byKey.get(key);
      if (!inv) {
        inv = {
          key,
          name: row.name,
          accounts: [],
          totalAum: 0,
          totalInvested: 0,
          since: null,
          relationshipManager: null,
          activationDate: null,
        };
        byKey.set(key, inv);
      }
      inv.accounts.push(row);
      inv.totalAum += parseAmount(row.latestAum);
      inv.totalInvested += parseAmount(row.investedAmount);
      if (parseDate(row.sinceInception) < parseDate(inv.since)) inv.since = row.sinceInception;

      // CRM fields describe the person, not the account, so they are identical
      // across a client's rows — take the first non-null rather than repeating
      // them per strategy.
      inv.relationshipManager ??= row.relationshipManager ?? null;
      inv.activationDate ??= row.activationDate ?? null;
    }

    for (const inv of byKey.values()) {
      inv.accounts.sort((a, b) => parseAmount(b.latestAum) - parseAmount(a.latestAum));
    }

    return [...byKey.values()].sort((a, b) => b.totalAum - a.totalAum);
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return investors;
    return investors.filter(
      (inv) =>
        inv.name.toLowerCase().includes(q) ||
        inv.accounts.some((a) => a.accountcode.toLowerCase().includes(q))
    );
  }, [investors, search]);

  const totals = React.useMemo(() => {
    const totalAum = investors.reduce((s, i) => s + i.totalAum, 0);
    const totalInvested = investors.reduce((s, i) => s + i.totalInvested, 0);

    // Per-strategy split — shows where a distributor's book actually sits.
    const bySchemeMap = new Map<string, { aum: number; accounts: number }>();
    for (const row of rows) {
      const scheme = row.scheme ?? "—";
      const cur = bySchemeMap.get(scheme) ?? { aum: 0, accounts: 0 };
      cur.aum += parseAmount(row.latestAum);
      cur.accounts += 1;
      bySchemeMap.set(scheme, cur);
    }
    const byScheme = [...bySchemeMap.entries()]
      .map(([scheme, v]) => ({ scheme, ...v }))
      .sort((a, b) => b.aum - a.aum);

    return {
      totalAum,
      totalInvested,
      gain: totalAum - totalInvested,
      totalClients: investors.length,
      totalAccounts: rows.length,
      byScheme,
    };
  }, [investors, rows]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const allExpanded = filtered.length > 0 && filtered.every((i) => expanded.has(i.key));
  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(filtered.map((i) => i.key)));

  return (
    <div className="flex flex-col gap-5 w-full mx-auto pb-10">
      <div>
        <h2 className="font-serif text-2xl text-foreground">Your Clients</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Grouped by investor. Values are as of the latest published NAV.
        </p>
      </div>

      {/* ── Summary ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Assets Under Management"
            value={inrCompact(totals.totalAum)}
            context={`₹ ${inr(totals.totalAum)}`}
          />
          <StatTile
            label="Total Invested"
            value={inrCompact(totals.totalInvested)}
            context={`₹ ${inr(totals.totalInvested)}`}
          />
          <StatTile
            label="Gain"
            value={`${totals.gain >= 0 ? "+" : "−"}${inrCompact(Math.abs(totals.gain))}`}
            context={
              totals.totalInvested > 0
                ? `${totals.gain >= 0 ? "+" : "−"}${Math.abs(
                    (totals.gain / totals.totalInvested) * 100
                  ).toFixed(2)}% on invested`
                : undefined
            }
            tone={totals.gain >= 0 ? "positive" : "negative"}
          />
          <StatTile
            label="Clients"
            value={String(totals.totalClients)}
            context={
              totals.totalAccounts !== totals.totalClients
                ? `across ${totals.totalAccounts} strategy accounts`
                : undefined
            }
          />
        </div>
      ) : null}

      {/* ── Strategy split ─────────────────────────────────────────────── */}
      {!loading && totals.byScheme.length > 1 && (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-4">
          <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-3">
            By Strategy
          </div>
          <div className="flex flex-col gap-2.5">
            {totals.byScheme.map((s) => {
              const pct = totals.totalAum > 0 ? (s.aum / totals.totalAum) * 100 : 0;
              return (
                <div key={s.scheme} className="flex items-center gap-3">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: schemeColour(s.scheme, undefined) }}
                    aria-hidden
                  />
                  <span className="text-sm text-foreground min-w-0 flex-1 truncate">
                    {schemeName(s.scheme, undefined)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {s.accounts} {s.accounts === 1 ? "account" : "accounts"}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-foreground shrink-0">
                    {inrCompact(s.aum)}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground w-12 text-right shrink-0">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Search / expand ────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or account code"
              aria-label="Search clients"
              className="w-full rounded-md border border-border/20 bg-card pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
            />
          </div>
          <button
            onClick={toggleAll}
            className="text-sm font-bold text-primary dark:text-primary-foreground underline underline-offset-4 px-2 py-2 min-h-[44px]"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {/* ── States ────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm font-bold text-destructive">We couldn&apos;t load your clients.</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error}. Please refresh, or contact{" "}
            <a href="mailto:operations@qodeinvest.com" className="underline underline-offset-2">
              operations@qodeinvest.com
            </a>
            .
          </p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[72px] rounded-xl" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-12 text-center">
          <p className="font-serif text-lg text-foreground">No clients yet</p>
          <p className="text-sm text-muted-foreground mt-1.5">
            Clients mapped to you will appear here once their accounts are active.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-foreground">
            No client matches &ldquo;{search}&rdquo;.
          </p>
          <button
            onClick={() => setSearch("")}
            className="text-sm font-bold text-primary dark:text-primary-foreground underline underline-offset-4 mt-2 min-h-[44px]"
          >
            Clear search
          </button>
        </div>
      )}

      {/* ── Client list ───────────────────────────────────────────────── */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-2">
          {filtered.map((inv) => (
            <InvestorCard
              key={inv.key}
              investor={inv}
              open={expanded.has(inv.key)}
              onToggle={() => toggle(inv.key)}
            />
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {totals.totalClients}{" "}
          {totals.totalClients === 1 ? "client" : "clients"}. NAV is published daily, not live.
        </p>
      )}
    </div>
  );
}

// ── Components ──────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  context,
  tone,
}: {
  label: string;
  value: string;
  context?: string;
  tone?: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[#008455] dark:text-[#12a06c]"
      : tone === "negative"
        ? "text-destructive"
        : "text-foreground";

  return (
    <div className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-4">
      <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
        {label}
      </div>
      {/* Figures are set in Lato, not the Playfair used for headings: Playfair's
          serif ₹ and old-style-ish digits read unevenly next to the "Cr"/"L"
          suffix, and its numerals are the wrong tool for values meant to be
          compared down a column. Lato's tabular figures line up exactly. */}
      <div className={`text-[1.7rem] font-bold leading-tight mt-1.5 tabular-nums tracking-tight ${toneClass}`}>
        {value}
      </div>
      {context && (
        <div className="text-xs text-muted-foreground mt-1 tabular-nums truncate">{context}</div>
      )}
    </div>
  );
}

function InvestorCard({
  investor,
  open,
  onToggle,
}: {
  investor: Investor;
  open: boolean;
  onToggle: () => void;
}) {
  const gain = investor.totalAum - investor.totalInvested;
  const gainPct = investor.totalInvested > 0 ? (gain / investor.totalInvested) * 100 : 0;

  return (
    <div className="rounded-xl border border-border/20 bg-card shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-4 sm:px-5 py-3.5 flex items-center gap-3 hover:bg-muted/40 transition-colors min-h-[44px] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
      >
        <ChevronRight
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground truncate">{investor.name}</div>
          {/* Name the strategies rather than showing anonymous dots — two grey
              squares tell a distributor nothing about what the client holds. */}
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 flex-wrap">
              {investor.accounts.map((a) => (
                <span
                  key={a.accountcode}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60"
                  title={schemeName(a.scheme, a.accountcode)}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: schemeColour(a.scheme, a.accountcode) }}
                    aria-hidden
                  />
                  {String(a.scheme ?? a.accountcode ?? "").slice(0, 3).toUpperCase()}
                </span>
              ))}
            </span>
            {investor.since && <span aria-hidden>·</span>}
            {investor.since && <span className="whitespace-nowrap">since {investor.since}</span>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-foreground tabular-nums">
            {inrCompact(investor.totalAum)}
          </div>
          {investor.totalInvested > 0 && (
            <div
              className={`text-xs tabular-nums mt-0.5 ${
                gain >= 0 ? "text-[#008455] dark:text-[#12a06c]" : "text-destructive"
              }`}
            >
              {gain >= 0 ? "+" : "−"}
              {Math.abs(gainPct).toFixed(2)}%
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/15 bg-background/40">
          {/* Client context from the CRM. Rendered only when Zoho returned
              something — an empty strip of dashes is worse than no strip. */}
          {(investor.relationshipManager || investor.activationDate) && (
            <div className="px-4 sm:px-5 py-2.5 border-b border-border/15 text-xs text-muted-foreground flex gap-x-6 gap-y-1 flex-wrap">
              {investor.relationshipManager && (
                <span className="whitespace-nowrap">
                  Relationship manager{" "}
                  <span className="text-foreground">{investor.relationshipManager}</span>
                </span>
              )}
              {investor.activationDate && (
                <span className="whitespace-nowrap">
                  Funded{" "}
                  <span className="text-foreground tabular-nums">
                    {formatCrmDate(investor.activationDate)}
                  </span>
                </span>
              )}
            </div>
          )}
          {/* Per-account detail. A horizontal scroller rather than a table so the
              page body never scrolls sideways on a phone. */}
          <div className="overflow-x-auto">
            {/* Fixed column widths, not `auto`: with `auto` every card sized
                its own columns, so nothing aligned between one client and the
                next and the numbers bunched against the right edge.
                whitespace-nowrap keeps each row one line tall. */}
            <div className="min-w-[660px]">
              <div className={`${DETAIL_GRID} px-4 sm:px-5 py-2.5 text-[10.5px] font-bold tracking-[0.08em] uppercase text-muted-foreground border-b border-border/15 whitespace-nowrap`}>
                <span>Strategy</span>
                <span className="text-right">Invested</span>
                <span className="text-right">Current Value</span>
                <span className="text-right">Gain</span>
                <span className="text-right">Return</span>
              </div>

              {investor.accounts.map((a) => {
                const aum = parseAmount(a.latestAum);
                const inv = parseAmount(a.investedAmount);
                const g = aum - inv;
                const pct = inv > 0 ? (g / inv) * 100 : null;
                const positive = g >= 0;
                return (
                  <div
                    key={a.accountcode}
                    className={`${DETAIL_GRID} px-4 sm:px-5 py-3 border-b border-border/10 last:border-0 items-center whitespace-nowrap`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-foreground flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ background: schemeColour(a.scheme, a.accountcode) }}
                          aria-hidden
                        />
                        <span className="truncate">
                          {schemeName(a.scheme, a.accountcode)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 pl-4 truncate">
                        {a.accountcode}
                        {a.sinceInception && ` · since ${a.sinceInception}`}
                      </div>
                    </div>

                    <span className="text-sm tabular-nums text-muted-foreground text-right">
                      {a.investedAmount}
                    </span>
                    <span className="text-sm tabular-nums text-foreground text-right">
                      {a.latestAum}
                    </span>
                    <span
                      className={`text-sm tabular-nums text-right ${
                        inv > 0
                          ? positive
                            ? "text-[#008455] dark:text-[#12a06c]"
                            : "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {inv > 0 ? `${positive ? "+" : "−"}${inr(Math.abs(g))}` : "—"}
                    </span>
                    {/* Percentage as well as rupees: a ₹1.43 L gain on ₹1.45 Cr
                        and on ₹25 L are very different outcomes, and only the
                        percentage makes that legible at a glance. */}
                    <span
                      className={`text-sm tabular-nums text-right ${
                        pct === null
                          ? "text-muted-foreground"
                          : positive
                            ? "text-[#008455] dark:text-[#12a06c]"
                            : "text-destructive"
                      }`}
                    >
                      {pct === null ? "—" : `${positive ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}
                    </span>
                  </div>
                );
              })}

              {/* Per-client total, so the card header reconciles with its rows.
                  Only when there is more than one account — otherwise it just
                  repeats the row above. */}
              {investor.accounts.length > 1 && (
                <div className={`${DETAIL_GRID} px-4 sm:px-5 py-3 bg-muted/30 items-center border-t border-border/15 whitespace-nowrap`}>
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    Total
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground text-right">
                    {inr(investor.totalInvested)}
                  </span>
                  <span className="text-sm tabular-nums text-foreground text-right">
                    {inr(investor.totalAum)}
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums text-right ${
                      gain >= 0 ? "text-[#008455] dark:text-[#12a06c]" : "text-destructive"
                    }`}
                  >
                    {investor.totalInvested > 0
                      ? `${gain >= 0 ? "+" : "−"}${inr(Math.abs(gain))}`
                      : "—"}
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums text-right ${
                      gain >= 0 ? "text-[#008455] dark:text-[#12a06c]" : "text-destructive"
                    }`}
                  >
                    {investor.totalInvested > 0
                      ? `${gain >= 0 ? "+" : "−"}${Math.abs(gainPct).toFixed(2)}%`
                      : "—"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
