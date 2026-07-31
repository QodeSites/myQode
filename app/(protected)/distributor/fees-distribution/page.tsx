"use client";

import * as React from "react";
import { ChevronRight, Search, Download, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// --- Types ---

type CalculatorRow = {
  id: number;
  clientName: string;
  strategy: string;
  inceptionDate: string | null;
  averageAum: string;
  performanceFees: string;
  performanceFeesGst: string;
  fixedFees: string;
  fixedFeesGst: string;
  totalFees: string;
  totalFeesGst: string;
  totalFeesCollected: string;
  /** The revenue-share slab, e.g. "65.00" — from Distributor_Share_Category. */
  distributorPercentage: string;
  distributorShare: string;
  /** How the share breaks down across the two fee types. */
  distributorShareFixed?: string;
  distributorSharePerf?: string;
  /** Raw Zoho picklist label, e.g. "65%". */
  distributorShareCategory?: string | null;
  /** Where the rate came from — 'unmapped' means no rate is configured. */
  rateSource?: "zoho" | "legacy" | "unmapped";
  accountcode?: string;
  billgroup?: string;
};

/** One client, with every strategy account they hold in this period. */
type ClientGroup = {
  key: string;
  clientName: string;
  accounts: CalculatorRow[];
  aum: number;
  fixedFees: number;
  perfFees: number;
  totalFees: number;
  gst: number;
  share: number;
  /** True when no account for this client has a configured rate. */
  unmapped: boolean;
};

type Period = {
  type: "Quarter" | "Year";
  label: string;
  startDate: string;
  endDate: string;
};

type PeriodApiResponse = {
  periods: Period[];
  suggestedPeriod: Period | null;
  maxInceptionDate: string;
};

// --- Utility ---

const num = (s: string | undefined) => parseFloat(String(s ?? "").replace(/,/g, "")) || 0;

const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Compact form for headline figures — ₹4.12 L reads faster than ₹4,12,338.00 */
const inrCompact = (n: number) => {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  return `₹${inr(n)}`;
};

/** Shared by the detail header, its rows, and the total row — one definition
 *  so the three can never drift out of alignment. Fixed widths, not `auto`:
 *  with `auto` each card sized its own columns and nothing lined up between
 *  one client and the next. */
// Column widths are sized to their widest content — "DISTRIBUTOR %" and
// "TOTAL + GST" set the minimums, not the numbers. Anything narrower makes the
// header labels wrap onto two lines and knocks the rows out of vertical
// alignment. `whitespace-nowrap` on the cells enforces it; these widths mean
// nothing has to be truncated to comply.
const DETAIL_GRID =
  "grid grid-cols-[minmax(190px,1.3fr)_120px_100px_105px_105px_95px_115px_115px_115px] gap-4";

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
 * Resolves a strategy label.
 *
 * The API's `strategy` field is sometimes the 3-letter scheme code ("QAW") and
 * sometimes the full account code ("QAW00098"). SCHEME_NAME only keys on the
 * prefix, so the full code fell through to the raw value — which is why the
 * account code appeared twice in a row, once as the "name" and once beneath it.
 */
function schemeName(strategy: string | undefined, accountcode: string | undefined): string {
  const prefix = String(strategy ?? accountcode ?? "").slice(0, 3).toUpperCase();
  return SCHEME_NAME[prefix] ?? strategy ?? accountcode ?? "—";
}

function schemeColour(strategy: string | undefined, accountcode: string | undefined): string {
  const prefix = String(strategy ?? accountcode ?? "").slice(0, 3).toUpperCase();
  return SCHEME_COLOUR[prefix] ?? "#9CA3AF";
}

/** Parses a billgroup like "QODEPMS MF1.5 PF15 H10 Q NEW" into its fee terms. */
function parseBillgroupFees(billgroup: string | undefined) {
  if (!billgroup) return null;
  const mf = billgroup.match(/MF([\d.]+)/);
  const pf = billgroup.match(/PF([\d.]+)/);
  const h = billgroup.match(/H([\d.]+)/);
  if (!mf && !pf && !h) return null;
  return {
    managementFees: mf ? `${mf[1]}%` : "—",
    performanceFees: pf ? `${pf[1]}%` : "—",
    hurdleRate: h ? `${h[1]}%` : "—",
  };
}

// --- Main Component ---

export default function FeesDistributionPage() {
  const [periodsData, setPeriodsData] = React.useState<PeriodApiResponse | null>(null);
  const [periodsLoading, setPeriodsLoading] = React.useState(true);
  const [periodsError, setPeriodsError] = React.useState<string | null>(null);
  const [selectedPeriodLabel, setSelectedPeriodLabel] = React.useState<string>("");

  const [rows, setRows] = React.useState<CalculatorRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const fetchPeriods = async () => {
      setPeriodsLoading(true);
      setPeriodsError(null);
      try {
        const res = await fetch("/api/distributor/calculator", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Could not load periods (${res.status})`);
        const obj = (await res.json()) as PeriodApiResponse;
        setPeriodsData(obj);
        const initPeriod = obj.suggestedPeriod || obj.periods[0];
        if (initPeriod) setSelectedPeriodLabel(initPeriod.label);
      } catch (e: any) {
        setPeriodsError(e.message || "Could not load periods");
      }
      setPeriodsLoading(false);
    };
    fetchPeriods();
  }, []);

  const selectedPeriod = React.useMemo(() => {
    if (!periodsData) return null;
    return periodsData.periods.find((p) => p.label === selectedPeriodLabel) || null;
  }, [periodsData, selectedPeriodLabel]);

  React.useEffect(() => {
    if (!selectedPeriod) return;
    const fetchRows = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/distributor/calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: selectedPeriod.startDate,
            endDate: selectedPeriod.endDate,
          }),
        });
        if (!res.ok) throw new Error(`Could not load fees (${res.status})`);
        const apiRows = (await res.json()) as any[];
        setRows(
          apiRows.map((r) => ({
            id: r.id,
            clientName: r.clientName,
            strategy: r.strategy,
            inceptionDate: r.inceptionDate ?? null,
            averageAum: r.averageAum,
            performanceFees: r.performanceFees,
            performanceFeesGst: r.performanceFeesGst,
            fixedFees: r.fixedFees,
            fixedFeesGst: r.fixedFeesGst,
            totalFees: r.totalFees,
            totalFeesGst: r.totalFeesGst,
            totalFeesCollected: r.totalFeesCollected,
            distributorPercentage: r.distributorPercentage,
            distributorShare: r.distributorShare,
            distributorFixedFeePercentage: r.distributorFixedFeePercentage,
            distributorPerfFeePercentage: r.distributorPerfFeePercentage,
            distributorShareFixed: r.distributorShareFixed,
            distributorSharePerf: r.distributorSharePerf,
            rateSource: r.rateSource,
            accountcode: r.accountcode,
            billgroup: r.billGroup,
          })),
        );
      } catch (e: any) {
        setError(e.message || "Could not load fees");
        setRows([]);
      }
      setLoading(false);
    };
    fetchRows();
  }, [selectedPeriod]);

  // ── Group accounts by client ────────────────────────────────────────────
  // The API returns one row per strategy account, so a client with three
  // strategies appeared three times — with their name repeated and no way to
  // see what they were worth in total. Group first, then sort by the number
  // the distributor actually came here for: their own share.
  const clients = React.useMemo<ClientGroup[]>(() => {
    const byKey = new Map<string, ClientGroup>();
    for (const row of rows) {
      const key = row.clientName.trim().toLowerCase().replace(/\s+/g, " ");
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          clientName: row.clientName,
          accounts: [],
          aum: 0,
          fixedFees: 0,
          perfFees: 0,
          totalFees: 0,
          gst: 0,
          share: 0,
          unmapped: true,
        };
        byKey.set(key, g);
      }
      g.accounts.push(row);
      g.aum += num(row.averageAum);
      g.fixedFees += num(row.fixedFees);
      g.perfFees += num(row.performanceFees);
      g.totalFees += num(row.totalFees);
      g.gst += num(row.totalFeesGst);
      g.share += num(row.distributorShare);
      if (row.rateSource && row.rateSource !== "unmapped") g.unmapped = false;
    }
    for (const g of byKey.values()) {
      g.accounts.sort((a, b) => num(b.distributorShare) - num(a.distributorShare));
    }
    return [...byKey.values()].sort((a, b) => b.share - a.share);
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.clientName.toLowerCase().includes(q) ||
        c.accounts.some((a) => (a.accountcode ?? "").toLowerCase().includes(q)),
    );
  }, [clients, search]);

  const totals = React.useMemo(() => {
    const share = clients.reduce((s, c) => s + c.share, 0);
    const unmappedCount = clients.filter((c) => c.unmapped).length;
    // One rate for the whole distributor. Prefer Zoho's own label ("65%") over
    // the parsed number so the page shows exactly what the CRM shows.
    const first = rows[0];
    const sharePct =
      first?.distributorShareCategory ??
      (first?.distributorPercentage && num(first.distributorPercentage) > 0
        ? `${first.distributorPercentage}%`
        : null);
    return {
      share,
      sharePct,
      aum: clients.reduce((s, c) => s + c.aum, 0),
      fixedFees: clients.reduce((s, c) => s + c.fixedFees, 0),
      perfFees: clients.reduce((s, c) => s + c.perfFees, 0),
      totalFees: clients.reduce((s, c) => s + c.totalFees, 0),
      gst: clients.reduce((s, c) => s + c.gst, 0),
      clientCount: clients.length,
      accountCount: rows.length,
      unmappedCount,
    };
  }, [clients, rows]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  /** CSV of the per-account detail — what gets attached to an invoice. */
  const downloadCsv = () => {
    // Mirrors the on-screen columns so a downloaded file reconciles with what
    // was reviewed before invoicing.
    const head = [
      "Client", "Account Code", "Strategy", "Inception Date", "Daily Avg AUM",
      "Perf. Fees", "Fixed Fees", "Total Fees", "Total Fees GST", "Total (Fees + GST)",
      "Distributor %", "Distributor Share", "Rate Source",
    ];
    const lines = [head.join(",")];
    for (const c of clients) {
      for (const a of c.accounts) {
        lines.push(
          [
            `"${c.clientName}"`,
            a.accountcode ?? "",
            a.strategy ?? "",
            a.inceptionDate ?? "",
            num(a.averageAum).toFixed(2),
            num(a.performanceFees).toFixed(2),
            num(a.fixedFees).toFixed(2),
            num(a.totalFees).toFixed(2),
            num(a.totalFeesGst).toFixed(2),
            (num(a.totalFees) + num(a.totalFeesGst)).toFixed(2),
            a.distributorPercentage ?? "",
            num(a.distributorShare).toFixed(2),
            a.rateSource ?? "",
          ].join(","),
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qode-fees-${selectedPeriod?.label.replace(/\s+/g, "-") ?? "period"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const busy = periodsLoading || loading;

  return (
    <div className="flex flex-col gap-5 w-full mx-auto pb-10">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Your Fees</h2>
          <p className="text-sm text-muted-foreground mt-1">
            What you have earned from client fees in the selected period.
          </p>
        </div>
        <div className="w-full sm:w-72">
          <label
            htmlFor="period"
            className="block text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-1.5"
          >
            Period
          </label>
          {periodsLoading ? (
            <Skeleton className="h-10 rounded-md" />
          ) : periodsError ? (
            <p className="text-sm text-destructive">{periodsError}</p>
          ) : periodsData ? (
            <Select value={selectedPeriodLabel} onValueChange={setSelectedPeriodLabel}>
              <SelectTrigger id="period" className="w-full min-h-[44px]">
                <SelectValue placeholder="Select a period" />
              </SelectTrigger>
              <SelectContent>
                {periodsData.periods.map((p) => (
                  <SelectItem key={p.label} value={p.label}>
                    {p.label} · {p.startDate} – {p.endDate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      {/* ── The answer they came for ───────────────────────────────────── */}
      {busy ? (
        <Skeleton className="h-[132px] rounded-xl" />
      ) : rows.length > 0 ? (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-5">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
                Your share for {selectedPeriod?.label}
              </div>
              <div className="text-[2.5rem] font-bold leading-none mt-2 tabular-nums tracking-tight text-foreground">
                {inrCompact(totals.share)}
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 tabular-nums">
                ₹ {inr(totals.share)} · from {totals.clientCount}{" "}
                {totals.clientCount === 1 ? "client" : "clients"}
              </div>
              {/* The rate is one slab for the whole distributor, so it is
                  stated once here rather than repeated on every row. */}
              {totals.sharePct && (
                <div className="text-sm text-muted-foreground mt-1">
                  Your revenue share:{" "}
                  <span className="text-foreground font-bold tabular-nums">
                    {totals.sharePct}
                  </span>{" "}
                  of fees billed
                </div>
              )}
            </div>
            <button
              onClick={downloadCsv}
              className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground font-bold text-sm px-4 py-2.5 min-h-[44px] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
            >
              <Download className="w-4 h-4" aria-hidden />
              Download for invoice
            </button>
          </div>

          {/* How the share was earned — fixed vs performance carry different
              rates, so showing only the combined total hides the split. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 mt-6 pt-5 border-t border-border/15">
            <Metric label="Client AUM" value={inrCompact(totals.aum)} />
            <Metric label="Fixed fees" value={inrCompact(totals.fixedFees)} />
            <Metric label="Performance fees" value={inrCompact(totals.perfFees)} />
            <Metric
              label="Total fees billed"
              value={inrCompact(totals.totalFees)}
              context={`+ ${inrCompact(totals.gst)} GST`}
            />
          </div>
        </div>
      ) : null}

      {/* ── Unmapped warning ───────────────────────────────────────────── */}
      {!busy && totals.unmappedCount > 0 && (
        <div className="rounded-xl border border-[#9a6b12]/30 bg-[#9a6b12]/5 px-5 py-4 flex gap-3">
          <AlertTriangle
            className="w-4 h-4 text-[#9a6b12] dark:text-[#e0b558] shrink-0 mt-0.5"
            aria-hidden
          />
          <div>
            <p className="text-sm font-bold text-foreground">
              {totals.unmappedCount}{" "}
              {totals.unmappedCount === 1 ? "client has" : "clients have"} no fee rate configured
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Their share shows as ₹0 because no rate has been set — not because none is due.
              Contact{" "}
              <a
                href="mailto:investor.relations@qodeinvest.com"
                className="underline underline-offset-2"
              >
                investor.relations@qodeinvest.com
              </a>{" "}
              to have these confirmed.
            </p>
          </div>
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────────────────── */}
      {!busy && rows.length > 0 && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client or account code"
            aria-label="Search clients"
            className="w-full rounded-md border border-border/20 bg-card pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
          />
        </div>
      )}

      {/* ── States ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm font-bold text-destructive">We couldn&apos;t load your fees.</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error}. Please refresh, or contact{" "}
            <a
              href="mailto:investor.relations@qodeinvest.com"
              className="underline underline-offset-2"
            >
              investor.relations@qodeinvest.com
            </a>
            .
          </p>
        </div>
      )}

      {busy && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[68px] rounded-xl" />
          ))}
        </div>
      )}

      {!busy && !error && rows.length === 0 && (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-12 text-center">
          <p className="font-serif text-lg text-foreground">No fees in this period</p>
          <p className="text-sm text-muted-foreground mt-1.5">
            No fees were billed to your clients between {selectedPeriod?.startDate} and{" "}
            {selectedPeriod?.endDate}. Try an earlier period.
          </p>
        </div>
      )}

      {!busy && rows.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-foreground">No client matches &ldquo;{search}&rdquo;.</p>
          <button
            onClick={() => setSearch("")}
            className="text-sm font-bold text-primary dark:text-primary-foreground underline underline-offset-4 mt-2 min-h-[44px]"
          >
            Clear search
          </button>
        </div>
      )}

      {/* ── Client list ────────────────────────────────────────────────── */}
      {!busy && filtered.length > 0 && (
        <div className="flex flex-col gap-2">
          {filtered.map((c) => (
            <ClientCard
              key={c.key}
              client={c}
              open={expanded.has(c.key)}
              onToggle={() => toggle(c.key)}
            />
          ))}
        </div>
      )}

      {/* ── Billing note ───────────────────────────────────────────────── */}
      {!busy && rows.length > 0 && (
        <div className="rounded-xl border-l-2 border-primary-foreground bg-card/60 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-bold text-foreground">Raising an invoice:</span> fixed fees are
            charged quarterly and performance fees annually. Invoice for the share shown above.
            Figures are GST-exclusive unless stated.
          </p>
        </div>
      )}
    </div>
  );
}

// --- Components ---

/**
 * A right-aligned numeric cell.
 *
 * Zero renders muted: a column of ₹0.00 in full-strength text draws the eye to
 * the values that carry the least information.
 */
function Num({ value, muted }: { value: string; muted?: boolean }) {
  const isZero = num(value) === 0;
  return (
    <span
      className={`text-sm tabular-nums text-right ${
        muted || isZero ? "text-muted-foreground" : "text-foreground"
      }`}
    >
      {value}
    </span>
  );
}

function Metric({
  label,
  value,
  context,
}: {
  label: string;
  value: string;
  context?: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-bold tracking-[0.11em] uppercase text-muted-foreground">
        {label}
      </div>
      <div className="text-base font-bold mt-1 tabular-nums text-foreground">{value}</div>
      {context && (
        <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">{context}</div>
      )}
    </div>
  );
}

function ClientCard({
  client,
  open,
  onToggle,
}: {
  client: ClientGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const feeTerms = parseBillgroupFees(client.accounts[0]?.billgroup);

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
          <div className="text-sm font-bold text-foreground truncate flex items-center gap-2">
            {client.clientName}
            {client.unmapped && (
              <span className="text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-[#9a6b12]/15 text-[#9a6b12] dark:text-[#e0b558] shrink-0">
                No rate
              </span>
            )}
          </div>
          {/* Name the strategies rather than showing anonymous dots — three
              grey squares tell a distributor nothing about what the client
              actually holds. */}
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 flex-wrap">
              {client.accounts.map((a) => (
                <span
                  key={a.accountcode ?? a.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: schemeColour(a.strategy, a.accountcode) }}
                    aria-hidden
                  />
                  {String(a.strategy ?? a.accountcode ?? "").slice(0, 3).toUpperCase()}
                </span>
              ))}
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{inrCompact(client.aum)} AUM</span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-foreground tabular-nums whitespace-nowrap">
            {inrCompact(client.share)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">
            {client.unmapped ? "no rate set" : "your share"}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/15 bg-background/40">
          {/* Client's own fee terms — context for where the fees came from.
              Discrete labelled values rather than a sentence: a sentence
              reflows unpredictably at narrow widths, where these simply wrap
              between items and stay readable. */}
          {feeTerms && (
            <div className="px-4 sm:px-5 py-2.5 border-b border-border/15 text-xs text-muted-foreground flex gap-x-5 gap-y-1 flex-wrap">
              <span className="whitespace-nowrap">
                Management{" "}
                <span className="text-foreground tabular-nums">{feeTerms.managementFees}</span>
              </span>
              <span className="whitespace-nowrap">
                Performance{" "}
                <span className="text-foreground tabular-nums">{feeTerms.performanceFees}</span>
              </span>
              <span className="whitespace-nowrap">
                Hurdle{" "}
                <span className="text-foreground tabular-nums">{feeTerms.hurdleRate}</span>
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            {/* Fixed column widths, not `auto`. With `auto` each column sized
                to its own content, so the numeric columns bunched against the
                right edge and never aligned between one client card and the
                next. Fixed widths keep every card's columns in the same place. */}
            {/* Every column from the original table is here. The distributor
                rate is NOT repeated per row: it is one slab for the whole
                distributor, so it belongs in the card header, not restated
                identically on every line. */}
            <div className="min-w-[900px]">
              {/* whitespace-nowrap on every header cell: a wrapped label makes
                  the header two lines tall and pushes the columns out of
                  alignment with the rows beneath. */}
              <div className={`${DETAIL_GRID} px-4 sm:px-5 py-2.5 text-[10.5px] font-bold tracking-[0.08em] uppercase text-muted-foreground border-b border-border/15 whitespace-nowrap`}>
                <span>Strategy</span>
                <span className="text-right">Daily Avg AUM</span>
                <span className="text-right">Perf. Fees</span>
                <span className="text-right">Fixed Fees</span>
                <span className="text-right">Total Fees</span>
                <span className="text-right">GST</span>
                <span className="text-right">Total + GST</span>
                <span className="text-right">Distributor %</span>
                <span className="text-right">Your Share</span>
              </div>

              {client.accounts.map((a) => {
                const totalPlusGst = num(a.totalFees) + num(a.totalFeesGst);
                return (
                  <div
                    key={a.accountcode ?? a.id}
                    className={`${DETAIL_GRID} px-4 sm:px-5 py-3 border-b border-border/10 last:border-0 items-center whitespace-nowrap`}
                  >
                    <div className="min-w-0">
                      {/* Strategy name, then the account code beneath.
                          Previously the code appeared twice — once as the
                          "name" and once below — because SCHEME_NAME keys on
                          the 3-letter prefix, not the full account code. */}
                      <div className="text-sm text-foreground flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ background: schemeColour(a.strategy, a.accountcode) }}
                          aria-hidden
                        />
                        <span className="truncate">{schemeName(a.strategy, a.accountcode)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 pl-4 truncate">
                        {a.accountcode}
                        {a.inceptionDate && ` · since ${a.inceptionDate}`}
                      </div>
                    </div>

                    <Num value={a.averageAum} muted />
                    <Num value={a.performanceFees} />
                    <Num value={a.fixedFees} />
                    <Num value={a.totalFees} />
                    <Num value={a.totalFeesGst} muted />
                    <Num value={inr(totalPlusGst)} />

                    {/* The rate that produced the share on this row. Constant
                        across a distributor's rows, but shown per row so the
                        arithmetic is checkable without leaving the table.
                        The source marker sits inline rather than stacked
                        beneath — a second line here makes every row two lines
                        tall for a word that rarely applies. */}
                    <span className="text-sm tabular-nums text-right">
                      {a.rateSource === "unmapped" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="text-foreground">{a.distributorPercentage}%</span>
                          {a.rateSource === "legacy" && (
                            <span
                              className="text-[10px] text-muted-foreground ml-1"
                              title="From the portal's own records — no rate is set in the CRM"
                            >
                              (legacy)
                            </span>
                          )}
                        </>
                      )}
                    </span>

                    <span className="text-sm font-bold tabular-nums text-foreground text-right">
                      {a.distributorShare}
                    </span>
                  </div>
                );
              })}

              {/* Per-client total, so the card header reconciles with its rows.
                  Shown only when there is more than one account — otherwise it
                  just repeats the single row above it. */}
              {client.accounts.length > 1 && (
                <div className={`${DETAIL_GRID} px-4 sm:px-5 py-3 bg-muted/30 items-center border-t border-border/15 whitespace-nowrap`}>
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Total
                  </span>
                  <Num value={inr(client.aum)} muted />
                  <Num value={inr(client.perfFees)} />
                  <Num value={inr(client.fixedFees)} />
                  <Num value={inr(client.totalFees)} />
                  <Num value={inr(client.gst)} muted />
                  <Num value={inr(client.totalFees + client.gst)} />
                  {/* Empty: a percentage does not sum down a column. */}
                  <span aria-hidden />
                  <span className="text-sm font-bold tabular-nums text-foreground text-right">
                    {inr(client.share)}
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
