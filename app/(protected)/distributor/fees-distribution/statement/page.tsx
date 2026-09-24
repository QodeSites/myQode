"use client";

// Distributor fee statement — printable to PDF via the browser.
//
// WHAT THIS IS, AND IS NOT
// This is a statement of fees earned, issued by Qode. It is NOT a GST tax
// invoice: a compliant tax invoice needs the distributor's GSTIN, registered
// address, place of supply and a sequential invoice number, and none of that
// exists in our data (1 of 15 distributors has even a PAN, and there is no
// GSTIN column). Producing a document that looked like a tax invoice without
// those fields would be worse than useless — it would be filed and rejected.
//
// So this document does the job it can do honestly: it tells the distributor
// exactly what they earned and how it was calculated, for them to attach to
// their own invoice. The disclaimer at the foot says so explicitly.
//
// Printed via window.print() rather than a PDF library: no dependency, no
// server cost, and the distributor gets a preview before saving.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { amountInWords } from "@/lib/amountInWords";

type CalculatorRow = {
  id: number;
  clientName: string;
  strategy: string;
  averageAum: string;
  performanceFees: string;
  fixedFees: string;
  totalFees: string;
  totalFeesGst: string;
  distributorPercentage: string;
  distributorShare: string;
  distributorShareCategory?: string | null;
  rateSource?: "zoho" | "legacy" | "unmapped";
  accountcode?: string;
  /** Fee per the signed agreement, before any discount — the base the share
   *  percentage applies to. See lib/feeEngine.ts. */
  totalRackRateFee?: string;
  /** Standard fee minus fee charged; borne entirely by the distributor. */
  discountAmount?: string;
  /** Share of the standard fee before the discount is deducted. */
  distributorGrossShare?: string;
};

type Period = { type: "Quarter" | "Year"; label: string; startDate: string; endDate: string };
type PeriodApiResponse = { periods: Period[]; suggestedPeriod: Period | null };

/** Matches the GST rate the calculator applies when splitting fees. */
const GST_RATE = 18;

const num = (s: string | undefined) => parseFloat(String(s ?? "").replace(/,/g, "")) || 0;
const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A stable reference for this statement — period + distributor, not a
 *  sequential invoice number (which this document deliberately is not). */
function statementRef(period: string, distributor: string): string {
  const initials = distributor
    .replace(/[^a-zA-Z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
  return `QFS-${period.replace(/\s+/g, "")}-${initials || "DST"}`;
}

/**
 * One line of the statement's calculation table.
 *
 * Amounts carry no currency symbol per line — the statement states the
 * currency once, and a column of repeated symbols is noise on a printed page.
 */
function StatementCalcRow({
  label,
  sub,
  amount,
  subtotal,
  total,
}: {
  label: string;
  /** Where the figure came from, where that is not obvious from the label. */
  sub?: string;
  amount: string;
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
      <td className="py-2 pr-4">
        <div className={total || subtotal ? "font-bold text-foreground" : "text-foreground"}>
          {label}
        </div>
        {sub && <div className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</div>}
      </td>
      {/* The minus sign belongs outside the currency symbol — "− ₹ 3,416.80",
          not "₹ − 3,416.80". Callers pass the sign on the amount, so it is
          moved here rather than pushed onto every call site. */}
      <td
        className={`py-2 text-right tabular-nums whitespace-nowrap ${
          total ? "text-sm font-bold" : subtotal ? "font-bold" : ""
        } text-foreground`}
      >
        {amount.startsWith("−") ? `− ₹ ${amount.replace(/^−\s*/, "")}` : `₹ ${amount}`}
      </td>
    </tr>
  );
}

export default function FeeStatementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");

  const [rows, setRows] = React.useState<CalculatorRow[]>([]);
  const [period, setPeriod] = React.useState<Period | null>(null);
  const [distributor, setDistributor] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const pRes = await fetch("/api/distributor/calculator", {
          headers: { Accept: "application/json" },
        });
        if (!pRes.ok) throw new Error(`Could not load periods (${pRes.status})`);
        const pData = (await pRes.json()) as PeriodApiResponse;

        const chosen =
          pData.periods.find((p) => p.label === periodParam) ??
          pData.suggestedPeriod ??
          pData.periods[0];
        if (!chosen) throw new Error("No periods available");
        setPeriod(chosen);

        const res = await fetch("/api/distributor/calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `period` drives rack-rate pro-rating; without it every period was
          // treated as a quarter.
          body: JSON.stringify({
            startDate: chosen.startDate,
            endDate: chosen.endDate,
            period: chosen.label,
          }),
        });
        if (!res.ok) throw new Error(`Could not load fees (${res.status})`);
        setRows((await res.json()) as CalculatorRow[]);
      } catch (e: any) {
        setError(e.message || "Could not load the statement");
      }
      setLoading(false);
    };
    load();
  }, [periodParam]);

  React.useEffect(() => {
    // The distributor's own name isn't in the fee payload, so read it from the
    // session cookie the portal already sets.
    try {
      const raw = document.cookie
        .split("; ")
        .find((c) => c.startsWith("qode-user-context="))
        ?.split("=")[1];
      if (raw) {
        const ctx = JSON.parse(decodeURIComponent(raw));
        setDistributor(ctx.clientname || ctx.name || ctx.email || "");
      }
    } catch {
      /* falls back to an empty name — the statement still prints */
    }
  }, []);

  /** One line per client, since a client with three strategies is one
   *  relationship, not three, on a statement of what is owed. */
  const clients = React.useMemo(() => {
    const byName = new Map<
      string,
      {
        name: string; accounts: number; aum: number; fixed: number; perf: number;
        fees: number; share: number;
        /** Fee per the signed agreement — the base the percentage applies to. */
        rack: number;
        /** Discount given to this client, borne by the distributor. */
        discount: number;
        /** Share of the standard fee before the discount is deducted. */
        grossShare: number;
      }
    >();
    for (const r of rows) {
      const key = r.clientName.trim().toLowerCase().replace(/\s+/g, " ");
      const g = byName.get(key) ?? {
        name: r.clientName, accounts: 0, aum: 0, fixed: 0, perf: 0, fees: 0, share: 0,
        rack: 0, discount: 0, grossShare: 0,
      };
      g.accounts += 1;
      g.aum += num(r.averageAum);
      g.fixed += num(r.fixedFees);
      g.perf += num(r.performanceFees);
      g.fees += num(r.totalFees);
      g.share += num(r.distributorShare);
      // The rack rate is the base the percentage applies to. Falls back to the
      // billed fee where no agreement is on file, so a missing rate reads as
      // "no discount" rather than as a 100% discount.
      g.rack += num(r.totalRackRateFee) || num(r.totalFees);
      g.discount += num(r.discountAmount);
      g.grossShare += num(r.distributorGrossShare);
      byName.set(key, g);
    }
    return [...byName.values()].sort((a, b) => b.share - a.share);
  }, [rows]);

  const totals = React.useMemo(() => {
    const first = rows[0];
    const share = clients.reduce((s, c) => s + c.share, 0);

    // `distributorShare` arrives GST-INCLUSIVE from the calculator API: the
    // split is applied to the GST-exclusive rack fee and the distributor's own
    // GST is added on top. Extracting the embedded portion (18/118, not
    // 18/100) lets the statement spell out the split, so a distributor can see
    // the net and tax components rather than assuming the figure is net and
    // adding tax again.
    const shareGst = (share * GST_RATE) / (100 + GST_RATE);
    const rackTotal = clients.reduce((s, c) => s + c.rack, 0);
    const discountTotal = clients.reduce((s, c) => s + c.discount, 0);

    return {
      aum: clients.reduce((s, c) => s + c.aum, 0),
      fixed: clients.reduce((s, c) => s + c.fixed, 0),
      perf: clients.reduce((s, c) => s + c.perf, 0),
      fees: clients.reduce((s, c) => s + c.fees, 0),
      // The base the percentage is applied to, and what was deducted from the
      // resulting share. Quoting the billed fee as the base instead does not
      // reconcile for a distributor who has discounted.
      rack: clients.reduce((s, c) => s + c.rack, 0),
      discount: clients.reduce((s, c) => s + c.discount, 0),
      // The discount as a share of the standard fee. Stated as a percentage
      // because a bare rupee figure on an invoicing document is the line most
      // likely to be queried. Deliberately NOT expressed as a fee reduction
      // ("2.5% → 1.6%") here: a statement can span clients discounted at
      // different rates, and a single headline rate would be untrue for them.
      discountPctOfRack: rackTotal > 0 ? (discountTotal / rackTotal) * 100 : 0,
      // The share BEFORE the discount is deducted — the line the discount is
      // taken from, so the table shows what it came out of rather than leaving
      // it to be inferred.
      grossShare: clients.reduce((s, c) => s + c.grossShare, 0),
      share,
      shareGst,
      shareNet: share - shareGst,
      ratePct: first?.distributorShareCategory ?? (first ? `${first.distributorPercentage}%` : "—"),
      unmapped: rows.some((r) => r.rateSource === "unmapped"),
      isLegacyRate: rows.some((r) => r.rateSource === "legacy"),
    };
  }, [clients, rows]);

  const issuedOn = new Date().toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

  if (loading) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Preparing your statement…</div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm font-bold text-destructive">We couldn&apos;t prepare the statement.</p>
        <p className="text-sm text-muted-foreground mt-1">
          {error}. Please go back and try again, or contact{" "}
          <a href="mailto:investor.relations@qodeinvest.com" className="underline underline-offset-2">
            investor.relations@qodeinvest.com
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Print rules. `print:hidden` removes the portal chrome so the printed
          page is only the statement; @page sets a sane margin and A4 size. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          html, body { background: #fff !important; }
          nav, aside, header, footer, .no-print { display: none !important; }
          .statement-sheet {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            max-width: none !important;
          }
          .statement-row { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      {/* Screen-only controls */}
      <div className="no-print flex items-center justify-between gap-3 mb-5 flex-wrap">
        <button
          onClick={() => router.push("/distributor/fees-distribution")}
          className="inline-flex items-center gap-2 text-sm font-bold text-primary dark:text-primary-foreground underline underline-offset-4 min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Back to fees
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {/* This document is not a tax invoice, so the route to one belongs
              here — a distributor who came looking for something to invoice
              from should not have to go back to find it. */}
          <a
            href={`/distributor/fees-distribution/invoice?period=${encodeURIComponent(period?.label ?? "")}`}
            className="inline-flex items-center gap-2 rounded-md border border-border/25 text-muted-foreground font-bold text-sm px-4 py-2.5 min-h-[44px] hover:border-primary hover:text-foreground transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
          >
            Raise invoice
          </a>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground font-bold text-sm px-4 py-2.5 min-h-[44px] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
          >
            <Printer className="w-4 h-4" aria-hidden />
            Save as PDF
          </button>
        </div>
      </div>

      <div className="no-print text-xs text-muted-foreground mb-4">
        Choose <strong>Save as PDF</strong> as the destination in the print dialog. This statement
        is not a tax invoice — use <strong>Raise invoice</strong> to generate one.
      </div>

      {/* ── The statement ─────────────────────────────────────────────── */}
      <div className="statement-sheet bg-card border border-border/20 rounded-xl shadow-sm p-8 sm:p-10 max-w-[820px] mx-auto text-foreground">
        <div className="flex items-start justify-between gap-6 flex-wrap pb-5 border-b border-border/25">
          <div>
            <div className="font-serif text-xl">Qode Advisors LLP</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
              SEBI Registered Portfolio Manager · INP000008914
              <br />
              Mumbai, India
              <br />
              investor.relations@qodeinvest.com
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
              Distributor Fee Statement
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
              Ref {statementRef(period?.label ?? "", distributor)}
              <br />
              Issued {issuedOn}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 py-5 border-b border-border/25">
          <div>
            <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
              Statement for
            </div>
            <div className="text-sm font-bold mt-1.5">{distributor || "—"}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
              Period
            </div>
            <div className="text-sm mt-1.5">
              {period?.label}
              <span className="text-muted-foreground">
                {" "}
                · {period?.startDate} – {period?.endDate}
              </span>
            </div>
          </div>
        </div>

        {/* Headline amount.
            This figure includes the distributor's GST. Saying so once in small
            print is not enough: a distributor who assumes otherwise adds 18% on
            top and over-invoices by that amount every period. It is stated in
            the label, restated beneath the figure, and broken down explicitly
            below. */}
        <div className="py-5 border-b border-border/25">
          <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
            Total payable to you — inclusive of GST
          </div>
          <div className="text-[2rem] font-bold tabular-nums mt-1.5 tracking-tight">
            ₹ {inr(totals.share)}
          </div>
          <div className="text-xs text-muted-foreground mt-1.5 italic">
            {amountInWords(totals.share)}
          </div>

          <div className="mt-3 rounded-md border border-[#9a6b12]/35 bg-[#9a6b12]/5 px-3.5 py-2.5">
            <div className="text-xs font-bold text-foreground">
              This amount already includes GST. Do not add GST on top.
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 tabular-nums leading-relaxed">
              Invoice Qode Advisors LLP for{" "}
              <span className="text-foreground font-bold">₹ {inr(totals.share)}</span> in total —
              shown on your invoice as{" "}
              <span className="text-foreground font-bold">₹ {inr(totals.shareNet)}</span> plus GST
              of <span className="text-foreground font-bold">₹ {inr(totals.shareGst)}</span>.
            </div>
          </div>

          {/* The calculation, line by line, so every figure on the statement
              can be checked against the agreement it came from. The percentage
              applies to the STANDARD fee in the client's agreement, not to the
              discounted fee actually billed — quoting the billed fee as the
              base does not multiply out to the total for anyone who has
              discounted, and reads as an error.

              Shown as a table rather than a sentence: this is the figure a
              distributor reconciles before invoicing, and a run-on sentence is
              the wrong shape for arithmetic. The discount rows appear only
              where there is a discount, since otherwise standard and billed
              are the same number. */}
          <div className="mt-4">
            <table className="w-full text-xs border-collapse">
              <tbody>
                <StatementCalcRow
                  label="Standard fees for your clients"
                  amount={inr(totals.rack)}
                />
                <StatementCalcRow
                  label={`Your share at ${totals.ratePct}`}
                  amount={inr(totals.grossShare)}
                />
                {totals.discount > 0 && (
                  <StatementCalcRow
                    label="Less: the discount you agreed with your clients"
                    sub={`${totals.discountPctOfRack.toFixed(1)}% of the standard fee — funded from your share`}
                    amount={`− ${inr(totals.discount)}`}
                  />
                )}
                <StatementCalcRow
                  label="Your share for the period"
                  amount={inr(totals.shareNet)}
                  subtotal
                />
                <StatementCalcRow label={`Add: GST at ${GST_RATE}%`} amount={inr(totals.shareGst)} />
                <StatementCalcRow
                  label="Payable to you"
                  amount={inr(totals.share)}
                  total
                />
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-client breakdown */}
        <div className="py-5">
          <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-3">
            Breakdown by client
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[520px]">
              <thead>
                <tr className="border-b border-border/25">
                  <th className="text-left font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                    Client
                  </th>
                  <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                    Avg AUM
                  </th>
                  <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                    Fixed Fees
                  </th>
                  <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                    Perf. Fees
                  </th>
                  {/* The base the percentage applies to. Shown only where a
                      discount exists — otherwise it is identical to Total Fees
                      and adds a column of duplicate figures to a printed page. */}
                  {totals.discount > 0 && (
                    <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                      Standard Fee
                    </th>
                  )}
                  <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                    {totals.discount > 0 ? "Fee Charged" : "Total Fees"}
                  </th>
                  {totals.discount > 0 && (
                    <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                      Your Discount
                    </th>
                  )}
                  {/* The rate is in the header rather than a column: it is one
                      slab for the whole distributor, so a per-row copy would
                      repeat the same number down the page. Named "of standard
                      fee" because that is the base — labelling it just "65%"
                      beside a discounted amount is the ambiguity this change
                      exists to remove. */}
                  <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                    You Receive (incl. GST)
                    <span className="block font-normal normal-case tracking-normal text-[9.5px]">
                      {totals.ratePct} of standard fee
                      {totals.discount > 0 && ", less your discount"}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.name} className="statement-row border-b border-border/10">
                    <td className="py-2.5 pr-3">
                      {c.name}
                      {c.accounts > 1 && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {" "}
                          · {c.accounts} accounts
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">{inr(c.aum)}</td>
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">{inr(c.fixed)}</td>
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">{inr(c.perf)}</td>
                    {totals.discount > 0 && (
                      <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                        {inr(c.rack)}
                      </td>
                    )}
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">{inr(c.fees)}</td>
                    {totals.discount > 0 && (
                      <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                        {c.discount > 0 ? `− ${inr(c.discount)}` : "—"}
                      </td>
                    )}
                    <td className="py-2.5 text-right tabular-nums font-bold whitespace-nowrap">
                      {inr(c.share)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border/30 font-bold">
                  <td className="py-3 pr-3">Total</td>
                  <td className="py-3 text-right tabular-nums whitespace-nowrap">{inr(totals.aum)}</td>
                  <td className="py-3 text-right tabular-nums whitespace-nowrap">{inr(totals.fixed)}</td>
                  <td className="py-3 text-right tabular-nums whitespace-nowrap">{inr(totals.perf)}</td>
                  {totals.discount > 0 && (
                    <td className="py-3 text-right tabular-nums whitespace-nowrap">
                      {inr(totals.rack)}
                    </td>
                  )}
                  <td className="py-3 text-right tabular-nums whitespace-nowrap">{inr(totals.fees)}</td>
                  {totals.discount > 0 && (
                    <td className="py-3 text-right tabular-nums whitespace-nowrap">
                      − {inr(totals.discount)}
                    </td>
                  )}
                  <td className="py-3 text-right tabular-nums whitespace-nowrap">{inr(totals.share)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Warnings that must survive into the printed copy — a distributor
            invoicing from an incomplete statement is the failure this
            prevents. */}
        {totals.unmapped && (
          <div className="text-xs border-l-2 border-[#9a6b12] pl-3 py-2 mb-3 text-muted-foreground">
            <strong className="text-foreground">Some clients are not included.</strong> One or more
            clients have no fee share configured, so no amount is shown against them. Contact
            investor.relations@qodeinvest.com before invoicing.
          </div>
        )}

        {totals.isLegacyRate && (
          <div className="text-xs border-l-2 border-[#9a6b12] pl-3 py-2 mb-3 text-muted-foreground">
            <strong className="text-foreground">Provisional rate.</strong> This statement uses a
            share rate held in our portal records rather than a confirmed CRM rate. Please confirm
            before invoicing.
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border/25 pt-4 leading-relaxed">
          <strong className="text-foreground">This is not a tax invoice.</strong> It is a statement
          of fees earned, issued for your records. Please raise your own invoice on Qode Advisors
          LLP for the total shown above.
          <br />
          <br />
          {/* Precise about WHICH amounts carry GST. The blanket claim that
              every figure was GST-inclusive was not true of the fee columns,
              which are shown net with GST in its own column — and on a document
              used to raise an invoice, an inaccurate GST statement is the kind
              of error that produces an inaccurate invoice. */}
          <strong className="text-foreground">
            The total payable to you is inclusive of GST at {GST_RATE}%.
          </strong>{" "}
          Your revenue share of {totals.ratePct} is calculated on the fees billed to your clients,
          and GST at {GST_RATE}% is added to your share. Do not add GST on top of the total — the
          amount payable to you is ₹&nbsp;{inr(totals.share)} in full. On your invoice this is
          ₹&nbsp;{inr(totals.shareNet)} plus GST of ₹&nbsp;{inr(totals.shareGst)}. Client fee
          amounts in the table are shown before GST, with GST in its own column.
          <br />
          <br />
          Fixed fees are billed quarterly and performance fees annually. Fee amounts are as
          recorded in our systems for the stated period. If any figure appears incorrect, contact
          investor.relations@qodeinvest.com before invoicing.
        </div>
      </div>
    </>
  );
}
