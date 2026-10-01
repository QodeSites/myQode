// /pay — public demonstration of how myQode clients add money to their Qode PMS account with Razorpay (for the payment
// gateway's website review). Same Razorpay Checkout the myQode app opens from "Add funds"; real top-ups only happen
// signed in, in the app. Orders are tagged demo=true and nothing is recorded (app/api/razorpay-demo/*).
"use client"

import { useEffect, useState } from "react"
import Script from "next/script"

const STRATEGIES = [
  { name: "Qode All Weather", note: "Multi-asset portfolio for consistent long-term performance" },
  { name: "Qode Growth Fund", note: "Factor-based small-cap strategy" },
  { name: "Qode Tactical Fund", note: "Momentum strategy with a hedge overlay" },
]
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 })

declare global { interface Window { Razorpay?: any } }

export default function PayPage() {
  const [strategy, setStrategy] = useState(STRATEGIES[0].name)
  const [amount, setAmount] = useState("100")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const [done, setDone] = useState<null | { ok: boolean; status: string; amount: number; paymentId: string; method: string | null }>(null)
  const [mode, setMode] = useState<string>("")

  useEffect(() => { if (window.Razorpay) setReady(true) }, [])

  const pay = async () => {
    setErr(""); setDone(null)
    const amt = Number(amount)
    if (!(amt >= 1 && amt <= 100000)) { setErr("Enter an amount between ₹1 and ₹1,00,000."); return }
    if (!window.Razorpay) { setErr("The payment window is still loading. Please try again in a moment."); return }
    setBusy(true)
    try {
      const res = await fetch("/api/razorpay-demo/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amt, strategy, name, email }) })
      const o = await res.json()
      if (!res.ok) throw new Error(o.error || "Could not start the payment.")
      setMode(o.environment)
      const rz = new window.Razorpay({
        key: o.keyId, order_id: o.orderId, amount: Math.round(o.amount * 100), currency: "INR",
        name: "Qode Advisors LLP", description: `Add funds · ${strategy}`,
        prefill: { name: name || undefined, email: email || undefined },
        notes: { strategy, source: "myqode_web_demo" },
        theme: { color: "#02422B" },
        handler: async (r: any) => {
          try {
            const v = await fetch("/api/razorpay-demo/verify", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }) })
            const j = await v.json()
            setDone({ ok: !!j.ok, status: j.status || (j.error ? "failed" : "unknown"), amount: j.amount || amt, paymentId: r.razorpay_payment_id, method: j.method || null })
          } catch { setDone({ ok: false, status: "unknown", amount: amt, paymentId: r.razorpay_payment_id, method: null }) }
          setBusy(false)
        },
        modal: { ondismiss: () => setBusy(false) },
      })
      rz.on("payment.failed", (r: any) => { setErr(r?.error?.description || "The payment did not go through. No money was taken."); setBusy(false) })
      rz.open()
    } catch (e: any) {
      setErr(e.message || "Could not start the payment."); setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#EFECD3] text-[#002017]">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onLoad={() => setReady(true)} />
      <header className="bg-[#02422B] text-[#EFECD3]">
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center justify-between">
          <div>
            <div className="font-serif text-2xl" style={{ fontFamily: "var(--font-playfair)" }}>myQode</div>
            <div className="text-xs opacity-70">Qode Advisors LLP · SEBI Registered Portfolio Manager</div>
          </div>
          <a href="/login" className="text-sm underline underline-offset-4 opacity-90">Client sign in</a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl md:text-3xl font-semibold" style={{ fontFamily: "var(--font-playfair)" }}>Add funds to your Qode portfolio</h1>
        <p className="mt-2 text-sm leading-6 text-[#37584F]">
          Qode Advisors LLP manages investment portfolios (PMS) for its clients. Clients add money to their own portfolio account from the
          myQode app (Home → Add funds) and pay securely with Razorpay by UPI, net banking or card. The money is invested in the strategy they choose.
        </p>
        <div className="mt-4 rounded-md border border-[#DABD38] bg-white/60 px-4 py-3 text-sm leading-6">
          <b>Payment demonstration.</b> This page shows the exact Razorpay checkout our clients use. Real top-ups are made only by signed-in
          clients in the myQode app and are credited to their own account. A payment made on this page is not invested and is not linked to any
          client account.{mode === "test" ? " (Test mode: no real money moves.)" : ""}
        </div>

        {done ? (
          <div className={`mt-6 rounded-lg border p-5 ${done.ok ? "border-green-700 bg-green-50" : "border-red-700 bg-red-50"}`}>
            <div className="text-lg font-semibold">{done.ok ? "Payment received" : "Payment not completed"}</div>
            <div className="mt-1 text-sm leading-6">
              {done.ok
                ? <>We received {inr(done.amount)} for {strategy}{done.method ? ` by ${done.method}` : ""}. In the myQode app the client would now see the
                    date the money is invested and when it appears in their portfolio.</>
                : <>Razorpay reports the status as “{done.status}”. No money was taken.</>}
            </div>
            <div className="mt-2 text-xs text-[#37584F]">Payment ID: {done.paymentId}</div>
            <button onClick={() => setDone(null)} className="mt-4 rounded-md border border-[#02422B] px-4 py-2 text-sm font-semibold">Make another payment</button>
          </div>
        ) : (
          <div className="mt-6 rounded-lg bg-white p-5 shadow-sm">
            <label className="block text-xs font-bold tracking-wider text-[#37584F]">STRATEGY</label>
            <div className="mt-2 grid gap-2">
              {STRATEGIES.map(s => (
                <button key={s.name} type="button" onClick={() => setStrategy(s.name)}
                  className={`text-left rounded-md border px-4 py-3 ${strategy === s.name ? "border-[#02422B] bg-[#02422B]/5" : "border-[#37584F]/20"}`}>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-[#37584F]">{s.note}</div>
                </button>
              ))}
            </div>

            <label className="mt-5 block text-xs font-bold tracking-wider text-[#37584F]">AMOUNT (₹)</label>
            <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal"
              className="mt-2 w-full rounded-md border border-[#37584F]/30 px-3 py-2 text-lg" />
            <div className="mt-1 text-xs text-[#37584F]">Clients add ₹100 or more in the app; any amount from ₹1 works on this demonstration.</div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-bold tracking-wider text-[#37584F]">NAME (OPTIONAL)</label>
                <input value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-md border border-[#37584F]/30 px-3 py-2" />
              </div>
              <div>
                <label className="block text-xs font-bold tracking-wider text-[#37584F]">EMAIL (OPTIONAL)</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="mt-2 w-full rounded-md border border-[#37584F]/30 px-3 py-2" />
              </div>
            </div>

            {!!err && <div className="mt-4 text-sm text-red-700">{err}</div>}
            <button onClick={pay} disabled={busy || !ready}
              className="mt-5 w-full rounded-md bg-[#02422B] px-4 py-3 font-semibold text-[#EFECD3] disabled:opacity-60">
              {busy ? "Opening Razorpay…" : !ready ? "Loading payment…" : `Pay ${Number(amount) ? inr(Number(amount)) : ""} with Razorpay`}
            </button>
            <div className="mt-2 text-center text-xs text-[#37584F]">Secured by Razorpay · UPI, net banking and cards</div>
          </div>
        )}

        <section className="mt-8 text-sm leading-6 text-[#37584F]">
          <h2 className="text-base font-semibold text-[#002017]">How it works in the myQode app</h2>
          <ol className="mt-2 list-decimal pl-5">
            <li>The client signs in to the myQode app with their registered email and password.</li>
            <li>On Home they tap <b>Add funds</b>, pick their strategy account and enter the amount.</li>
            <li>Razorpay Checkout opens (as above); the client pays by UPI, net banking or card.</li>
            <li>We verify the payment with Razorpay and the client sees “Payment received” with the date it will be invested.</li>
          </ol>
        </section>
      </main>

      <footer className="border-t border-[#37584F]/20">
        <div className="mx-auto max-w-3xl px-5 py-6 text-xs leading-6 text-[#37584F]">
          <div className="flex flex-wrap gap-x-5 gap-y-1 font-semibold">
            <a href="/termsandcondition" className="underline underline-offset-2">Terms &amp; Conditions</a>
            <a href="/privacypolicy" className="underline underline-offset-2">Privacy Policy</a>
            <a href="/cancellation" className="underline underline-offset-2">Refund &amp; Cancellation</a>
            <a href="/contactus" className="underline underline-offset-2">Contact us</a>
          </div>
          <div className="mt-3">
            Qode Advisors LLP · 2nd Floor, Tree Building, Raghuvanshi Mills Compound, Gandhi Nagar, Upper Worli, Lower Parel, Mumbai, Maharashtra 400013, India ·
            investor.relations@qodeinvest.com · +91 98203 00028
          </div>
        </div>
      </footer>
    </div>
  )
}
