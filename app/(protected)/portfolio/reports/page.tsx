"use client";

// Portfolio → Reports: the web version of the myQode app's Reports page — Transactions, Capital gains, Expenses
// and the Portfolio fact sheet for one strategy account, with the same filters and the same PDF statements.
// Data: /api/reports/* (lib/reportsData.ts, shared with /api/mobile/reports/*), authorised by the signed web
// session. PDFs: lib/reportPdf.js (same design as the app), opened in a print tab → "Save as PDF".
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useClient } from "@/contexts/ClientContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
// @ts-ignore — plain JS module shared with the app
import { transactionsPdf, capitalGainsPdf, expensesPdf, factsheetPdf } from "@/lib/reportPdf";

/* ── formatting (same rules as the app: ₹, Indian grouping, 2 decimals, "−", "25 Sep 2026") ─────────────── */
const MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const rnd = (v: number, dp: number) => +(+v).toFixed(dp);
const inr = (v: number | null | undefined, dp = 2) => {
  if (v == null || isNaN(v)) return "—";
  const r = rnd(v, dp);
  return (r < 0 ? "−" : "") + "₹" + Math.abs(r).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
const sinr = (v: number | null | undefined, dp = 2) => (v == null || isNaN(v) ? "—" : (rnd(v, dp) > 0 ? "+" : "") + inr(v, dp));
const pct = (v: number | null | undefined) => {
  if (v == null || isNaN(v)) return "—";
  const r = rnd(v, 2);
  return (r < 0 ? "−" : r > 0 ? "+" : "") + Math.abs(r).toFixed(2) + "%";
};
const qty = (v: number | null | undefined) => (v == null ? "" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 4 }));
const fmtDate = (iso?: string | null) => (iso ? `${iso.slice(8, 10)} ${MS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : "—");
const tone = (v: number | null | undefined) =>
  v == null || !rnd(v, 2) ? "" : v > 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400";
const periodLabel = (p: string) =>
  String(p).replace(/^(\d+)([a-z])$/i, (_, n, u) => n + u.toUpperCase())
    .replace(/^Since (\d{2})\/(\d{2})\/(\d{2,4})$/i, (_, d, m, y) => `Since ${d} ${MS[+m - 1]} ${y.length === 2 ? "20" + y : y}`);

/* ── data ───────────────────────────────────────────────────────────────────────────────────────────────── */
type Kind = "transactions" | "capital-gains" | "expenses" | "factsheet";
class SessionError extends Error {}
async function getReport(kind: Kind, accountId: string, opts: Record<string, any> = {}) {
  const qs = new URLSearchParams({ accountId });
  Object.entries(opts).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, String(v)); });
  const res = await fetch(`/api/reports/${kind}?${qs}`, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw new SessionError((data && data.error) || "Please sign in again.");
  if (!res.ok) throw new Error((data && data.error) || `Something went wrong (${res.status}).`);
  return data;
}

// First page carries the summary; "Load more" appends. A generation counter drops replies for an old filter.
function usePaged(fetchPage: (offset: number) => Promise<any>, deps: any[]) {
  const [st, set] = useState<{ head: any; items: any[]; loading: boolean; more: boolean; err: Error | null; busy: boolean }>({ head: null, items: [], loading: true, more: false, err: null, busy: false });
  const [tick, setTick] = useState(0);
  const gen = useRef(0);
  useEffect(() => {
    const g = ++gen.current;
    set({ head: null, items: [], loading: true, more: false, err: null, busy: false });
    fetchPage(0).then(
      d => { if (g === gen.current) set({ head: d, items: d.items || [], loading: false, more: !!d.hasMore, err: null, busy: false }); },
      e => { if (g === gen.current) set(s => ({ ...s, loading: false, err: e })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const loadMore = () => {
    if (st.busy || !st.more) return;
    const g = gen.current;
    set(s => ({ ...s, busy: true }));
    fetchPage(st.items.length).then(
      d => { if (g === gen.current) set(s => ({ ...s, items: s.items.concat(d.items || []), more: !!d.hasMore, busy: false })); },
      () => { if (g === gen.current) set(s => ({ ...s, busy: false })); });
  };
  return { ...st, loadMore, reload: () => setTick(t => t + 1) };
}

/* ── PDF: open the tab inside the click (no pop-up block), then fill it ──────────────────────────────────── */
function usePdf() {
  const [busy, setBusy] = useState(false);
  const run = async (make: () => Promise<{ html: string }>) => {
    if (busy) return;
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups for this site to download the PDF."); return; }
    w.document.write('<p style="font-family:sans-serif;padding:24px;color:#37584f">Preparing your statement…</p>');
    setBusy(true);
    try {
      const { html } = await make();
      w.document.open(); w.document.write(html); w.document.close();
      w.onload = () => { w.focus(); w.print(); };
      setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 700);
    } catch (e: any) {
      w.close();
      alert(e?.message || "We couldn't create the PDF. Please try again.");
    } finally { setBusy(false); }
  };
  return { busy, run };
}
function PdfButton({ make, disabled }: { make: () => Promise<{ html: string }>; disabled?: boolean }) {
  const { busy, run } = usePdf();
  return (
    <Button variant="outline" size="sm" onClick={() => run(make)} disabled={disabled || busy} className="gap-2">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
    </Button>
  );
}

/* ── shared pieces ──────────────────────────────────────────────────────────────────────────────────────── */
function Stat({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <Card className="border-t-2 border-t-primary-foreground/80 shadow-none">
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums text-foreground ${className}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${value === k ? "border-primary bg-primary text-primary-foreground" : "border-border/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
function AsOf({ d, note }: { d?: string | null; note?: string }) {
  return <p className="text-xs text-muted-foreground">As of {fmtDate(d)}{note ? ` · ${note}` : ""}</p>;
}
function Loading() {
  return <div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>;
}
function ErrorBox({ err, onRetry }: { err: Error; onRetry: () => void }) {
  const session = err instanceof SessionError;
  return (
    <Card className="shadow-none"><CardContent className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="font-semibold text-foreground">{session ? "Please sign in again" : "We couldn't load this report"}</p>
      <p className="max-w-md text-sm text-muted-foreground">{session ? "For your security, reports need a fresh sign-in." : err.message}</p>
      {session ? <Button asChild size="sm"><Link href="/login">Sign in</Link></Button> : <Button size="sm" variant="outline" onClick={onRetry} className="gap-2"><RefreshCw className="h-4 w-4" /> Try again</Button>}
    </CardContent></Card>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="shadow-none"><CardContent className="p-8 text-center text-sm text-muted-foreground">{children}</CardContent></Card>;
}
function MoreButton({ L }: { L: ReturnType<typeof usePaged> }) {
  if (!L.more) return null;
  return <div className="flex justify-center"><Button variant="outline" onClick={L.loadMore} disabled={L.busy}>{L.busy ? "Loading…" : "Load more"}</Button></div>;
}
const th = "bg-primary px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-foreground";
const td = "px-3 py-2.5 align-top";
function TableShell({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/20">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead><tr>{head}</tr></thead>
        <tbody className="[&>tr:nth-child(even)]:bg-card [&>tr]:border-b [&>tr]:border-border/10">{children}</tbody>
      </table>
    </div>
  );
}

/* ── period filter (This FY / Last FY / Last 3 or 12 months / All time / Custom) ─────────────────────────── */
type Preset = "fy" | "this-fy" | "last-fy" | "3m" | "12m" | "all" | "custom";
type Period = { preset: Preset; from: string; to: string };
const PRESETS: [Preset, string][] = [["this-fy", "This FY"], ["last-fy", "Last FY"], ["3m", "Last 3 months"], ["12m", "Last 12 months"], ["all", "All time"], ["custom", "Custom"]];
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthsAgo = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() - m); return isoOf(d); };
/** The from / to a period sends ({} = no date filter, the report's default). */
function rangeOf(p: Period): { from?: string; to?: string } {
  const today = isoOf(new Date()), now = new Date(), fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  switch (p.preset) {
    case "this-fy": return { from: `${fyStart}-04-01`, to: today };
    case "last-fy": return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
    case "3m": return { from: monthsAgo(3), to: today };
    case "12m": return { from: monthsAgo(12), to: today };
    case "custom": return { from: p.from || undefined, to: p.to || undefined };
    default: return {};
  }
}
const rangeText = (r: { from?: string | null; to?: string | null }) =>
  r.from && r.to ? `${fmtDate(r.from)} to ${fmtDate(r.to)}` : r.from ? `From ${fmtDate(r.from)}` : r.to ? `Up to ${fmtDate(r.to)}` : "";
const dateInput = "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
function PeriodFilter({ value, onChange, extra }: { value: Period; onChange: (p: Period) => void; extra?: [Preset, string] }) {
  const options = extra ? [extra, ...PRESETS] : PRESETS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.preset} onValueChange={v => {
        const preset = v as Preset;
        // Custom starts from the dates the previous preset covered, so switching over keeps the view.
        onChange(preset === "custom" ? { preset, from: rangeOf(value).from || value.from, to: rangeOf(value).to || value.to } : { ...value, preset });
      }}>
        <SelectTrigger className="h-9 w-[170px]" aria-label="Period"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
      </Select>
      {value.preset === "custom" && (
        <>
          <input type="date" aria-label="From date" className={dateInput} value={value.from} max={value.to || undefined} onChange={e => onChange({ ...value, from: e.target.value })} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" aria-label="To date" className={dateInput} value={value.to} min={value.from || undefined} onChange={e => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}
/** "Showing 01 Apr 2026 to 27 Sep 2026 · Records from 01 Jul 2023 to 25 Sep 2026" */
function PeriodNote({ showing, coverage, coverageLabel = "Records on file" }: { showing: string; coverage?: { from?: string | null; to?: string | null } | null; coverageLabel?: string }) {
  const cov = coverage && (coverage.from || coverage.to) ? rangeText(coverage) : "";
  return <p className="text-xs text-muted-foreground">Showing <span className="font-semibold text-foreground">{showing}</span>{cov ? ` · ${coverageLabel}: ${cov}` : ""}</p>;
}
// lib/reportPdf.js prints a "Period" field only for a financial year; add it to a statement's account strip for a date range.
const withPeriod = (pdf: { html: string; landscape?: boolean }, text: string) =>
  text ? { ...pdf, html: pdf.html.replace('</div><div class="tiles">', `<div><div class="lbl">Period</div><div class="val">${text.replace(/[&<>"]/g, "")}</div></div></div><div class="tiles">`) } : pdf;

/* ── Transactions ───────────────────────────────────────────────────────────────────────────────────────── */
const TXN_GROUPS: [string, string][] = [["all", "All"], ["trades", "Trades"], ["money", "Money in/out"], ["income", "Income"], ["charges", "Charges"], ["other", "Other"]];
function Transactions({ accountId, rk }: { accountId: string; rk: number }) {
  const [group, setGroup] = useState("all");
  const [period, setPeriod] = useState<Period>({ preset: "all", from: "", to: "" });
  const range = rangeOf(period);
  const L = usePaged(offset => getReport("transactions", accountId, { group, ...range, limit: 50, offset }), [accountId, group, range.from, range.to, rk]);
  const h = L.head;
  const showing = rangeText(range) || "All time";
  const rows = useMemo(() => {
    const out: React.ReactNode[] = []; let last = "";
    L.items.forEach((t: any) => {
      const m = (t.date || "").slice(0, 7);
      if (m !== last) { last = m; out.push(<tr key={"m" + m} className="!bg-muted"><td colSpan={5} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary">{m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : ""}</td></tr>); }
      const sign = t.direction === "in" ? "+" : t.direction === "out" ? "−" : "";
      out.push(
        <tr key={t.id}>
          <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(t.date)}</td>
          <td className={td}><span className="font-medium text-foreground">{t.type}</span></td>
          <td className={`${td} text-foreground`}>{t.security || t.notes || ""}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums text-muted-foreground`}>{t.qty != null && t.rate != null ? `${qty(t.qty)} @ ${inr(t.rate)}` : ""}</td>
          <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums ${t.direction === "in" ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>{sign}{inr(t.amount)}</td>
        </tr>);
    });
    return out;
  }, [L.items]);
  return (
    <div className="space-y-5">
      {h && h.asOf && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Money in" value={sinr(h.moneyIn)} className={tone(h.moneyIn)} />
          <Stat label="Money out" value={h.moneyOut ? "−" + inr(h.moneyOut) : inr(0)} />
          {h.summary.filter((s: any) => s.group !== "money").slice(0, 2).map((s: any) => <Stat key={s.group} label={`${s.label} · ${s.count}`} value={inr(s.amount)} />)}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <PeriodNote showing={showing} coverage={h?.coverage} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips value={group} options={TXN_GROUPS} onChange={setGroup} />
        <div className="flex items-center gap-3">
          {h && h.asOf && <AsOf d={h.asOf} note="latest transaction on record" />}
          <PdfButton disabled={!L.items.length} make={async () => withPeriod(transactionsPdf(await getReport("transactions", accountId, { group, ...range, export: 1, limit: 5000 }), accountId, (TXN_GROUPS.find(g => g[0] === group) || [])[1]), rangeText(range))} />
        </div>
      </div>
      {L.loading ? <Loading /> : L.err ? <ErrorBox err={L.err} onRetry={L.reload} /> : !L.items.length
        ? <Empty>{h && !h.asOf ? "No transactions are on record for this account yet." : period.preset === "all" ? "No transactions in this category." : "No transactions in this category for the selected period."}</Empty>
        : <TableShell head={<><th className={th}>Date</th><th className={th}>Transaction</th><th className={th}>Security / details</th><th className={`${th} text-right`}>Quantity @ rate</th><th className={`${th} text-right`}>Amount</th></>}>{rows}</TableShell>}
      <MoreButton L={L} />
    </div>
  );
}

/* ── Capital gains ──────────────────────────────────────────────────────────────────────────────────────── */
function CapitalGains({ accountId, rk }: { accountId: string; rk: number }) {
  const [fy, setFy] = useState<string | null>(null);
  const [term, setTerm] = useState<"" | "ST" | "LT">("");
  // "fy" (default) = the financial-year chips; any other period sends from / to, which the API applies over fy.
  const [period, setPeriod] = useState<Period>({ preset: "fy", from: "", to: "" });
  // "All time" needs an explicit range here, or the API falls back to the latest financial year.
  const range = period.preset === "all" ? { from: "1900-01-01" } : rangeOf(period);
  const ranged = period.preset !== "fy" && !!(range.from || range.to);
  const q = ranged ? range : { fy: fy || undefined };
  const L = usePaged(offset => getReport("capital-gains", accountId, { ...q, term: term || undefined, limit: 50, offset }), [accountId, fy, term, ranged, range.from, range.to, rk]);
  const h = L.head, s = h && h.summary;
  const showing = !ranged ? (h?.fy ? `FY ${h.fy}` : "Latest financial year") : period.preset === "all" ? "All time" : rangeText(range);
  return (
    <div className="space-y-5">
      {h && h.years && h.years.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PeriodFilter value={period} onChange={setPeriod} extra={["fy", "Financial year"]} />
            <PeriodNote showing={showing} coverage={h.coverage} coverageLabel="Sales on file" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!ranged ? <Chips value={h.fy} options={h.years.map((y: any) => [y.fy, "FY " + y.fy])} onChange={v => { setFy(v); setPeriod(p => ({ ...p, preset: "fy" })); }} /> : <span />}
            <div className="flex items-center gap-3">
              <AsOf d={h.asOf} note="realised gains by date of sale" />
              <PdfButton disabled={!s} make={async () => {
                const r = await getReport("capital-gains", accountId, { ...(ranged ? range : { fy: h.fy }), term: term || undefined, export: 1, limit: 5000 });
                const pdf = capitalGainsPdf(r, accountId);
                return ranged ? withPeriod({ ...pdf, html: pdf.html.replace(">FY  · Short term<", ">Short term<") }, showing === "All time" ? rangeText(r.coverage || {}) : showing) : pdf;
              }} />
            </div>
          </div>
        </>
      )}
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Short term" value={sinr(s.st)} className={tone(s.st)} />
          <Stat label="Long term" value={sinr(s.lt)} className={tone(s.lt)} />
          <Stat label="LT after grandfathering" value={sinr(s.ltTaxable)} className={tone(s.ltTaxable)} />
          <Stat label="Total realised" value={sinr(s.total)} className={tone(s.total)} />
        </div>
      )}
      {s && s.byCategory.length > 1 && (
        <Card className="shadow-none"><CardContent className="divide-y divide-border/10 p-0">
          {s.byCategory.map((c: any) => (
            <div key={c.category} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">{c.category}</span>
              <span className={`font-semibold tabular-nums ${tone((c.st || 0) + (c.lt || 0))}`}>{sinr((c.st || 0) + (c.lt || 0))}</span>
            </div>))}
        </CardContent></Card>
      )}
      {h && h.years && h.years.length > 0 && <Chips value={term} options={[["", "All lots"], ["ST", "Short term"], ["LT", "Long term"]]} onChange={setTerm} />}
      {L.loading ? <Loading /> : L.err ? <ErrorBox err={L.err} onRetry={L.reload} /> : !L.items.length
        ? <Empty>{h && !h.asOf ? "No capital gains report is available for this account yet." : "No realised gains in this selection."}</Empty>
        : <TableShell head={<><th className={th}>Security</th><th className={th}>Sold</th><th className={th}>Bought</th><th className={`${th} text-right`}>Quantity</th><th className={`${th} text-right`}>Sale value</th><th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>Days</th><th className={`${th} text-right`}>Gain / loss</th></>}>
            {L.items.map((l: any, i: number) => (
              <tr key={i}>
                <td className={td}><span className="font-medium text-foreground">{l.security}</span> <Badge variant="outline" className="ml-1 text-[10px]">{l.term}</Badge></td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(l.saleDate)}</td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(l.purchaseDate)}</td>
                <td className={`${td} text-right tabular-nums`}>{qty(l.qty)}</td>
                <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{inr(l.saleAmount)}</td>
                <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{inr(l.cost)}</td>
                <td className={`${td} text-right tabular-nums text-muted-foreground`}>{l.daysHeld ?? ""}</td>
                <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums ${tone(l.gain)}`}>{sinr(l.gain)}</td>
              </tr>))}
          </TableShell>}
      <MoreButton L={L} />
    </div>
  );
}

/* ── Expenses ───────────────────────────────────────────────────────────────────────────────────────────── */
function Expenses({ accountId, rk }: { accountId: string; rk: number }) {
  const [type, setType] = useState("");
  const [period, setPeriod] = useState<Period>({ preset: "all", from: "", to: "" });
  const range = rangeOf(period);
  const L = usePaged(offset => getReport("expenses", accountId, { type: type || undefined, ...range, limit: 50, offset }), [accountId, type, range.from, range.to, rk]);
  const h = L.head;
  const showing = rangeText(range) || "Whole statement";
  const max = h && h.byType.length ? Math.max(...h.byType.map((t: any) => t.amount || 0), 1) : 1;
  return (
    <div className="space-y-5">
      {h && h.asOf && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Paid" value={inr(h.paid)} />
            <Stat label="Payable (accrued)" value={inr(h.payable)} />
            <Stat label="Period" value={<span className="text-base">{fmtDate(h.period.from)} – {fmtDate(h.period.to)}</span>} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PeriodFilter value={period} onChange={setPeriod} />
            <PeriodNote showing={showing} coverage={h.period} coverageLabel="Statement period" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AsOf d={h.asOf} />
            <PdfButton disabled={!L.items.length} make={async () => {
              const r = await getReport("expenses", accountId, { type: type || undefined, ...range, export: 1, limit: 5000 });
              // The PDF's "Period" field shows the selected dates when a range is chosen.
              return expensesPdf(range.from || range.to ? { ...r, period: { from: range.from || r.period?.from, to: range.to || r.period?.to } } : r, accountId);
            }} />
          </div>
          <Card className="shadow-none"><CardContent className="space-y-1 p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By charge · {type ? "click again to show all" : "click to filter"}</p>
            {h.byType.map((t: any) => (
              <button key={t.type} onClick={() => setType(type === t.type ? "" : t.type)} className={`block w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-muted ${type === t.type ? "bg-muted ring-1 ring-primary/40" : ""}`}>
                <div className="flex justify-between gap-4 text-sm"><span className={type === t.type ? "font-semibold text-foreground" : "text-foreground"}>{t.type} <span className="text-xs text-muted-foreground">· {t.count}</span></span><span className="font-semibold tabular-nums">{inr(t.amount)}</span></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(1, (t.amount || 0) / max * 100)}%` }} /></div>
              </button>))}
          </CardContent></Card>
        </>
      )}
      {L.loading ? <Loading /> : L.err ? <ErrorBox err={L.err} onRetry={L.reload} /> : !L.items.length
        ? <Empty>{h && h.asOf ? "No expenses in the selected period." : "No expense statement is available for this account yet."}</Empty>
        : <TableShell head={<><th className={th}>Date</th><th className={th}>Charge</th><th className={th}>Description</th><th className={th}>Status</th><th className={`${th} text-right`}>Amount</th></>}>
            {L.items.map((x: any, i: number) => (
              <tr key={i}>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(x.date)}</td>
                <td className={`${td} font-medium text-foreground`}>{x.type}</td>
                <td className={`${td} text-muted-foreground`}>{x.notes || ""}</td>
                <td className={td}>{x.status === "payable" ? <Badge variant="outline" className="border-primary-foreground text-[10px]">Payable</Badge> : <span className="text-xs text-muted-foreground">Paid</span>}</td>
                <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums`}>{inr(x.amount)}</td>
              </tr>))}
          </TableShell>}
      <MoreButton L={L} />
    </div>
  );
}

/* ── Fact sheet ─────────────────────────────────────────────────────────────────────────────────────────── */
function Factsheet({ accountId, rk }: { accountId: string; rk: number }) {
  const [st, set] = useState<{ d: any; loading: boolean; err: Error | null }>({ d: null, loading: true, err: null });
  const [tick, setTick] = useState(0);
  // "As of": "" = latest snapshot; otherwise the API returns the latest snapshot on or before this date.
  const [date, setDate] = useState("");
  const [custom, setCustom] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  useEffect(() => {
    let dead = false;
    set({ d: null, loading: true, err: null });
    getReport("factsheet", accountId, { date: date || undefined }).then(d => { if (!dead) { set({ d, loading: false, err: null }); if (d?.dates) setDates(d.dates); } }, e => { if (!dead) set({ d: null, loading: false, err: e }); });
    return () => { dead = true; };
  }, [accountId, rk, tick, date]);
  const picker = dates.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">As of</span>
      <Select value={custom ? "custom" : date || "latest"} onValueChange={v => {
        if (v === "custom") { setCustom(true); return; }
        setCustom(false); setDate(v === "latest" ? "" : v);
      }}>
        <SelectTrigger className="h-9 w-[170px]" aria-label="As of"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="latest">Latest ({fmtDate(dates[0])})</SelectItem>
          {dates.slice(1).map(x => <SelectItem key={x} value={x}>{fmtDate(x)}</SelectItem>)}
          <SelectItem value="custom">Custom date</SelectItem>
        </SelectContent>
      </Select>
      {custom && <input type="date" aria-label="As of date" className={dateInput} value={date} max={dates[0]} onChange={e => setDate(e.target.value)} />}
    </div>
  );
  if (st.loading) return <div className="space-y-5">{picker}<Loading /></div>;
  if (st.err) return <ErrorBox err={st.err} onRetry={() => setTick(t => t + 1)} />;
  const d = st.d;
  if (!d || !d.asOf) return date
    ? <div className="space-y-5">{picker}<Empty>No fact sheet is available on or before {fmtDate(date)}. The earliest is {fmtDate(dates[dates.length - 1])}.</Empty></div>
    : <Empty>No fact sheet is available for this account yet.</Empty>;
  const r = d.returns || {}, periods: string[] = r.periods || [];
  const chart = periods.map((p, i) => ({ p: periodLabel(p), Portfolio: r.portfolio?.[i] ?? null, [r.benchmark?.name || "Benchmark"]: r.benchmark?.values?.[i] ?? null }));
  const bench = r.benchmark?.name || "Benchmark";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{String(d.strategy || "").replace(/^QODE ADVISORS LLP - /, "")}</p>
          <p className="text-xs text-muted-foreground">Since inception {fmtDate(d.inceptionDate)} · As of {fmtDate(d.asOf)}{date && d.asOf !== date ? ` (latest snapshot on or before ${fmtDate(date)})` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {picker}
          <PdfButton make={async () => factsheetPdf(d, accountId)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Portfolio value · ${fmtDate(d.valueDate)}`} value={inr(d.portfolioValue, 0)} />
        <Stat label="Profit / loss" value={sinr(d.profitLoss, 0)} className={tone(d.profitLoss)} />
        <Stat label="Contribution" value={inr(d.contribution, 0)} />
        <Stat label="Withdrawal" value={inr(d.withdrawal, 0)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {periods.length > 0 && (
          <Card className="shadow-none"><CardContent className="p-5">
            <h3 className="mb-3 text-lg">Performance (TWRR)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="py-1.5 text-left text-xs font-semibold text-muted-foreground"></th>{periods.map(p => <th key={p} className="py-1.5 text-right text-xs font-semibold text-muted-foreground">{periodLabel(p)}</th>)}</tr></thead>
                <tbody>
                  <tr className="border-t border-border/10"><td className="py-2 font-semibold">Portfolio</td>{(r.portfolio || []).map((v: number, i: number) => <td key={i} className={`py-2 text-right tabular-nums font-semibold ${tone(v)}`}>{pct(v)}</td>)}</tr>
                  {r.benchmark && <tr className="border-t border-border/10"><td className="py-2 text-muted-foreground">{bench}</td>{r.benchmark.values.map((v: number, i: number) => <td key={i} className="py-2 text-right tabular-nums text-muted-foreground">{pct(v)}</td>)}</tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.2} />
                  <XAxis dataKey="p" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: any) => pct(v as number)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
                  <Bar dataKey="Portfolio" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey={bench} fill="var(--primary-foreground)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">After management fees and other expenses. Returns over one year are annualised.</p>
          </CardContent></Card>
        )}
        {d.sectors.length > 0 && (
          <Card className="shadow-none"><CardContent className="space-y-3 p-5">
            <h3 className="mb-1 text-lg">Sector allocation</h3>
            {d.sectors.slice().sort((a: any, b: any) => (b.pct || 0) - (a.pct || 0)).map((x: any) => (
              <div key={x.sector}>
                <div className="flex justify-between text-sm"><span className="text-foreground">{x.sector}</span><span className="font-semibold tabular-nums">{(x.pct || 0).toFixed(2)}%</span></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(0.5, Math.min(100, x.pct || 0))}%` }} /></div>
              </div>))}
          </CardContent></Card>
        )}
      </div>
      {d.holdings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg">Portfolio holdings <span className="font-sans text-sm text-muted-foreground">· {d.holdings.length}</span></h3>
          <TableShell head={<><th className={th}>#</th><th className={th}>Security</th><th className={th}>Sector</th><th className={`${th} text-right`}>Market value</th><th className={`${th} text-right`}>% of assets</th></>}>
            {d.holdings.map((x: any, i: number) => (
              <tr key={i}>
                <td className={`${td} text-muted-foreground`}>{i + 1}</td>
                <td className={`${td} font-medium text-foreground`}>{x.security}</td>
                <td className={`${td} text-muted-foreground`}>{x.sector}</td>
                <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{inr(x.value, 0)}</td>
                <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{(x.pct || 0).toFixed(2)}%</td>
              </tr>))}
          </TableShell>
        </div>
      )}
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────────────────────────────────────────── */
const KINDS: [Kind, string][] = [["transactions", "Transactions"], ["capital-gains", "Capital gains"], ["expenses", "Expenses"], ["factsheet", "Fact sheet"]];
export default function ReportsPage() {
  const { clients, selectedClientCode, loading } = useClient();
  const accounts = useMemo(() => (clients || []).filter(c => c.clientcode), [clients]);
  const [accountId, setAccountId] = useState<string>("");
  const [kind, setKind] = useState<Kind>("transactions");
  const [rk, setRk] = useState(0);
  useEffect(() => { if (!accountId && (selectedClientCode || accounts[0]?.clientcode)) setAccountId(selectedClientCode || accounts[0].clientcode); }, [selectedClientCode, accounts, accountId]);
  const Body = { transactions: Transactions, "capital-gains": CapitalGains, expenses: Expenses, factsheet: Factsheet }[kind];
  const refresh = useCallback(() => setRk(x => x + 1), []);
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Statements for your Qode PMS account from our custodian, Nuvama. Download any of them as a PDF.</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && (
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map(c => <SelectItem key={c.clientcode} value={c.clientcode}>{c.clientcode}{c.holderName || c.clientname ? ` · ${c.holderName || c.clientname}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>
      <Tabs value={kind} onValueChange={v => setKind(v as Kind)}>
        <TabsList className="h-auto flex-wrap">
          {KINDS.map(([k, l]) => <TabsTrigger key={k} value={k} className="gap-2"><FileText className="h-4 w-4" />{l}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {loading && !accountId ? <Loading /> : !accountId ? <Empty>No active account found.</Empty> : <Body key={kind + accountId} accountId={accountId} rk={rk} />}
    </section>
  );
}
