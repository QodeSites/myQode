"use client"

// Distributor invoices: every invoice partners raised in the portal (Earnings → Invoice), with the invoice document,
// and the payment status. Marking one Paid records the date, amount, UTR and an optional payment proof, and emails
// the partner (partnerships@ in copy). API: /api/admin/bo/partner-invoices.
import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileText, Mail, Paperclip, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState, ErrorNote, KpiCard, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDate, fmtDateTime, useBackofficeAdmin } from "@/components/admin-kit"

type Status = "unpaid" | "on_hold" | "paid"
type Invoice = {
  id: number; partnerEmail: string; partnerName: string | null; legalName: string | null; gstin: string | null; pan: string | null; bank: string | null
  invoiceNumber: string; invoiceDate: string | null; periodLabel: string; amountBeforeTax: number; taxAmount: number; totalAmount: number; raisedAt: string
  status: Status; paidOn: string | null; paidAmount: number | null; paymentRef: string | null; paymentNote: string | null
  hasProof: boolean; hasDocument: boolean; statusUpdatedAt: string | null; statusUpdatedBy: string | null
}
type Data = { invoices: Invoice[]; totals: Record<Status, { count: number; amount: number }> }

const STATUS: Record<Status, [string, "red" | "amber" | "green"]> = { unpaid: ["Unpaid", "red"], on_hold: ["On hold", "amber"], paid: ["Paid", "green"] }
const inr = (v: number | null | undefined) => v == null ? "–" : "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const fileLink = (id: number, kind: "invoice" | "proof") => `/api/admin/bo/partner-invoices?file=${id}&kind=${kind}`

export default function PartnerInvoicesPage() {
  const { admin } = useBackofficeAdmin()
  const canEdit = admin?.level === "super"
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<"all" | Status>("unpaid")
  const [q, setQ] = useState("")
  const [edit, setEdit] = useState<Invoice | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await boFetch<Data>("/api/admin/bo/partner-invoices")) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.invoices || []).filter(r => (tab === "all" || r.status === tab) &&
      (!s || [r.partnerName, r.legalName, r.partnerEmail, r.invoiceNumber, r.periodLabel, r.paymentRef].some(v => String(v || "").toLowerCase().includes(s))))
  }, [data, tab, q])
  const t = data?.totals

  return (
    <div className="space-y-6">
      <PageHeader title="Distributor invoices" description="Invoices partners raised in the portal, and their payment. Marking one Paid emails the partner."
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>} />
      {error && <ErrorNote message={error} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard accent label="Unpaid" value={t ? inr(t.unpaid.amount) : "–"} hint={t ? `${t.unpaid.count} invoice${t.unpaid.count === 1 ? "" : "s"} to pay` : undefined} />
        <KpiCard label="On hold" value={t ? inr(t.on_hold.amount) : "–"} hint={t ? `${t.on_hold.count} invoice${t.on_hold.count === 1 ? "" : "s"}` : undefined} />
        <KpiCard label="Paid" value={t ? inr(t.paid.amount) : "–"} hint={t ? `${t.paid.count} invoice${t.paid.count === 1 ? "" : "s"}` : undefined} />
      </div>

      <Panel bodyClassName="p-0" title={
        <div className="flex flex-wrap gap-1.5">
          {(["unpaid", "on_hold", "paid", "all"] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${tab === k ? "border-[#02422B] bg-[#02422B] text-white" : "border-[#02422B]/20 text-[#02422B]"}`}>
              {k === "all" ? "All" : STATUS[k][0]}{t && k !== "all" ? ` · ${t[k].count}` : ""}
            </button>
          ))}
        </div>
      } action={
        <div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Partner, invoice no., UTR…" className="h-9 pl-8" /></div>
      }>
        {!data && loading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          : !rows.length ? <div className="p-6"><EmptyState title={tab === "unpaid" ? "Nothing to pay" : "No invoices"} description={tab === "unpaid" ? "Every invoice partners raised has been paid or put on hold." : "No invoice matches."} /></div>
          : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Partner</TableHead><TableHead>Invoice</TableHead><TableHead>Period</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead>Payment</TableHead><TableHead className="text-right" />
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{r.legalName || r.partnerName || r.partnerEmail}</div>
                      <div className="text-xs text-muted-foreground">{r.partnerEmail}{r.gstin ? ` · ${r.gstin}` : ""}</div></TableCell>
                    <TableCell><div className="font-medium">{r.invoiceNumber}</div><div className="text-xs text-muted-foreground">{fmtDate(r.invoiceDate)} · raised {fmtDateTime(r.raisedAt)}</div></TableCell>
                    <TableCell className="text-sm">{r.periodLabel}</TableCell>
                    <TableCell className="text-right tabular-nums"><div className="font-semibold">{inr(r.totalAmount)}</div>
                      <div className="text-xs text-muted-foreground">{inr(r.amountBeforeTax)} + GST {inr(r.taxAmount)}</div></TableCell>
                    <TableCell><Pill tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Pill></TableCell>
                    <TableCell className="text-xs">
                      {r.status === "paid" ? <><div>{fmtDate(r.paidOn)} · {inr(r.paidAmount)}</div><div className="text-muted-foreground">UTR {r.paymentRef}</div></>
                        : r.paymentNote ? <span className="text-muted-foreground">{r.paymentNote}</span> : <span className="text-muted-foreground">–</span>}
                      {r.hasProof && <a className="mt-0.5 flex items-center gap-1 text-[#02422B] underline" href={fileLink(r.id, "proof")} target="_blank" rel="noreferrer"><Paperclip className="h-3 w-3" />Proof</a>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.hasDocument && <Button asChild variant="ghost" size="sm"><a href={fileLink(r.id, "invoice")} target="_blank" rel="noreferrer"><FileText className="mr-1 h-4 w-4" />Invoice</a></Button>}
                        {canEdit && <Button size="sm" variant={r.status === "paid" ? "outline" : "default"} className={r.status === "paid" ? "" : "bg-[#02422B] text-white hover:bg-[#02422B]/90"} onClick={() => setEdit(r)}>{r.status === "paid" ? "Edit" : "Update status"}</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Panel>
      {!canEdit && <p className="text-xs text-muted-foreground">Updating a status needs backoffice (super) access.</p>}
      {edit && <StatusDialog inv={edit} adminEmail={admin?.email || ""} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </div>
  )
}

function StatusDialog({ inv, adminEmail, onClose, onSaved }: { inv: Invoice; adminEmail: string; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<Status>("paid")   // the usual action; Unpaid / On hold one click away
  const [paidOn, setPaidOn] = useState(inv.paidOn || today())
  const [amount, setAmount] = useState(String(inv.paidAmount ?? inv.totalAmount))
  const [ref, setRef] = useState(inv.paymentRef || "")
  const [note, setNote] = useState(inv.paymentNote || "")
  const [file, setFile] = useState<File | null>(null)
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState<"" | "save" | "test">("")
  const [errs, setErrs] = useState<Record<string, string>>({})

  const submit = async (test: boolean) => {
    setBusy(test ? "test" : "save"); setErrs({})
    const fd = new FormData()
    fd.append("id", String(inv.id)); fd.append("status", status)
    if (status === "paid") { fd.append("paidOn", paidOn); fd.append("paidAmount", amount); fd.append("paymentRef", ref) }
    if (note.trim()) fd.append("note", note.trim())
    if (file) fd.append("file", file)
    fd.append("notify", notify ? "1" : "0")
    if (test) fd.append("testTo", adminEmail)
    try {
      const r = await fetch("/api/admin/bo/partner-invoices", { method: "POST", body: fd, credentials: "same-origin" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErrs(j.errors || {}); throw new Error(j.error || `HTTP ${r.status}`) }
      if (test) { j.email?.sent ? toast.success(`Test email sent to ${adminEmail}`) : toast.error(`Test email not sent: ${j.email?.error || "unknown"}`); return }
      toast.success(status === "paid" ? `Invoice ${inv.invoiceNumber} marked paid` + (j.email ? (j.email.sent ? " · partner emailed" : ` · email failed: ${j.email.error}`) : "") : `Invoice ${inv.invoiceNumber} marked ${status === "on_hold" ? "on hold" : "unpaid"}`)
      onSaved()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy("") }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invoice {inv.invoiceNumber}</DialogTitle>
          <DialogDescription>{inv.legalName || inv.partnerName || inv.partnerEmail} · {inv.periodLabel} · {inr(inv.totalAmount)}{inv.bank ? <><br />Pay to: {inv.bank}</> : null}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(["unpaid", "on_hold", "paid"] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${status === s ? "border-[#02422B] bg-[#02422B] text-white" : "border-[#02422B]/20"}`}>{STATUS[s][0]}</button>
            ))}
          </div>
          {status === "paid" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Paid on *<Input type="date" value={paidOn} max={today()} onChange={e => setPaidOn(e.target.value)} />{errs.paidOn && <span className="text-xs text-red-600">{errs.paidOn}</span>}</label>
              <label className="text-sm">Amount paid (₹) *<Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />{errs.paidAmount && <span className="text-xs text-red-600">{errs.paidAmount}</span>}</label>
              <label className="text-sm sm:col-span-2">UTR / transaction reference *<Input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. HDFCR52026100612345" />{errs.paymentRef && <span className="text-xs text-red-600">{errs.paymentRef}</span>}</label>
              <label className="text-sm sm:col-span-2">Payment proof (PDF, JPG or PNG, optional)
                <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] || null)} />
                {inv.hasProof && !file && <span className="text-xs text-muted-foreground">A proof is already saved; a new file replaces it.</span>}
              </label>
            </div>
          )}
          {status !== "unpaid" && (
            <label className="block text-sm">{status === "paid" ? "Note to the partner (optional)" : "Reason (shown to the partner)"}
              <Textarea rows={2} className="min-h-[64px]" value={note} onChange={e => setNote(e.target.value)} placeholder={status === "paid" ? "e.g. Paid net of TDS of ₹…" : "e.g. GSTIN on the invoice doesn’t match our records"} /></label>
          )}
          {status === "paid" && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={notify} onCheckedChange={v => setNotify(!!v)} />Email the partner that it’s paid (partnerships@ in copy)</label>
          )}
          {status === "unpaid" && inv.status === "paid" && <p className="text-xs text-amber-700">This clears the payment details. The partner is not emailed.</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {status === "paid" ? <Button variant="outline" onClick={() => submit(true)} disabled={!!busy}><Mail className="mr-1.5 h-4 w-4" />{busy === "test" ? "Sending…" : `Send test to me`}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
            <Button className="bg-[#02422B] text-white hover:bg-[#02422B]/90" onClick={() => submit(false)} disabled={!!busy}><CheckCircle2 className="mr-1.5 h-4 w-4" />{busy === "save" ? "Saving…" : status === "paid" ? (notify ? "Mark paid & email" : "Mark paid") : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
