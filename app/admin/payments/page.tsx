"use client"

// Payments: record a cheque or direct bank transfer when the money reaches Qode. The client then gets the same
// "Payment received" notification and "On its way" card (with the invest / visible dates) as a Razorpay payer, and
// the card clears itself once Nuvama's data shows the money. API: /api/admin/bo/payments.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Banknote, RefreshCw, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EmptyState, ErrorNote, PageHeader, Panel, Pill, boFetch, errorMessage, fmtDateTime } from "@/components/admin-kit"

type Account = { accountId: string; name: string; email: string; strategy: string }
type Recent = { orderId: string; source?: string; accountId: string; name: string; strategy: string; amount: number; receivedAt: string; channel: string | null; reference: string | null; recordedBy: string | null; deployOn: string; visibleOn: string; state: "on_its_way" | "late" | "in_portfolio" | "cancelled" }

const CHANNELS: [string, string][] = [["neft", "NEFT"], ["rtgs", "RTGS"], ["imps", "IMPS"], ["cheque", "Cheque"], ["upi", "UPI to bank"]]
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const day = (d: string) => { const x = new Date(d.slice(0, 10) + "T00:00:00Z"); return isNaN(+x) ? "" : `${WD[x.getUTCDay()]} ${x.getUTCDate()} ${MO[x.getUTCMonth()]}` }
const rupees = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 })
const istNow = () => { const x = new Date(Date.now() + 330 * 60000).toISOString(); return { date: x.slice(0, 10), time: x.slice(11, 16) } }
const STATE: Record<Recent["state"], [string, "gold" | "red" | "green" | "grey"]> = {
  on_its_way: ["On its way", "gold"], late: ["Late: not in Nuvama's data yet", "red"], in_portfolio: ["In portfolio", "green"], cancelled: ["Cancelled", "grey"],
}

export default function AdminPaymentsPage() {
  const now = istNow()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Account[]>([])
  const [acct, setAcct] = useState<Account | null>(null)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(now.date)
  const [time, setTime] = useState(now.time)
  const [channel, setChannel] = useState("neft")
  const [reference, setReference] = useState("")
  const [notify, setNotify] = useState(true)
  const [preview, setPreview] = useState<{ deployLabel: string; visibleLabel: string } | null>(null)
  const [confirm, setConfirm] = useState<null | "record" | "duplicate">(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<Recent[] | null>(null)
  const [zoho, setZoho] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancel, setCancel] = useState<Recent | null>(null)

  const receivedAt = `${date}T${time || "00:00"}:00+05:30`
  const amt = Number(amount.replace(/,/g, ""))
  const problem = !acct ? "Choose the client account" : !(amt >= 1000) ? "Enter the amount received" : !date || !time ? "Enter when it was received" : ""

  const loadRecent = useCallback(async () => {
    setError(null)
    try { const r = await boFetch<{ recent: Recent[]; zoho: any }>("/api/admin/bo/payments"); setRecent(r.recent); setZoho(r.zoho) } catch (e) { setError(errorMessage(e)) }
  }, [])
  useEffect(() => { loadRecent() }, [loadRecent])

  // client search (debounced)
  useEffect(() => {
    if (acct || q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      try { setResults((await boFetch<{ accounts: Account[] }>(`/api/admin/bo/payments?q=${encodeURIComponent(q.trim())}`)).accounts) } catch { setResults([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [q, acct])

  // live preview of the dates
  useEffect(() => {
    if (!acct || !date || !time) { setPreview(null); return }
    const t = setTimeout(async () => {
      try { setPreview(await boFetch("/api/admin/bo/payments", { method: "POST", json: { accountId: acct.accountId, amount: Math.max(amt, 1000), receivedAt, channel, dryRun: true } })) } catch { setPreview(null) }
    }, 250)
    return () => clearTimeout(t)
  }, [acct, date, time, channel, amt, receivedAt])

  async function record(confirmDuplicate = false) {
    setBusy(true)
    try {
      const r = await boFetch<{ notified: number }>("/api/admin/bo/payments", { method: "POST", json: { accountId: acct!.accountId, amount: amt, receivedAt, channel, reference, notify, confirmDuplicate } })
      toast.success(`Recorded. ${notify ? (r.notified ? `${r.notified} ${r.notified === 1 ? "login was" : "logins were"} notified.` : "Nobody to notify on the app for this account.") : "The client was not notified."}`)
      setConfirm(null); setAcct(null); setQ(""); setAmount(""); setReference(""); const n = istNow(); setDate(n.date); setTime(n.time)
      loadRecent()
    } catch (e: any) {
      if (e?.status === 409 || /already recorded/i.test(errorMessage(e))) setConfirm("duplicate")
      else { toast.error(errorMessage(e)); setConfirm(null) }
    } finally { setBusy(false) }
  }

  async function doCancel() {
    if (!cancel) return
    try { await boFetch(`/api/admin/bo/payments?orderId=${encodeURIComponent(cancel.orderId)}`, { method: "DELETE" }); toast.success("Cancelled."); loadRecent() }
    catch (e) { toast.error(errorMessage(e)) } finally { setCancel(null) }
  }

  const summary = useMemo(() => acct ? `${rupees(amt || 0)} from ${acct.name} (${acct.accountId}, ${acct.strategy}) by ${CHANNELS.find(([k]) => k === channel)?.[1]}${reference ? `, ref ${reference}` : ""}, received ${day(date)} at ${time}` : "", [acct, amt, channel, reference, date, time])

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Record cheques and direct bank transfers when the money reaches Qode, so the client sees when it will be invested, just like a Razorpay payment."
        actions={<Button variant="outline" size="sm" onClick={loadRecent}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      {error ? <ErrorNote message={error} onRetry={loadRecent} /> : null}
      {zoho?.Capital_Inflows ? (
        <div className="rounded-lg border border-[#02422B]/15 bg-white/60 px-4 py-3 text-sm">
          <span className="font-medium">Synced from Zoho automatically.</span> Every Verified entry in Capital Inflows appears here within 5 minutes
          (Razorpay payments are matched, never doubled). Last sync {zoho.Capital_Inflows.last?.at ? fmtDateTime(zoho.Capital_Inflows.last.at) : "not yet"}
          {zoho.Capital_Inflows.lastError && (!zoho.Capital_Inflows.last?.at || zoho.Capital_Inflows.lastError.at > zoho.Capital_Inflows.last.at) ? <span className="text-red-700"> · last error: {zoho.Capital_Inflows.lastError.error}</span> : null}.
          Use the form below only for money that isn't in Zoho.
        </div>) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Record a payment received" description="Received before 4 pm on a trading day: invested the next trading day, and in the portfolio the trading day after.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[#002017]">Client account</span>
              {acct ? (
                <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2 text-sm">
                  <span><span className="font-medium">{acct.name}</span> · {acct.accountId} · {acct.strategy}<span className="block text-xs text-muted-foreground">{acct.email}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => { setAcct(null); setQ("") }}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, account code, email or PAN" className="bg-white pl-9" />
                  {results.length ? (
                    <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-white shadow-lg">
                      {results.map((r) => (
                        <button key={r.accountId} onClick={() => { setAcct(r); setResults([]) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-[#EFECD3]">
                          <span className="font-medium">{r.name}</span> · {r.accountId} · {r.strategy}<span className="block text-xs text-muted-foreground">{r.email}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block space-y-1.5"><span className="text-xs font-medium text-[#002017]">Amount received (₹)</span>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="500000" className="bg-white" /></label>
              <label className="block space-y-1.5"><span className="text-xs font-medium text-[#002017]">Received on</span>
                <Input type="date" value={date} max={now.date} onChange={(e) => setDate(e.target.value)} className="bg-white" /></label>
              <label className="block space-y-1.5"><span className="text-xs font-medium text-[#002017]">At (India time)</span>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-white" /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5"><span className="text-xs font-medium text-[#002017]">How it came in</span>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-9 w-full rounded-md border bg-white px-3 text-sm">
                  {CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="block space-y-1.5"><span className="text-xs font-medium text-[#002017]">Reference <span className="text-muted-foreground">(UTR or cheque no., optional)</span></span>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} className="bg-white" maxLength={60} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[#02422B]" />
              Notify the client in the app now ("Payment received", with the dates)</label>
            <div className="flex flex-wrap items-center gap-3 border-t border-[#02422B]/10 pt-4">
              <Button onClick={() => setConfirm("record")} disabled={!!problem || busy}><Banknote className="h-4 w-4" />Record payment…</Button>
              {problem ? <span className="text-xs text-muted-foreground">{problem}</span> : null}
            </div>
          </div>
        </Panel>

        <Panel title="What the client will see" description="Worked out from the time it was received">
          {preview ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span className="font-medium">{day(date)}, {time}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Invested on</span><span className="font-medium">{preview.deployLabel}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">In the portfolio on</span><span className="font-medium">{preview.visibleLabel}</span></div>
              <p className="rounded-md bg-white/70 p-3 text-xs text-stone-700">“We have received your {amt >= 1000 ? rupees(amt) : "₹…"} for {acct?.strategy || "…"}. It will be invested on {preview.deployLabel} and show in your portfolio on {preview.visibleLabel}.”</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">Choose the account and when the money arrived to see the dates.</p>}
        </Panel>
      </div>

      <Panel title="Recorded in the last 60 days" description="“In portfolio” once Nuvama's data shows the money. “Late” means it should have appeared by now: check with operations." bodyClassName="p-0">
        {recent && recent.length ? (
          <Table><TableHeader><TableRow>
            <TableHead>Received</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>How</TableHead>
            <TableHead>Invested / visible</TableHead><TableHead>Status</TableHead><TableHead>By</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{recent.map((r) => (
              <TableRow key={r.orderId}>
                <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.receivedAt)}</TableCell>
                <TableCell><p className="text-sm font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.accountId} · {r.strategy}</p></TableCell>
                <TableCell className="text-right tabular-nums">{rupees(r.amount)}</TableCell>
                <TableCell className="text-xs">{CHANNELS.find(([k]) => k === r.channel)?.[1] ?? r.channel}{r.reference ? <span className="block text-muted-foreground">{r.reference}</span> : null}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{day(r.deployOn)} / {day(r.visibleOn)}</TableCell>
                <TableCell><Pill tone={STATE[r.state][1]}>{STATE[r.state][0]}</Pill></TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.source === "Zoho" ? <Pill tone="blue">Zoho</Pill> : r.recordedBy}</TableCell>
                <TableCell>{(r.state === "on_its_way" || r.state === "late") && r.source !== "Zoho" ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCancel(r)}>Cancel</Button> : null}</TableCell>
              </TableRow>))}
            </TableBody></Table>
        ) : <EmptyState title="Nothing recorded yet" description="Cheques and transfers you record will show here." icon={<Banknote className="h-5 w-5" />} />}
      </Panel>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o && !busy) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "duplicate" ? "This looks already recorded" : "Record this payment?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "duplicate" ? `A payment of the same amount for ${acct?.accountId} was recorded recently. Record it again only if it's a separate payment.` : summary + "."}
              {confirm === "record" && notify ? " The client is notified in the app straight away." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); record(confirm === "duplicate") }}>{busy ? "Recording…" : confirm === "duplicate" ? "Record anyway" : "Record"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cancel} onOpenChange={(o) => { if (!o) setCancel(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Cancel this entry?</AlertDialogTitle>
            <AlertDialogDescription>{cancel ? `${rupees(cancel.amount)} for ${cancel.name} (${cancel.accountId}). The "On its way" card disappears from their app. Use this only for an entry recorded by mistake.` : ""}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={doCancel}>Cancel entry</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
