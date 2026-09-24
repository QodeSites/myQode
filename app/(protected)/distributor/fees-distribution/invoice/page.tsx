"use client";

// The distributor's own tax invoice to Qode.
//
// The fee statement deliberately is NOT a tax invoice: a compliant one needs
// the issuer's GSTIN, registered address and invoice number, none of which we
// hold and none of which is ours to invent. This page closes that gap the only
// honest way — the distributor supplies their own details, we supply the
// amounts, and the two combine into a document they can actually issue.
//
// The amounts are read-only. They come from the fee calculator, and a field a
// distributor could edit would turn a reconciled figure into an assertion.
//
// Printed via window.print() rather than a PDF library: no dependency, no
// server cost, and they see a preview before saving.
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer, Save, AlertTriangle, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QODE_ENTITY, qodeAddressLines, isQodeEntityComplete } from "@/lib/qodeEntity";
import {
  computeTax,
  validateGstin,
  validatePan,
  panFromGstin,
  GST_STATE_CODES,
  type TaxBreakdown,
} from "@/lib/invoiceTax";
import { amountInWords } from "@/lib/amountInWords";

type CalculatorRow = {
  clientName: string;
  totalFees: string;
  distributorPercentage: string;
  distributorShare: string;
  distributorShareCategory?: string | null;
  /** What the distributor is actually paid, after any discount, before GST. */
  yourCommission?: string;
  /** Their share of the fees before the discount is deducted. */
  yourShareOfFee?: string;
  /** Share minus commission — the discount they funded. */
  shareDiscount?: string;
  totalRackRateFee?: string;
  discountAmount?: string;
  distributorGrossShare?: string;
};

type Period = { type: "Quarter" | "Year"; label: string; startDate: string; endDate: string };

type Profile = {
  legalName: string;
  gstin: string;
  pan: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  invoicePrefix: string;
  lastInvoiceNumber: number;
  notes: string;
};

const EMPTY_PROFILE: Profile = {
  legalName: "", gstin: "", pan: "", addressLine1: "", addressLine2: "",
  city: "", state: "", stateCode: "", pincode: "",
  bankAccountName: "", bankAccountNumber: "", bankIfsc: "", bankName: "",
  invoicePrefix: "", lastInvoiceNumber: 0, notes: "",
};

const num = (s: string | undefined) => parseFloat(String(s ?? "").replace(/,/g, "")) || 0;
const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Today in yyyy-mm-dd, for the date input's default. */
const today = () => new Date().toISOString().slice(0, 10);

/** "07 Jul 2026" — the format used across the portal. */
const displayDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default function DistributorInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");

  const [rows, setRows] = React.useState<CalculatorRow[]>([]);
  const [period, setPeriod] = React.useState<Period | null>(null);
  const [distributorName, setDistributorName] = React.useState("");
  const [profile, setProfile] = React.useState<Profile>(EMPTY_PROFILE);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issueError, setIssueError] = React.useState<string | null>(null);

  const [invoiceNumber, setInvoiceNumber] = React.useState("");
  const [invoiceDate, setInvoiceDate] = React.useState(today());
  const [touchedNumber, setTouchedNumber] = React.useState(false);

  // ── Load the period, the fees, and any saved profile ──────────────────
  React.useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const pRes = await fetch("/api/distributor/calculator", { method: "GET" });
        if (!pRes.ok) throw new Error(`Could not load periods (${pRes.status})`);
        const pData = await pRes.json();
        const chosen: Period | null =
          (periodParam && pData.periods?.find((p: Period) => p.label === periodParam)) ||
          pData.suggestedPeriod ||
          pData.periods?.[0] ||
          null;
        if (!chosen) throw new Error("No billing periods are available yet");
        setPeriod(chosen);

        const [feeRes, profRes] = await Promise.all([
          fetch("/api/distributor/calculator", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // `period` drives rack-rate pro-rating; without it every period was
            // treated as a quarter.
            body: JSON.stringify({
              startDate: chosen.startDate,
              endDate: chosen.endDate,
              period: chosen.label,
            }),
          }),
          fetch("/api/distributor/invoice-profile"),
        ]);
        if (!feeRes.ok) throw new Error(`Could not load fees (${feeRes.status})`);
        setRows((await feeRes.json()) as CalculatorRow[]);

        // A missing profile is normal on first use, so a failure here must not
        // block the page — they can still fill the form in.
        if (profRes.ok) {
          const { profile: saved } = await profRes.json();
          if (saved) setProfile({ ...EMPTY_PROFILE, ...saved });
        }
      } catch (e: any) {
        setError(e.message || "Could not load the invoice");
      }
      setLoading(false);
    };
    load();
  }, [periodParam]);

  // The distributor's display name, from the same cookie the statement reads.
  React.useEffect(() => {
    try {
      const raw = document.cookie
        .split("; ")
        .find((c) => c.startsWith("qode-user-context="))
        ?.split("=")[1];
      if (raw) {
        const ctx = JSON.parse(decodeURIComponent(raw));
        setDistributorName(ctx.clientname || ctx.name || ctx.email || "");
      }
    } catch {
      /* the form still works without it */
    }
  }, []);

  // ── The amounts ───────────────────────────────────────────────────────
  // Taken from the calculator, never editable.
  //
  // The taxable value is the COMMISSION — what the distributor is actually
  // paid after any discount they gave — not `distributorShare`, which is the
  // share before the discount comes off. On a discounted client the two differ
  // by the whole discount: Prasanna Simhadri's share is ₹3,316.30 against a
  // ₹1,607.91 commission, so invoicing the share would over-bill by ₹1,708.39
  // plus GST on top of it.
  //
  // The commission arrives GST-EXCLUSIVE, so it is the taxable value directly
  // and GST is added by `computeTax` below.
  const amounts = React.useMemo(() => {
    const taxableValue = rows.reduce((s, r) => s + num(r.yourCommission), 0);
    return {
      taxableValue,
      shareInclGst: taxableValue * 1.18,
      rackFee: rows.reduce((s, r) => s + (num(r.totalRackRateFee) || num(r.totalFees)), 0),
      // The discount deducted from the share to reach that commission — shown
      // on the invoice's description line so the figure can be reconciled.
      discount: rows.reduce((s, r) => s + num(r.shareDiscount), 0),
      grossShare: rows.reduce((s, r) => s + num(r.yourShareOfFee), 0),
      clientCount: new Set(rows.map((r) => r.clientName.trim().toLowerCase())).size,
      ratePct:
        rows[0]?.distributorShareCategory ??
        (rows[0] ? `${rows[0].distributorPercentage}%` : "—"),
    };
  }, [rows]);

  const tax: TaxBreakdown = React.useMemo(
    () =>
      computeTax(
        amounts.taxableValue,
        profile.stateCode,
        QODE_ENTITY.stateCode,
        Boolean(profile.gstin.trim()),
      ),
    [amounts.taxableValue, profile.stateCode, profile.gstin],
  );

  // Suggest the next number in their series, but only until they edit it —
  // their series is theirs, and silently overwriting a typed number would be
  // worse than suggesting nothing.
  React.useEffect(() => {
    if (touchedNumber) return;
    const prefix = profile.invoicePrefix.trim();
    const next = (profile.lastInvoiceNumber || 0) + 1;
    setInvoiceNumber(prefix ? `${prefix}${String(next).padStart(3, "0")}` : String(next));
  }, [profile.invoicePrefix, profile.lastInvoiceNumber, touchedNumber]);

  const set = (k: keyof Profile) => (v: string) => {
    setProfile((p) => ({ ...p, [k]: v }));
    setSaved(false);
    setErrors((e) => {
      if (!e[k]) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });
  };

  /** Client-side validation, mirroring the server's. */
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!profile.legalName.trim()) next.legalName = "Enter the name your invoices are raised in";
    if (!profile.addressLine1.trim()) next.addressLine1 = "Enter your registered address";
    if (profile.gstin.trim()) {
      const g = validateGstin(profile.gstin);
      if (!g.valid) next.gstin = g.reason ?? "Check your GSTIN";
      else if (profile.stateCode && profile.gstin.slice(0, 2) !== profile.stateCode) {
        next.stateCode = `Your GSTIN begins ${profile.gstin.slice(0, 2)} (${
          GST_STATE_CODES[profile.gstin.slice(0, 2)] ?? "another state"
        }) — it must match your state`;
      }
    }
    if (profile.pan.trim()) {
      const p = validatePan(profile.pan);
      if (!p.valid) next.pan = p.reason ?? "Check your PAN";
      else {
        const embedded = profile.gstin.trim() ? panFromGstin(profile.gstin) : null;
        if (embedded && embedded !== profile.pan.trim().toUpperCase()) {
          next.pan = `This doesn't match the PAN inside your GSTIN (${embedded})`;
        }
      }
    }
    if (!invoiceNumber.trim()) next.invoiceNumber = "Enter an invoice number";
    if (!invoiceDate) next.invoiceDate = "Enter the invoice date";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const saveProfile = async () => {
    if (!validate()) return false;
    setSaving(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/distributor/invoice-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (res.status === 422) {
        setErrors((await res.json()).errors ?? {});
        return false;
      }
      if (!res.ok) throw new Error("Could not save your details");
      setSaved(true);
      return true;
    } catch (e: any) {
      setIssueError(e.message || "Could not save your details");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Save, record the invoice number, then open the print dialog. */
  const generate = async () => {
    if (!(await saveProfile())) return;
    setIssueError(null);
    try {
      const res = await fetch("/api/distributor/invoice-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          periodLabel: period?.label ?? "",
          periodStart: period?.startDate ?? null,
          periodEnd: period?.endDate ?? null,
          amountBeforeTax: tax.taxableValue,
          taxAmount: tax.totalTax,
          totalAmount: tax.total,
        }),
      });
      if (res.status === 409) {
        // A duplicate number is a compliance defect, so this stops rather than
        // printing anyway.
        setIssueError((await res.json()).error);
        return;
      }
      if (!res.ok) throw new Error("Could not record the invoice");
      window.print();
    } catch (e: any) {
      setIssueError(e.message || "Could not record the invoice");
    }
  };

  const qodeReady = isQodeEntityComplete();
  const ready =
    qodeReady &&
    profile.legalName.trim() !== "" &&
    profile.addressLine1.trim() !== "" &&
    invoiceNumber.trim() !== "" &&
    amounts.shareInclGst > 0;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto flex flex-col gap-4">
        <Skeleton className="h-10 w-48 rounded-md" />
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <div className="rounded-xl border border-border/20 bg-card px-6 py-10 text-center">
          <p className="font-serif text-lg text-foreground">We couldn&apos;t load your invoice</p>
          <p className="text-sm text-muted-foreground mt-1.5">{error}</p>
          <button
            onClick={() => router.push("/distributor/fees-distribution")}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border/25 px-4 py-2.5 min-h-[44px] text-sm font-bold hover:border-primary"
          >
            Back to fees
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Print rules: the form, the portal chrome and the guidance all drop
          away, leaving only the invoice itself on the page. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff !important; }
          nav, aside, header, footer, .no-print { display: none !important; }
          .invoice-sheet {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            max-width: none !important;
          }
          .invoice-row { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3 mb-5 flex-wrap">
        <button
          onClick={() => router.push("/distributor/fees-distribution")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Back to fees
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md border border-border/25 text-muted-foreground font-bold text-sm px-4 py-2.5 min-h-[44px] hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            {saved ? <Check className="w-4 h-4" aria-hidden /> : <Save className="w-4 h-4" aria-hidden />}
            {saved ? "Saved" : saving ? "Saving…" : "Save details"}
          </button>
          <button
            onClick={generate}
            disabled={!ready}
            title={
              !qodeReady
                ? "Qode's GST details are not configured yet"
                : !ready
                  ? "Fill in your name, address and invoice number first"
                  : undefined
            }
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground font-bold text-sm px-4 py-2.5 min-h-[44px] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" aria-hidden />
            Generate invoice
          </button>
        </div>
      </div>

      {!qodeReady && (
        <div className="no-print rounded-xl border border-[#9a6b12]/30 bg-[#9a6b12]/5 px-5 py-4 mb-5 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-[#9a6b12] dark:text-[#e0b558] shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm text-muted-foreground">
            <span className="font-bold text-foreground">Invoicing isn&apos;t available yet.</span>{" "}
            Qode&apos;s GST details haven&apos;t been configured in the portal, and an invoice
            without them wouldn&apos;t be valid. Please contact investor.relations@qodeinvest.com.
          </div>
        </div>
      )}

      {issueError && (
        <div className="no-print rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 mb-5 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm text-foreground">{issueError}</div>
        </div>
      )}

      {/* ── The form ────────────────────────────────────────────────────── */}
      <div className="no-print rounded-xl border border-border/20 bg-card shadow-sm px-5 sm:px-6 py-5 mb-6">
        <h2 className="font-serif text-lg text-foreground">Your invoice details</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-5 max-w-2xl">
          These appear on the invoice as the party raising it. We save them, so you only need to
          enter them once — the amounts below come from your fees for the period and can&apos;t be
          edited.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <Field
            label="Registered name"
            required
            value={profile.legalName}
            onChange={set("legalName")}
            error={errors.legalName}
            placeholder="As registered — e.g. Acme Capital Services LLP"
            className="sm:col-span-2"
          />
          <Field
            label="GSTIN"
            value={profile.gstin}
            onChange={(v) => set("gstin")(v.toUpperCase())}
            error={errors.gstin}
            placeholder="27AABCU9603R1ZX"
            hint="Leave blank if you aren't GST-registered — the invoice will show no GST."
            maxLength={15}
          />
          <Field
            label="PAN"
            value={profile.pan}
            onChange={(v) => set("pan")(v.toUpperCase())}
            error={errors.pan}
            placeholder="AABCU9603R"
            maxLength={10}
          />
          <Field
            label="Registered address"
            required
            value={profile.addressLine1}
            onChange={set("addressLine1")}
            error={errors.addressLine1}
            placeholder="Building, street"
            className="sm:col-span-2"
          />
          <Field
            label="Address line 2"
            value={profile.addressLine2}
            onChange={set("addressLine2")}
            placeholder="Area, landmark"
            className="sm:col-span-2"
          />
          <Field label="City" value={profile.city} onChange={set("city")} placeholder="Mumbai" />
          <div>
            <label className="block text-[11px] font-bold tracking-[0.08em] uppercase text-muted-foreground mb-1.5">
              State
            </label>
            <select
              value={profile.stateCode}
              onChange={(e) => {
                const code = e.target.value;
                setProfile((p) => ({
                  ...p,
                  stateCode: code,
                  state: GST_STATE_CODES[code] ?? "",
                }));
                setSaved(false);
                setErrors((er) => {
                  const n = { ...er };
                  delete n.stateCode;
                  return n;
                });
              }}
              className="w-full rounded-md border border-border/25 bg-background px-3 py-2.5 min-h-[44px] text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">Select your state</option>
              {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
            {errors.stateCode && (
              <p className="text-xs text-destructive mt-1">{errors.stateCode}</p>
            )}
            {!errors.stateCode && profile.stateCode && profile.gstin && (
              <p className="text-xs text-muted-foreground mt-1">
                {profile.stateCode === QODE_ENTITY.stateCode
                  ? "Same state as Qode — your invoice will show CGST and SGST."
                  : "Different state from Qode — your invoice will show IGST."}
              </p>
            )}
          </div>
          <Field label="PIN code" value={profile.pincode} onChange={set("pincode")} placeholder="400001" maxLength={6} />
          <Field
            label="Invoice number"
            required
            value={invoiceNumber}
            onChange={(v) => {
              setTouchedNumber(true);
              setInvoiceNumber(v);
              setErrors((e) => {
                const n = { ...e };
                delete n.invoiceNumber;
                return n;
              });
            }}
            error={errors.invoiceNumber}
            hint={
              profile.lastInvoiceNumber
                ? `Your last invoice here was number ${profile.lastInvoiceNumber}.`
                : "Use your own series — we'll suggest the next one after this."
            }
          />
          <div>
            <label className="block text-[11px] font-bold tracking-[0.08em] uppercase text-muted-foreground mb-1.5">
              Invoice date <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full rounded-md border border-border/25 bg-background px-3 py-2.5 min-h-[44px] text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            />
            {errors.invoiceDate && <p className="text-xs text-destructive mt-1">{errors.invoiceDate}</p>}
          </div>
          <Field
            label="Invoice prefix"
            value={profile.invoicePrefix}
            onChange={set("invoicePrefix")}
            placeholder="e.g. ACS/25-26/"
            hint="Optional — used to suggest your next invoice number."
          />

          <div className="sm:col-span-2 border-t border-border/15 pt-4 mt-1">
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-muted-foreground mb-3">
              Bank details for payment
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
              <Field label="Account name" value={profile.bankAccountName} onChange={set("bankAccountName")} />
              <Field label="Account number" value={profile.bankAccountNumber} onChange={set("bankAccountNumber")} />
              <Field
                label="IFSC"
                value={profile.bankIfsc}
                onChange={(v) => set("bankIfsc")(v.toUpperCase())}
                maxLength={11}
              />
              <Field label="Bank name" value={profile.bankName} onChange={set("bankName")} />
            </div>
          </div>
        </div>
      </div>

      <div className="no-print text-xs text-muted-foreground mb-4">
        Choose <strong>Save as PDF</strong> as the destination in the print dialog. Your invoice
        number is recorded when you generate, so each one is only used once.
      </div>

      {/* ── The invoice itself ──────────────────────────────────────────── */}
      <div className="invoice-sheet rounded-xl border border-border/20 bg-card shadow-sm px-6 sm:px-8 py-7">
        <div className="flex items-start justify-between gap-6 flex-wrap border-b border-border/25 pb-5">
          <div>
            <div className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
              Tax Invoice
            </div>
            <div className="font-serif text-xl mt-1">
              {profile.legalName || distributorName || "Your registered name"}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {[profile.addressLine1, profile.addressLine2]
                .filter(Boolean)
                .map((l) => (
                  <div key={l}>{l}</div>
                ))}
              {[profile.city, profile.state, profile.pincode].filter(Boolean).length > 0 && (
                <div>{[profile.city, profile.state, profile.pincode].filter(Boolean).join(", ")}</div>
              )}
              {profile.gstin && <div className="mt-1">GSTIN: {profile.gstin}</div>}
              {profile.pan && <div>PAN: {profile.pan}</div>}
            </div>
          </div>
          <div className="text-right text-xs">
            <div>
              <span className="text-muted-foreground">Invoice no.</span>{" "}
              <span className="font-bold tabular-nums">{invoiceNumber || "—"}</span>
            </div>
            <div className="mt-1">
              <span className="text-muted-foreground">Date</span>{" "}
              <span className="font-bold tabular-nums">{displayDate(invoiceDate)}</span>
            </div>
            <div className="mt-1">
              <span className="text-muted-foreground">Period</span>{" "}
              <span className="font-bold">{period?.label ?? "—"}</span>
            </div>
          </div>
        </div>

        {/* Bill To — Qode, from the single shared constant. */}
        <div className="py-5 border-b border-border/25">
          <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-1.5">
            Bill to
          </div>
          <div className="font-bold text-sm">{QODE_ENTITY.name}</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {qodeAddressLines().map((l) => (
              <div key={l}>{l}</div>
            ))}
            {QODE_ENTITY.gstin && <div className="mt-1">GSTIN: {QODE_ENTITY.gstin}</div>}
            <div>SEBI Registered Portfolio Manager · {QODE_ENTITY.sebiRegistration}</div>
          </div>
        </div>

        {/* Description of supply. One line: this is a fee-share invoice, not an
            itemised bill, and the per-client detail lives on the statement. */}
        <div className="py-5">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border/25">
                <th className="text-left font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2">
                  Description
                </th>
                <th className="text-right font-bold text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground pb-2 whitespace-nowrap">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="invoice-row border-b border-border/10">
                <td className="py-3 pr-4">
                  <div className="text-foreground">
                    Distribution fees — {period?.label ?? "the period"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    {amounts.ratePct} share of fees on {amounts.clientCount}{" "}
                    {amounts.clientCount === 1 ? "client" : "clients"}
                    {amounts.discount > 0 &&
                      `, net of ₹ ${inr(amounts.discount)} in discounts given to clients`}
                    . {period?.startDate} to {period?.endDate}.
                  </div>
                </td>
                <td className="py-3 text-right tabular-nums whitespace-nowrap align-top">
                  ₹ {inr(tax.taxableValue)}
                </td>
              </tr>

              <tr className="invoice-row">
                <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs">
                  Taxable value
                </td>
                <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                  ₹ {inr(tax.taxableValue)}
                </td>
              </tr>

              {/* CGST+SGST when both parties are in Maharashtra, IGST
                  otherwise. Nothing at all when unregistered. */}
              {tax.treatment === "intra_state" && (
                <>
                  <tr className="invoice-row">
                    <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs">
                      CGST @ {tax.cgstRate}%
                    </td>
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                      ₹ {inr(tax.cgst)}
                    </td>
                  </tr>
                  <tr className="invoice-row">
                    <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs">
                      SGST @ {tax.sgstRate}%
                    </td>
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                      ₹ {inr(tax.sgst)}
                    </td>
                  </tr>
                </>
              )}
              {tax.treatment === "inter_state" && (
                <tr className="invoice-row">
                  <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs">
                    IGST @ {tax.igstRate}%
                  </td>
                  <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                    ₹ {inr(tax.igst)}
                  </td>
                </tr>
              )}
              {tax.treatment === "unregistered" && (
                <tr className="invoice-row">
                  <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs" colSpan={2}>
                    No GST charged — not registered under GST
                  </td>
                </tr>
              )}

              <tr className="invoice-row border-t-2 border-border/30">
                <td className="py-3 pr-4 text-right font-bold">Total</td>
                <td className="py-3 text-right tabular-nums whitespace-nowrap font-bold text-base">
                  ₹ {inr(tax.total)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="text-xs text-muted-foreground mt-3 italic">
            {amountInWords(tax.total)}
          </div>
        </div>

        {(profile.bankAccountNumber || profile.bankIfsc) && (
          <div className="py-4 border-t border-border/25">
            <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-1.5">
              Payment details
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {profile.bankAccountName && <div>{profile.bankAccountName}</div>}
              {profile.bankName && <div>{profile.bankName}</div>}
              {profile.bankAccountNumber && (
                <div className="tabular-nums">A/c {profile.bankAccountNumber}</div>
              )}
              {profile.bankIfsc && <div className="tabular-nums">IFSC {profile.bankIfsc}</div>}
            </div>
          </div>
        )}

        {profile.notes && (
          <div className="py-4 border-t border-border/25 text-xs text-muted-foreground whitespace-pre-line">
            {profile.notes}
          </div>
        )}

        <div className="pt-4 border-t border-border/25 text-[11px] text-muted-foreground leading-relaxed">
          Amounts are for distribution fees earned on client portfolios managed by{" "}
          {QODE_ENTITY.name} for the period stated. This invoice is raised by the distributor named
          above.
        </div>
      </div>
    </div>
  );
}

/** A labelled text input. Errors sit inline, in words, beneath the field. */
function Field({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  required,
  maxLength,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-bold tracking-[0.08em] uppercase text-muted-foreground mb-1.5">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full rounded-md border bg-background px-3 py-2.5 min-h-[44px] text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary ${
          error ? "border-destructive" : "border-border/25"
        }`}
      />
      {error ? (
        <p className="text-xs text-destructive mt-1">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
