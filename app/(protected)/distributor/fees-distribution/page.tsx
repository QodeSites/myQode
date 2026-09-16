"use client";

import * as React from "react";
import { ChevronRight, Search, Download, AlertTriangle, FileText } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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

  // ── Rack rate and discount (Part 4 of the fee revamp plan) ──────────────
  // The split is applied to the rack rate — the fee in the signed agreement —
  // and any discount the distributor gave is then deducted from their share
  // alone. Without these fields the table showed a rate and an amount that
  // could not be reconciled: "50%" beside a figure that is not 50% of anything
  // visible on the row.
  /** Total fee per the signed agreement, before any discount. */
  totalRackRateFee?: string;
  /** What the client was actually charged. */
  actualFeeBilled?: string;
  /** Rack minus actual — borne entirely by the distributor. */
  discountAmount?: string;
  hasDiscount?: boolean;
  /** The distributor's % of the rack rate, before the discount is deducted. */
  distributorGrossShare?: string;
  /** Contractual rates. Not on screen — carried for the CSV export. */
  rackFixedFeePct?: number | null;
  rackPerfFeePct?: number | null;
  actualFeeChargedPct?: number | null;
  /**
   * What the distributor earns on this account as a rate on AUM, after their
   * discount. Not displayed — the table shows amounts only — but retained
   * because the CSV export carries it for anyone reconciling in a spreadsheet.
   */
  distributorNetFeePct?: number | null;
  /**
   * The fee structure this account is on, e.g. "1.5% fixed + 15% performance".
   * Shown beneath the strategy name: which of the five structures an investor
   * is on is context for the row, not another column of numbers.
   */
  feeStructureLabel?: string | null;
  hurdlePct?: number | null;

  // ── The three fee columns ───────────────────────────────────────────────
  // Each is one CRM rate times the management fee, so every figure on the row
  // can be reproduced from the row itself.
  /** Distributor_Share_Category × management fee. */
  yourShareOfFee?: string;
  /** Distributor_Net_Fee_Pct × management fee. */
  yourCommission?: string;
  /** Your Share − Your Commission. */
  shareDiscount?: string;
  /** The CRM rates behind the two, for the bracketed sub-lines. */
  shareCategoryPct?: number | null;
  /** Commission as a % of the fee — internal, not displayed. */
  netFeePct?: number | null;
  /** The CRM net-fee rate verbatim — this is what is shown in brackets. */
  netFeePctOfAum?: number | null;
  /** Whether that rate is the management or performance one. */
  netFeePctBasis?: "management" | "performance";
  /** This client is on a no-fee arrangement — no fee is ever charged. */
  isZeroFee?: boolean;
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
  /** Fee per the signed agreement, before any discount. */
  rackFee: number;
  /** Discount this client received, borne by the distributor. */
  discount: number;
  /** Share of the rack fee before the discount is deducted. */
  grossShare: number;
  /** Distributor_Share_Category × management fee, summed. */
  shareOfFee: number;
  /** Distributor_Net_Fee_Pct × management fee, summed. */
  commission: number;
  /** shareOfFee − commission. */
  shareDiscount: number;
  /** True when no account for this client has a configured rate. */
  unmapped: boolean;
};

type Period = {
  type: "Quarter" | "Year" | "Since Inception";
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

/** Matches the rate the calculator uses when splitting fees. */
const GST_RATE = 18;

const num = (s: string | undefined) => parseFloat(String(s ?? "").replace(/,/g, "")) || 0;

/**
 * What the distributor is actually paid on a row.
 *
 * `yourCommission` is the discount-aware figure from the fee engine and is
 * correct wherever it is present. The deployed calculator predates that engine
 * and sends only `distributorShare`, so this falls back to it rather than
 * reading zero — which is what made every figure on the page ₹0.00 while the
 * API was returning real money.
 *
 * The two differ only when a rack rate and a discount are on file; where they
 * are not, `distributorShare` IS the commission.
 */
const commissionOf = (row: { yourCommission?: string; distributorShare?: string }) =>
  row.yourCommission != null ? num(row.yourCommission) : num(row.distributorShare);

const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "09 Apr 2026" — the portal's date format.
 *
 * Parsed with an explicit T00:00:00 so the browser reads the ISO date in local
 * time rather than UTC; without it, `new Date("2026-04-09")` is midnight UTC,
 * which is still 08 April in any timezone west of Greenwich and would show the
 * wrong day.
 */
const displayDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

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
// Column widths are set by the two-line headers ("(your % of the fee)"), not
// by the numbers — the sub-labels are the widest content in each column.
const DETAIL_GRID =
  "grid grid-cols-[minmax(190px,1.2fr)_125px_130px_130px_140px_145px_130px] gap-4";

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
        // Default to the CURRENT financial year.
        //
        // This used to open on the latest completed quarter, which broke on
        // 1 July: only completed quarters are listed, so the newest became
        // Q1 FY2027 (Apr-Jun) — a quarter with no fees for some partners, who
        // then saw an empty page and assumed their fees had disappeared. The
        // fees were there the whole time under FY 2027 and Since inception.
        //
        // The financial year always contains the quarter in progress, so it
        // shows current earnings rather than a window that has closed. The
        // latest quarter remains one click away in the dropdown.
        //
        // suggestedPeriod is the quarter containing the distributor's first
        // inception date — useful for finding when a relationship began, but
        // the oldest thing in the list, so it stays a later fallback.
        const currentFy = [...obj.periods]
          .reverse()
          .find((p) => p.type === "Year");
        const latestQuarter = [...obj.periods]
          .reverse()
          .find((p) => p.type === "Quarter");
        const initPeriod =
          currentFy ??
          latestQuarter ??
          obj.suggestedPeriod ??
          obj.periods[obj.periods.length - 1];
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

  /**
   * Periods split by type and reversed to newest-first.
   *
   * The API returns quarters oldest-first followed by financial years — one
   * flat list of ~12 items where the most recent completed quarter, which is
   * what a distributor opens this page to see, sat ninth.
   */
  const orderedPeriods = React.useMemo(() => {
    const all = periodsData?.periods ?? [];
    const quarters = all.filter((p) => p.type === "Quarter").slice().reverse();
    const years = all.filter((p) => p.type === "Year").slice().reverse();
    // Since inception is its own group of one — it is not a sibling of any
    // quarter or year, so stepping must never land on or leave it.
    const sinceInception = all.find((p) => p.type === "Since Inception") ?? null;
    return {
      quarters,
      years,
      sinceInception,
      all: [...quarters, ...years, ...(sinceInception ? [sinceInception] : [])],
    };
  }, [periodsData]);

  /**
   * Moves through the current period's own group, newest-first.
   *
   * Direction is +1 for earlier and -1 for later, matching the reading order
   * of the arrows rather than the array index. Stepping stays within quarters
   * or within years — stepping from a quarter into a financial year would
   * change the kind of thing being compared.
   */
  const periodSiblings = React.useCallback(() => {
    if (!selectedPeriod) return [] as Period[];
    // Since inception spans everything, so it has nothing to step to. Returning
    // an empty list disables both arrows rather than stepping into the years.
    if (selectedPeriod.type === "Since Inception") return [] as Period[];
    return selectedPeriod.type === "Quarter" ? orderedPeriods.quarters : orderedPeriods.years;
  }, [selectedPeriod, orderedPeriods]);

  const canStep = (dir: 1 | -1) => {
    const list = periodSiblings();
    const i = list.findIndex((p) => p.label === selectedPeriodLabel);
    return i >= 0 && i + dir >= 0 && i + dir < list.length;
  };

  const stepPeriod = (dir: 1 | -1) => {
    const list = periodSiblings();
    const i = list.findIndex((p) => p.label === selectedPeriodLabel);
    const next = list[i + dir];
    if (next) setSelectedPeriodLabel(next.label);
  };

  React.useEffect(() => {
    if (!selectedPeriod) return;
    const fetchRows = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/distributor/calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `period` drives the pro-rating of annual rack rates. It was never
          // being sent, so every period — including full financial years —
          // fell back to a quarter's 0.25.
          body: JSON.stringify({
            startDate: selectedPeriod.startDate,
            endDate: selectedPeriod.endDate,
            period: selectedPeriod.label,
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
            distributorShareCategory: r.distributorShareCategory,
            rateSource: r.rateSource,
            accountcode: r.accountcode,
            billgroup: r.billGroup,
            totalRackRateFee: r.totalRackRateFee,
            actualFeeBilled: r.actualFeeBilled,
            discountAmount: r.discountAmount,
            hasDiscount: r.hasDiscount,
            distributorGrossShare: r.distributorGrossShare,
            rackFixedFeePct: r.rackFixedFeePct,
            rackPerfFeePct: r.rackPerfFeePct,
            actualFeeChargedPct: r.actualFeeChargedPct,
            distributorNetFeePct: r.distributorNetFeePct,
            feeStructureLabel: r.feeStructureLabel,
            hurdlePct: r.hurdlePct,
            yourShareOfFee: r.yourShareOfFee,
            yourCommission: r.yourCommission,
            shareDiscount: r.shareDiscount,
            shareCategoryPct: r.shareCategoryPct,
            netFeePct: r.netFeePct,
            netFeePctOfAum: r.netFeePctOfAum,
            netFeePctBasis: r.netFeePctBasis,
            isZeroFee: r.isZeroFee,
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
          rackFee: 0,
          discount: 0,
          grossShare: 0,
          shareOfFee: 0,
          commission: 0,
          shareDiscount: 0,
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
      // What the distributor is actually paid, plus GST.
      //
      // Prefer `yourCommission` — NOT `distributorShare`, which is the share
      // before the discount is taken off. Summing that made the card header
      // report ₹17,370.12 where the rows added up to ₹6,440.19 + GST, because
      // it was counting money the discount had already given away.
      //
      // But fall back to it when the field is absent. The deployed calculator
      // predates the fee engine and sends only `distributorShare`, so reading
      // `yourCommission` alone made every figure on this page ₹0.00 while the
      // API was returning real money — ₹32,387.59 for Q4 FY2026. Without a
      // rack rate there is no discount to subtract, so the two are equal for
      // exactly the rows where the fallback applies.
      g.share += commissionOf(row) * (1 + GST_RATE / 100);
      // Falls back to the billed fee when the CRM has no rack rate on file, so
      // an account with no agreement recorded reads as "no discount" rather
      // than as a 100% discount.
      g.rackFee += num(row.totalRackRateFee) || num(row.totalFees);
      g.discount += num(row.discountAmount);
      g.grossShare += num(row.distributorGrossShare) || num(row.distributorShare);
      g.shareOfFee += num(row.yourShareOfFee) || num(row.distributorShare);
      g.commission += commissionOf(row);
      g.shareDiscount += num(row.shareDiscount);
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
    // The commission across every account, GST included — what the
    // distributor actually invoices for.
    const share = clients.reduce((s, c) => s + c.share, 0);
    // GST is inside that figure, so extract with 18/118 rather than 18/100.
    // `shareNet` therefore recovers the commission exactly, which is what the
    // breakdown below and the invoice both need.
    const shareGst = (share * GST_RATE) / (100 + GST_RATE);
    const unmappedCount = clients.filter((c) => c.unmapped).length;
    // One rate for the whole distributor. Prefer Zoho's own label ("65%") over
    // the parsed number so the page shows exactly what the CRM shows.
    const first = rows[0];
    const sharePct =
      first?.distributorShareCategory ??
      (first?.distributorPercentage && num(first.distributorPercentage) > 0
        ? `${first.distributorPercentage}%`
        : null);

    const rackFeeTotal = clients.reduce((s, c) => s + c.rackFee, 0);
    const discountTotal = clients.reduce((s, c) => s + c.discount, 0);

    // The fee reduction in percentage points, but only where every discounted
    // account carries the SAME reduction. Where rates differ there is no single
    // true answer, so this stays null and the UI falls back to the effective
    // share — inventing an average would misstate what any client pays.
    const discountedRows = rows.filter(
      (r) =>
        num(r.discountAmount) > 0 &&
        r.rackFixedFeePct != null &&
        r.actualFeeChargedPct != null,
    );
    const reductions = [
      ...new Set(
        discountedRows.map((r) =>
          Number(((r.rackFixedFeePct as number) - (r.actualFeeChargedPct as number)).toFixed(4)),
        ),
      ),
    ];
    const discountRateSpread =
      reductions.length === 1 && discountedRows.length > 0
        ? {
            from: discountedRows[0].rackFixedFeePct as number,
            to: discountedRows[0].actualFeeChargedPct as number,
            points: reductions[0],
          }
        : null;

    // ── The calculation, expressed in rates ───────────────────────────────
    // Each line of the breakdown carries a rate as well as an amount, so a
    // distributor can follow it against their agreement rather than against a
    // rupee total that changes every period. On a 2.5% standard fee at 50/50
    // the entitlement is 1.25% a year, and a discount reduces that figure.
    //
    // Only the distributor's own side is derived here. Qode's share is
    // internal and is deliberately not computed on this page — a value that is
    // never calculated cannot leak into the UI by accident.
    //
    // Weighted by rack fee rather than a plain average, so one large account
    // cannot be outvoted by several small ones.
    const sharePctNum = num(first?.distributorPercentage ?? "");
    const rackRateWeighted =
      rackFeeTotal > 0
        ? rows.reduce((s, r) => {
            const w = num(r.totalRackRateFee) || num(r.totalFees);
            return s + (r.rackFixedFeePct ?? 0) * w;
          }, 0) / rackFeeTotal
        : 0;
    const yourRate = (rackRateWeighted * sharePctNum) / 100;
    // What the discount costs, in the same units, and what is left.
    const discountRate =
      rackFeeTotal > 0 ? (discountTotal / rackFeeTotal) * rackRateWeighted : 0;
    const yourRateAfterDiscount = Math.max(0, yourRate - discountRate);

    return {
      share,
      shareGst,
      shareNet: share - shareGst,
      sharePct,
      aum: clients.reduce((s, c) => s + c.aum, 0),
      fixedFees: clients.reduce((s, c) => s + c.fixedFees, 0),
      perfFees: clients.reduce((s, c) => s + c.perfFees, 0),
      totalFees: clients.reduce((s, c) => s + c.totalFees, 0),
      gst: clients.reduce((s, c) => s + c.gst, 0),
      // Rack fee and the discount deducted from the share. Both are shown only
      // when a discount actually exists — for the majority of distributors,
      // who discount nothing, rack and billed are the same number and an extra
      // column of identical figures would be noise.
      rackFee: clients.reduce((s, c) => s + c.rackFee, 0),
      discount: clients.reduce((s, c) => s + c.discount, 0),
      discountedClients: clients.filter((c) => c.discount > 0).length,
      // ── Expressing the discount as a percentage ────────────────────────
      // A rupee figure with no rate beside it is the number a distributor
      // queries first.
      //
      // discountRateSpread states the fee reduction in the terms it was
      // agreed in ("2.5% → 1.6%"), but ONLY when every discounted client got
      // the same reduction. Of the four distributors currently discounting,
      // two discount at mixed rates (Yash Sejpal gives 0.9, 0.6 and 0.4 points
      // to three different clients), so a single headline rate would be
      // invented for half of them. Null in that case rather than averaged — an
      // average fee rate is not a rate any client is actually charged, and the
      // table falls back to naming the clients instead.
      discountPctOfRack: rackFeeTotal > 0 ? (discountTotal / rackFeeTotal) * 100 : 0,
      discountRateSpread,
      rackRateWeighted,
      yourRate,
      discountRate,
      yourRateAfterDiscount,
      sharePctNum,
      /** Share of the standard fee before the discount is deducted. */
      grossShare: clients.reduce((s, c) => s + c.grossShare, 0),
      // The three figures the table columns show, summed — so the breakdown
      // above reconciles with the rows line for line.
      shareOfFee: clients.reduce((s, c) => s + c.shareOfFee, 0),
      shareDiscount: clients.reduce((s, c) => s + c.shareDiscount, 0),
      commission: clients.reduce((s, c) => s + c.commission, 0),
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
    // The screen shows amounts only; the CSV keeps the rates and the fee
    // structure too. A spreadsheet is where someone reconciles line by line
    // against an agreement, which is exactly the job the rates are needed for
    // — and a column here costs nothing, unlike one on the page.
    const head = [
      "Client", "Account Code", "Strategy", "Inception Date",
      "Fee Structure", "Standard Fixed %", "Standard Performance %", "Hurdle %",
      "Client Assets",
      "Management Fee (before GST)", "Performance Fee (before GST)", "Charged Fixed %",
      "Your %", "Your Share", "Discount", "Your Net Rate % p.a.",
      "Your Commission (before GST)",
      "Rate Source",
    ];
    const lines = [head.join(",")];
    for (const c of clients) {
      for (const a of c.accounts) {
        // Column for column with `head` above, and with the on-screen table:
        // every amount exclusive of GST, ending at the commission.
        lines.push(
          [
            `"${c.clientName}"`,
            a.accountcode ?? "",
            a.strategy ?? "",
            a.inceptionDate ?? "",
            `"${a.feeStructureLabel ?? ""}"`,
            a.rackFixedFeePct ?? "",
            a.rackPerfFeePct ?? "",
            a.hurdlePct ?? "",
            num(a.averageAum).toFixed(2),
            num(a.fixedFees).toFixed(2),
            num(a.performanceFees).toFixed(2),
            a.actualFeeChargedPct ?? "",
            a.distributorPercentage ?? "",
            num(a.yourShareOfFee).toFixed(2),
            num(a.shareDiscount).toFixed(2),
            a.netFeePctOfAum != null ? a.netFeePctOfAum.toFixed(2) : "",
            commissionOf(a).toFixed(2),
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
        <div className="w-full sm:w-80">
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
              {/* Newest first, quarters and years in labelled groups. The API
                  returns 12 flat items oldest-first, which buried the latest
                  completed quarter — the one a distributor almost always
                  wants — at position 9. */}
              <SelectContent className="max-h-[340px]">
                {/* First, above the quarters: "what have I earned in total" is
                    a question the quarter list cannot answer without adding a
                    dozen figures by hand, and burying it below them would make
                    it hard to find. */}
                {orderedPeriods.sinceInception && (
                  <SelectGroup>
                    <SelectLabel className="text-[10.5px] tracking-[0.1em] uppercase">
                      All time
                    </SelectLabel>
                    <SelectItem value={orderedPeriods.sinceInception.label}>
                      {orderedPeriods.sinceInception.label}
                      <span className="text-muted-foreground">
                        {" "}
                        · {orderedPeriods.sinceInception.startDate} –{" "}
                        {orderedPeriods.sinceInception.endDate}
                      </span>
                    </SelectItem>
                  </SelectGroup>
                )}
                {orderedPeriods.quarters.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-[10.5px] tracking-[0.1em] uppercase">
                      Quarters
                    </SelectLabel>
                    {orderedPeriods.quarters.map((p, i) => (
                      <SelectItem key={p.label} value={p.label}>
                        {p.label}
                        {i === 0 && (
                          <span className="text-muted-foreground"> · latest</span>
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          · {p.startDate} – {p.endDate}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {orderedPeriods.years.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-[10.5px] tracking-[0.1em] uppercase">
                      Financial years
                    </SelectLabel>
                    {orderedPeriods.years.map((p) => (
                      <SelectItem key={p.label} value={p.label}>
                        {p.label}
                        <span className="text-muted-foreground">
                          {" "}
                          · {p.startDate} – {p.endDate}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          ) : null}

          {/* Step through consecutive quarters without opening the dropdown —
              comparing one quarter to the last is the common second action. */}
          {!periodsLoading && orderedPeriods.all.length > 1 && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => stepPeriod(1)}
                disabled={!canStep(1)}
                className="flex-1 text-xs font-bold rounded-md border border-border/25 px-3 py-2 min-h-[36px] text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-all"
              >
                ← Earlier
              </button>
              <button
                onClick={() => stepPeriod(-1)}
                disabled={!canStep(-1)}
                className="flex-1 text-xs font-bold rounded-md border border-border/25 px-3 py-2 min-h-[36px] text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-all"
              >
                Later →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── The answer they came for ───────────────────────────────────── */}
      {busy ? (
        <Skeleton className="h-[132px] rounded-xl" />
      ) : rows.length > 0 ? (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-5">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              {/* The headline is the commission BEFORE GST, so it equals the
                  sum of the Your Commission column exactly. GST is stated
                  separately below rather than folded in — a headline that
                  silently included it never matched any figure in the table. */}
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
                Your commission for {selectedPeriod?.label}
              </div>
              <div className="text-[2.5rem] font-bold leading-none mt-2 tabular-nums tracking-tight text-foreground">
                {inrCompact(totals.shareNet)}
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 tabular-nums">
                ₹ {inr(totals.shareNet)} · from {totals.clientCount}{" "}
                {totals.clientCount === 1 ? "client" : "clients"}
              </div>
              {/* The rate is one slab for the whole distributor, so it is
                  stated once here rather than repeated on every row. Shown as a
                  pill rather than a line of text: "what percentage do I get?"
                  is the second question every distributor asks after "how
                  much?", and it was previously buried in body copy. */}
              {totals.sharePct && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5">
                  <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-primary-foreground/70">
                    Your revenue share
                  </span>
                  <span className="text-sm font-bold tabular-nums text-primary-foreground">
                    {totals.sharePct}
                  </span>
                </div>
              )}
              {/* Naming the basis matters, and naming it precisely matters more
                  where a discount exists. The percentage is of the RACK RATE —
                  the fee in the signed agreement — and any discount the
                  distributor granted is then deducted from their share. Stating
                  only "your share is 50%" beside a figure reduced by a discount
                  reads as an arithmetic error to anyone who checks it. */}
              {totals.sharePct && (
                <div className="text-xs text-muted-foreground mt-1.5">
                  of the standard fee for your clients
                  {totals.discount > 0 && ", less the discounts you've given"}
                </div>
              )}
              {/* GST stated as an addition, matching the headline above it —
                  which is now the commission before tax. The invoice total is
                  spelled out so a distributor knows what to bill without
                  doing the arithmetic themselves. */}
              {totals.shareNet > 0 && (
                <div className="text-xs text-muted-foreground mt-2 tabular-nums">
                  Plus GST of{" "}
                  <span className="text-foreground font-bold">₹ {inr(totals.shareGst)}</span> —
                  invoice ₹ {inr(totals.share)} in total
                </div>
              )}
            </div>
            {/* Statement is the primary action — it is the document a
                distributor actually attaches to their invoice. CSV stays for
                anyone reconciling in a spreadsheet. */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Raising an invoice is what a distributor comes here to do, so
                  it leads. The statement remains available as the supporting
                  document — it shows the per-client detail an invoice does
                  not. */}
              <a
                href={`/distributor/fees-distribution/invoice?period=${encodeURIComponent(selectedPeriodLabel)}`}
                className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground font-bold text-sm px-4 py-2.5 min-h-[44px] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
              >
                <FileText className="w-4 h-4" aria-hidden />
                Raise invoice
              </a>
              <a
                href={`/distributor/fees-distribution/statement?period=${encodeURIComponent(selectedPeriodLabel)}`}
                className="inline-flex items-center gap-2 rounded-md bg-transparent text-muted-foreground border border-border/25 font-bold text-sm px-4 py-2.5 min-h-[44px] hover:border-primary hover:text-foreground transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
              >
                Fee statement
              </a>
              <button
                onClick={downloadCsv}
                className="inline-flex items-center gap-2 rounded-md bg-transparent text-muted-foreground border border-border/25 font-bold text-sm px-4 py-2.5 min-h-[44px] hover:border-primary hover:text-foreground transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
              >
                <Download className="w-4 h-4" aria-hidden />
                CSV
              </button>
            </div>
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

          {/* ── How the share was arrived at ──────────────────────────────
              Always shown, not only for discounted accounts: it is four lines
              of plain arithmetic on figures that appear elsewhere on the page,
              and a distributor should not have to be discounted to see how
              their number was reached.

              Every amount here is either billed by the portfolio system or a
              straight percentage of one that is. Nothing is derived from a
              rate the distributor cannot see. Qode's side of the split is
              internal and is not on this screen. */}
          {totals.sharePct && (
            <div className="mt-5 pt-5 border-t border-border/15">
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-4">
                How your share was calculated
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[420px]">
                  <tbody>
                    {/* Management and performance stay separate where both were
                        billed: they are charged on different bases and on
                        different cycles, so one combined figure hides which is
                        which. */}
                    {totals.perfFees > 0 ? (
                      <>
                        <CalcRow
                          label="Management fees your clients were charged"
                          sub="charged quarterly on their assets"
                          amount={`₹ ${inr(totals.fixedFees)}`}
                        />
                        <CalcRow
                          label="Performance fees your clients were charged"
                          sub="charged annually on gains above the hurdle"
                          amount={`₹ ${inr(totals.perfFees)}`}
                        />
                      </>
                    ) : (
                      <CalcRow
                        label="Fees your clients were charged"
                        sub="charged quarterly on their assets"
                        amount={`₹ ${inr(totals.totalFees)}`}
                      />
                    )}
                    {/* The same three steps as the table columns, in the same
                        order, so the two reconcile line for line. Share and
                        discount are shown only where a discount exists —
                        otherwise the share and the commission are the same
                        figure and repeating it adds nothing. */}
                    {totals.shareDiscount > 0 ? (
                      <>
                        <CalcRow
                          label={`Your share, ${totals.sharePct} of those fees`}
                          sub="your revenue share, per your agreement with Qode"
                          amount={`₹ ${inr(totals.shareOfFee)}`}
                        />
                        <CalcRow
                          label="Less the discount you gave"
                          sub="the lower fee you agreed with your clients"
                          amount={`− ₹ ${inr(totals.shareDiscount)}`}
                          negative
                        />
                        <CalcRow
                          label="Your commission"
                          sub="at your net fee rate in the CRM"
                          amount={`₹ ${inr(totals.shareNet)}`}
                          subtotal
                        />
                      </>
                    ) : (
                      <CalcRow
                        label={`Your commission, ${totals.sharePct} of those fees`}
                        sub="your revenue share, per your agreement with Qode"
                        amount={`₹ ${inr(totals.shareNet)}`}
                        subtotal
                      />
                    )}
                    <CalcRow
                      label={`Plus GST at ${GST_RATE}%`}
                      sub="the statutory rate on your commission"
                      amount={`₹ ${inr(totals.shareGst)}`}
                    />
                    <CalcRow
                      label="Payable to you"
                      sub="invoice this amount in full — GST is already included"
                      amount={`₹ ${inr(totals.share)}`}
                      total
                    />
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
            <span className="font-bold text-foreground">Raising an invoice:</span> management fees
            are charged quarterly and performance fees annually.{" "}
            <span className="text-foreground font-bold">
              The commission shown is before GST — add {GST_RATE}% when you invoice.
            </span>{" "}
            Every figure in the table is exclusive of GST, and the total to invoice is stated at the
            top of the page.
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

/**
 * One line of the "how your share was calculated" table.
 *
 * One label, one amount, and the rate that amount represents.
 *
 * The rate sits directly beneath its own amount rather than in a column of its
 * own: a separate column meant reading across as well as down to follow a
 * single subtraction, while a subscript keeps each pair together and lets the
 * amounts still be read as one clean running total.
 */
function CalcRow({
  label,
  sub,
  amount,
  pct,
  negative,
  subtotal,
  total,
}: {
  label: string;
  /** Where the figure came from — shown small, beneath the label. */
  sub?: string;
  amount: string;
  /** The annual rate this amount represents, shown beneath it. */
  pct?: string;
  negative?: boolean;
  subtotal?: boolean;
  total?: boolean;
}) {
  return (
    <tr
      className={
        total
          ? "border-t-2 border-border/30"
          : subtotal
            ? "border-t border-border/20"
            : "border-b border-border/10"
      }
    >
      <td className={`py-3 pr-4 ${total ? "pt-3.5" : ""}`}>
        <div
          className={`${
            total || subtotal ? "font-bold text-foreground" : "text-foreground"
          } text-sm`}
        >
          {label}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </td>
      <td
        className={`py-3 text-right whitespace-nowrap align-top ${
          total ? "pt-3.5" : ""
        }`}
      >
        <div
          className={`tabular-nums ${
            total ? "text-base font-bold" : subtotal ? "font-bold" : ""
          } ${negative ? "text-destructive" : "text-foreground"}`}
        >
          {amount}
        </div>
        {pct && (
          <div
            className={`text-[11px] tabular-nums mt-0.5 ${
              negative ? "text-destructive/70" : "text-muted-foreground"
            }`}
          >
            ({pct})
          </div>
        )}
      </td>
    </tr>
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
            {inrCompact(client.commission)}
          </div>
          {/* The commission BEFORE GST — the same figure the row's Your
              Commission column shows, so the card header and the row it
              summarises state the same number. GST is added once, at the
              period total, rather than being folded into every card. */}
          <div className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">
            {client.unmapped ? "no rate set" : "your commission"}
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
            {/* Sized to the grid's own declared widths (955px of columns +
                96px of gaps + 40px of padding). Anything smaller lets the
                fixed column widths compress, which knocks the numbers out of
                alignment with their headers — the exact problem the fixed
                widths exist to prevent. */}
            <div className="min-w-[1091px]">
              {/* whitespace-nowrap on every header cell: a wrapped label makes
                  the header two lines tall and pushes the columns out of
                  alignment with the rows beneath. */}
              <div className={`${DETAIL_GRID} px-4 sm:px-5 py-2.5 items-end text-[10.5px] font-bold tracking-[0.08em] uppercase text-muted-foreground border-b border-border/15 whitespace-nowrap`}>
                {/* The columns mirror the summary flow above, in the same
                    order and under the same names: fees charged, your share of
                    them, less your discount, equals what you receive. A
                    distributor who has read the summary already knows how to
                    read this.

                    Fixed and performance fees are no longer split out: their
                    total is the first figure of the flow, and the split is a
                    detail that belongs on the statement, not in the middle of
                    an arithmetic the distributor is trying to follow. */}
                <span>Strategy</span>
                <span className="text-right">Client Assets</span>
                {/* The bracketed figure under each amount is a different kind
                    of percentage per column, so each header says which — an
                    unlabelled "(50%)" beside "(1.65%)" is the ambiguity this
                    is meant to remove. */}
                {/* Management and performance are separate columns, not one
                    "Fees Charged" total. They are charged on different bases
                    (assets vs gains over a hurdle), billed on different cycles
                    (quarterly vs annually), and discounted independently —
                    ₹2.51 crore of performance fees across 109 accounts is too
                    much to fold into a single figure. */}
                {/* "before GST" is stated because the portfolio system stores
                    these GST-INCLUSIVE (₹3,867.31 in the DB is ₹3,277.38 of
                    fee plus ₹589.93 of GST). The fee net of GST is the right
                    basis — the distributor's share is a percentage of the fee,
                    and GST is added back on their own commission at the end,
                    so using the inclusive figure would charge GST twice. But
                    nothing on screen said so, which made the column look like
                    it disagreed with the database. */}
                <span className="text-right">
                  Management Fee
                  <span className="block font-normal normal-case tracking-normal text-[9.5px] text-muted-foreground/70">
                    (before GST)
                  </span>
                </span>
                <span className="text-right">
                  Performance Fee
                  <span className="block font-normal normal-case tracking-normal text-[9.5px] text-muted-foreground/70">
                    (before GST)
                  </span>
                </span>
                {/* Three columns, each one CRM rate times the management fee,
                    so the whole row multiplies out in place. The sub-labels
                    name the exact Zoho field each rate comes from — that is
                    what makes the numbers checkable rather than assertions. */}
                <span className="text-right">
                  Your Share
                  <span className="block font-normal normal-case tracking-normal text-[9.5px] text-muted-foreground/70">
                    (share category × fee)
                  </span>
                </span>
                {/* Discount sits before Commission so the row reads as a
                    running deduction: share, less discount, equals commission.
                    With Commission in the middle the two outer columns were
                    the ones that had to be subtracted, which is the harder
                    thing to see. */}
                <span className="text-right">
                  Discount
                  <span className="block font-normal normal-case tracking-normal text-[9.5px] text-muted-foreground/70">
                    (share − commission)
                  </span>
                </span>
                {/* "before GST" completes the pair: the card header above says
                    "incl. GST", so a reader coming from either direction can
                    see why the two figures differ by 18% rather than assuming
                    one of them is wrong. */}
                <span className="text-right">
                  Your Commission
                  <span className="block font-normal normal-case tracking-normal text-[9.5px] text-muted-foreground/70">
                    (before GST)
                  </span>
                </span>
              </div>

              {client.accounts.map((a) => {
                const discount = num(a.discountAmount);
                const gross = num(a.distributorGrossShare);
                // The fee at the STANDARD rate — what "Your Share" is a
                // percentage of. Equal to the billed fee unless discounted, in
                // which case the two differ and only showing the billed one
                // makes the share look wrong.
                const standardFee = num(a.totalRackRateFee) || num(a.totalFees);
                const isDiscounted = discount > 0 && standardFee > num(a.totalFees);
                return (
                  <div
                    key={a.accountcode ?? a.id}
                    className={`${DETAIL_GRID} px-4 sm:px-5 py-3 border-b border-border/10 last:border-0 items-start whitespace-nowrap`}
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
                      {/* The fee rates are not repeated here: they already sit
                          in brackets under the amounts they produced, and the
                          card header states them once for the whole client.
                          "No fee arrangement" stays — it flags a state the
                          numbers cannot show, rather than restating a rate. */}
                      {a.isZeroFee && (
                        <div className="text-xs text-muted-foreground mt-0.5 pl-4 truncate">
                          No fee arrangement
                        </div>
                      )}
                      {/* Inception matters for reading the row: a fee that
                          looks low is often an account that only opened
                          part-way through the period, and the account code is
                          what a distributor quotes when querying one. */}
                      <div className="text-[11px] text-muted-foreground/80 mt-0.5 pl-4 truncate">
                        {a.accountcode}
                        {a.inceptionDate && ` · opened ${displayDate(a.inceptionDate)}`}
                      </div>
                    </div>

                    <Num value={a.averageAum} muted />

                    {/* A no-fee client has nothing to put in five numeric
                        columns, and five zeros read as a data failure rather
                        than as the arrangement they are. One statement across
                        the columns says the row is complete. */}
                    {a.isZeroFee ? (
                      <span className="col-span-5 text-sm text-muted-foreground text-right italic">
                        No fees charged on this account
                      </span>
                    ) : (
                    <>
                    {/* Management and performance separately, each with the
                        rate that produced it. The management rate is the
                        DISCOUNTED one where a discount applies, since that is
                        what the client was actually charged; performance
                        carries its own rate, which is discounted independently
                        and on this book never has been. */}
                    <span className="text-sm tabular-nums text-right">
                      <span className={num(a.fixedFees) > 0 ? "text-foreground" : "text-muted-foreground"}>
                        {a.fixedFees}
                      </span>
                      {a.actualFeeChargedPct != null && num(a.fixedFees) > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          ({a.actualFeeChargedPct}%)
                        </span>
                      )}
                      {/* The standard rate, where the client pays below it.
                          Context only — the split is taken on the fee actually
                          billed above, so no second rupee figure is shown that
                          the distributor cannot tie to their share. */}
                      {isDiscounted && a.rackFixedFeePct != null && (
                        <span className="block text-[10px] text-muted-foreground/80 mt-0.5">
                          standard {a.rackFixedFeePct}%
                        </span>
                      )}
                    </span>

                    <span className="text-sm tabular-nums text-right">
                      {num(a.performanceFees) > 0 ? (
                        <>
                          <span className="text-foreground">{a.performanceFees}</span>
                          {a.rackPerfFeePct != null && a.rackPerfFeePct > 0 && (
                            <span className="block text-[10px] text-muted-foreground">
                              ({a.rackPerfFeePct}% over {a.hurdlePct ?? 0}%)
                            </span>
                          )}
                        </>
                      ) : (
                        // Not "₹0.00": performance fees are billed annually, so
                        // a zero in a quarter means "not billed this period",
                        // not "earned nothing".
                        <span
                          className="text-muted-foreground"
                          title="Performance fees are billed annually, not every quarter"
                        >
                          —
                        </span>
                      )}
                    </span>

                    {/* Your Share = Distributor_Share_Category × management fee */}
                    <span className="text-sm tabular-nums text-right">
                      {a.rateSource === "unmapped" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="text-foreground">{a.yourShareOfFee}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            ({a.distributorPercentage}%)
                          </span>
                        </>
                      )}
                    </span>

                    {/* Discount = Your Share − Your Commission */}
                    <span className="text-sm tabular-nums text-right">
                      {a.netFeePct != null && num(a.shareDiscount) > 0 ? (
                        <span className="text-destructive">− {a.shareDiscount}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>

                    {/* Your Commission — the bracketed figure is
                        `Distributor_Net_Fee_Pct` exactly as it appears on the
                        investor's CRM record, so it can be checked against
                        Zoho directly. The internal conversion to a share of
                        the fee is not shown: a derived percentage that appears
                        in no system is untraceable to anyone reading the row. */}
                    {/* The amount is always shown. Where the CRM has no net
                        fee rate the commission falls back to the share
                        category — a real figure that the total row and the
                        card header both already counted — so rendering a dash
                        here made the rows disagree with their own total. Only
                        the bracketed rate is omitted, since that one genuinely
                        does not exist. */}
                    <span className="text-sm font-bold tabular-nums text-right">
                      <span className="text-foreground">
                        {a.yourCommission ?? a.distributorShare}
                      </span>
                      {a.netFeePctOfAum != null && (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          ({a.netFeePctOfAum}%
                          {a.netFeePctBasis === "performance" ? " of gains" : " p.a."})
                        </span>
                      )}
                    </span>
                    </>
                    )}
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
                  <Num value={inr(client.fixedFees)} />
                  <Num value={inr(client.perfFees)} />
                  <Num value={inr(client.shareOfFee)} />
                  <span className="text-sm tabular-nums text-right">
                    {client.shareDiscount > 0 ? (
                      <span className="text-destructive">− {inr(client.shareDiscount)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-foreground text-right">
                    {inr(client.commission)}
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
