"use client";

// ============================================================================
// Payment flow demonstration — /demo
//
// SECURITY NOTE, please read before changing anything here:
//
// The "sign in" on this page is a string comparison held in React state. It
// deliberately does NOT set the `qode-auth` cookie, call any auth endpoint, or
// create a session. Signing in here grants access to this page's own local
// state and nothing else — there is no path from here into the real portal.
//
// That is the entire reason the demo credentials can be shared publicly. If you
// are tempted to "make it more realistic" by wiring this to the real login,
// don't: it would turn a shareable demo into a working credential for a system
// holding live client portfolios.
//
// Every figure below is invented. No API is called, no database is read, and no
// payment is ever created — the Razorpay step is simulated so the viewer can
// pick which outcome to see, including the failure branches.
// ============================================================================

import { useState, useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";

// ── Demo credentials ─────────────────────────────────────────────────────────
const DEMO_EMAIL = "test@razorpay.com";
const DEMO_PASSWORD = "RazorPay@123";

// ── Sample portfolio (illustrative — not real holdings) ─────────────────────
const HOLDINGS = [
  { name: "Qode All Weather", code: "QAW", colour: "#008455", invested: 8000000, value: 9984000, ret: 24.8 },
  { name: "Qode Growth Fund", code: "QGF", colour: "#0A3452", invested: 4500000, value: 5512500, ret: 22.5 },
  { name: "Qode Tactical Fund", code: "QTF", colour: "#550E0E", invested: 2500000, value: 2955800, ret: 18.23 },
];

const TOTAL_VALUE = HOLDINGS.reduce((s, h) => s + h.value, 0);
const TOTAL_INVESTED = HOLDINGS.reduce((s, h) => s + h.invested, 0);
const GAIN = TOTAL_VALUE - TOTAL_INVESTED;

const MIN_AMOUNT = 100;
const MAX_AMOUNT = 500000;   // matches the verified Razorpay per-transaction ceiling

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

type Mode = "one_time" | "sip";
type Step = "amount" | "confirm" | "checkout" | "processing" | "result";
type Outcome = "ok" | "fail" | "cancel" | "net" | "hold";

// ── Login ────────────────────────────────────────────────────────────────────

function SignIn({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
      setError("That email and password don't match. Use the demo credentials shown below.");
      return;
    }
    setError("");
    onSuccess();
  };

  return (
    <div className="min-h-screen grid place-items-center px-5 py-8">
      <div className="w-full max-w-[404px] bg-card border border-border/20 rounded-xl shadow-sm p-8">
        <div className="flex flex-col items-center gap-3 mb-7">
          <div className="w-12 h-12 rounded-full bg-primary grid place-items-center text-primary-foreground font-serif text-[22px]">
            Q
          </div>
          <h1 className="font-serif text-[2rem] text-primary dark:text-primary-foreground">myQode</h1>
          <p className="text-[13.5px] text-muted-foreground text-center">
            Investor portal · Qode Advisors LLP
          </p>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5 mb-4">
            <label htmlFor="demo-email" className="text-[13px] font-bold text-muted-foreground">
              Email or Account ID
            </label>
            <input
              id="demo-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com or Account ID"
              className="border border-border/20 rounded-md px-3.5 py-3 bg-background text-foreground text-[15px] w-full focus-visible:outline-2 focus-visible:outline-primary-foreground"
            />
          </div>

          <div className="flex flex-col gap-1.5 mb-4">
            <label htmlFor="demo-password" className="text-[13px] font-bold text-muted-foreground">
              Password
            </label>
            <input
              id="demo-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="border border-border/20 rounded-md px-3.5 py-3 bg-background text-foreground text-[15px] w-full focus-visible:outline-2 focus-visible:outline-primary-foreground"
            />
          </div>

          <p className="text-destructive text-[13px] min-h-[18px] mb-3" role="alert">{error}</p>

          <button
            type="submit"
            className="w-full rounded-md bg-primary text-primary-foreground font-bold text-[15px] py-3 min-h-[46px] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
          >
            Sign in
          </button>
        </form>

        <div className="mt-5 p-3.5 rounded-md border border-dashed border-border/30 text-[12.8px] text-muted-foreground leading-relaxed">
          <span className="font-bold text-foreground">Demo credentials</span>
          <br />
          <code className="text-foreground">{DEMO_EMAIL}</code>
          <br />
          <code className="text-foreground">{DEMO_PASSWORD}</code>
          <span className="block mt-2">
            This is a self-contained demonstration. It holds no real client data and is not connected
            to the live portal.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Payment modal ────────────────────────────────────────────────────────────

function PaymentModal({
  mode,
  onClose,
}: {
  mode: Mode;
  onClose: () => void;
}) {
  const isSip = mode === "sip";
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState(isSip ? 25000 : 100000);
  const [frequency, setFrequency] = useState<"monthly" | "quarterly">("monthly");
  const [outcome, setOutcome] = useState<Outcome>("ok");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the dialog on open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The simulated gateway round-trip.
  useEffect(() => {
    if (step !== "processing") return;
    const t = setTimeout(() => setStep("result"), outcome === "cancel" ? 600 : 1250);
    return () => clearTimeout(t);
  }, [step, outcome]);

  const proceed = () => {
    if (!amount || amount < MIN_AMOUNT) { setError(`Please enter at least ${inr(MIN_AMOUNT)}.`); return; }
    if (amount > MAX_AMOUNT) { setError(`The maximum for a single transaction is ${inr(MAX_AMOUNT)}.`); return; }
    setError("");
    setStep("confirm");
  };

  const run = (o: Outcome) => { setOutcome(o); setStep("processing"); };

  const presets = isSip ? [10000, 25000, 50000] : [50000, 100000, 250000];

  const btn = "w-full rounded-md bg-primary text-primary-foreground font-bold text-[14.5px] py-3 min-h-[46px] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground";
  const btnGhost = "w-full rounded-md bg-transparent text-muted-foreground border border-border/25 font-bold text-[14.5px] py-3 min-h-[46px] hover:border-primary hover:text-foreground transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-5 overflow-y-auto bg-[rgba(0,32,23,0.55)]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        className="w-full max-w-[412px] bg-card rounded-xl overflow-hidden shadow-lg"
      >
        {/* header */}
        {step === "checkout" || step === "processing" ? (
          <div className="flex items-center justify-between px-5 py-3 bg-primary text-primary-foreground text-[11.5px] font-bold tracking-wider uppercase">
            <span>Razorpay secure checkout</span>
            <span>Test mode</span>
          </div>
        ) : (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/15">
            <h3 id="demo-modal-title" className="font-serif text-[1.08rem]">
              {step === "amount" && (isSip ? "Start a SIP" : "Add funds")}
              {step === "confirm" && `Confirm ${isSip ? "SIP" : "investment"}`}
              {step === "result" && RESULTS[outcome](isSip, amount, frequency).title}
            </h3>
            <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="px-5 pt-5 pb-6 flex flex-col gap-4">
          {/* ---- amount ---- */}
          {step === "amount" && (
            <>
              <div className="text-center pt-1">
                <div className="text-[10.5px] font-bold tracking-[0.13em] uppercase text-muted-foreground">
                  {isSip ? "Monthly amount" : "Amount to invest"}
                </div>
                <div className="font-serif text-[2.5rem] leading-tight mt-1 tabular-nums">{inr(amount)}</div>
                <div className="text-[12.5px] text-muted-foreground mt-1">
                  Minimum {inr(MIN_AMOUNT)} · maximum {inr(MAX_AMOUNT)} per transaction
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="demo-amount" className="text-[13px] font-bold text-muted-foreground">Amount (₹)</label>
                <input
                  id="demo-amount"
                  type="text"
                  inputMode="numeric"
                  value={amount || ""}
                  onChange={(e) => setAmount(parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
                  className="border border-border/20 rounded-md px-3.5 py-3 bg-background text-foreground text-[15px] w-full tabular-nums focus-visible:outline-2 focus-visible:outline-primary-foreground"
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                {presets.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold border transition-all ${
                      amount === v
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-transparent border-border/25 text-muted-foreground hover:border-primary hover:text-foreground"
                    }`}
                  >
                    {inr(v)}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-bold text-muted-foreground">Strategy</label>
                <div className="border border-border/20 rounded-md px-3.5 py-3 bg-background text-[15px]">
                  Qode All Weather · QAW0001
                </div>
              </div>

              {isSip && (
                <div className="flex gap-2">
                  {(["monthly", "quarterly"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFrequency(f)}
                      className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold border capitalize transition-all ${
                        frequency === f
                          ? "bg-primary border-primary text-primary-foreground"
                          : "bg-transparent border-border/25 text-muted-foreground hover:border-primary hover:text-foreground"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}

              {error && <p className="text-destructive text-[13px]">{error}</p>}
              <button onClick={proceed} className={btn}>
                {isSip ? "Proceed with SIP" : "Proceed with payment"}
              </button>
            </>
          )}

          {/* ---- confirm ---- */}
          {step === "confirm" && (
            <>
              <div className="text-center pt-1">
                <div className="text-[10.5px] font-bold tracking-[0.13em] uppercase text-muted-foreground">
                  {isSip ? "Monthly investment" : "You are investing"}
                </div>
                <div className="font-serif text-[2.5rem] leading-tight mt-1 tabular-nums">{inr(amount)}</div>
                <div className="text-[12.5px] text-muted-foreground mt-1">Demo Investor · QAW0001</div>
              </div>

              <dl className="flex flex-col gap-2 text-[13.5px]">
                <Row k="Strategy" v="Qode All Weather" />
                <Row k="Debited from" v="HDFC ····9412" />
                {isSip && <Row k="Frequency" v={frequency[0].toUpperCase() + frequency.slice(1)} />}
                {isSip && <Row k="First charge" v="01 Sep 2026" />}
              </dl>

              <p className="text-[13.8px] text-muted-foreground leading-relaxed">
                {isSip
                  ? "You will authorise an auto-debit mandate on the next screen. Your bank account must match the one registered with us."
                  : "You will be taken to Razorpay's secure payment window."}
              </p>

              <button onClick={() => setStep("checkout")} className={btn}>
                Confirm and {isSip ? "authorise" : "pay"}
              </button>
              <button onClick={() => setStep("amount")} className={btnGhost}>Back</button>
            </>
          )}

          {/* ---- checkout ---- */}
          {step === "checkout" && (
            <>
              <div className="text-center pt-1">
                <div className="text-[10.5px] font-bold tracking-[0.13em] uppercase text-muted-foreground">
                  Paying Qode Advisors LLP
                </div>
                <div className="font-serif text-[2.5rem] leading-tight mt-1 tabular-nums">{inr(amount)}</div>
                {isSip && (
                  <div className="text-[12.5px] text-muted-foreground mt-1">Auto-debit mandate · {frequency}</div>
                )}
              </div>

              <p className="text-[13.8px] text-muted-foreground leading-relaxed">
                <span className="font-bold text-foreground">Choose how this demo should end.</span>{" "}
                Each option shows a real outcome the integration handles.
              </p>

              <button onClick={() => run("ok")} className={btn}>
                Pay with UPI — success@razorpay
              </button>
              <button onClick={() => run("fail")} className={btnGhost}>
                Pay with UPI — failure@razorpay
              </button>
              <button onClick={() => run(isSip ? "hold" : "net")} className={btnGhost}>
                {isSip ? "Authorise via UPI Autopay (unverifiable payer)" : "Lose connection after the debit"}
              </button>
              <button onClick={() => run("cancel")} className={btnGhost}>
                Close the window without paying
              </button>
            </>
          )}

          {/* ---- processing ---- */}
          {step === "processing" && (
            <div className="min-h-[190px] flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-9 h-9 rounded-full border-[2.5px] border-border/25 border-t-primary animate-spin motion-reduce:animate-none" />
              <p className="text-[13.8px] text-muted-foreground">
                {outcome === "cancel" ? "Closing…" : "Contacting your bank…"}
              </p>
            </div>
          )}

          {/* ---- result ---- */}
          {step === "result" && (
            <Result
              data={RESULTS[outcome](isSip, amount, frequency)}
              onDone={() => (outcome === "fail" || outcome === "cancel" ? setStep("amount") : onClose())}
              retry={outcome === "fail" || outcome === "cancel"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`font-bold text-right break-all ${mono ? "font-mono text-[12.4px] font-normal" : ""}`}>{v}</dd>
    </div>
  );
}

// ── Outcome copy ─────────────────────────────────────────────────────────────
// Wording matters more than it looks here: a payment that may have succeeded is
// never described as failed, because that is what makes an investor pay twice.

const PAY_ID = "pay_TJF2mKq8rXvNc1";
const ORDER_ID = "order_TJF1bShyzRGrSb";
const SUB_ID = "sub_TJF4nRp2xWqLd7";

interface ResultData {
  title: string;
  badge: string;
  tone: "ok" | "bad" | "hold" | "wait";
  label: string;
  value: string;
  rows: [string, string, boolean?][];
  message: string;
}

const RESULTS: Record<Outcome, (isSip: boolean, amount: number, freq: string) => ResultData> = {
  ok: (isSip, amount, freq) => ({
    title: isSip ? "SIP active" : "Payment successful",
    badge: isSip ? "SIP active" : "Payment successful",
    tone: "ok",
    label: isSip ? "Monthly SIP" : "Received",
    value: inr(amount),
    rows: isSip
      ? [["Subscription", SUB_ID, true], ["Frequency", freq[0].toUpperCase() + freq.slice(1)],
         ["First charge", "01 Sep 2026"], ["Registered account", "HDFC ····9412"]]
      : [["Reference", PAY_ID, true], ["Order", ORDER_ID, true],
         ["Paid via", "UPI · HDFC Bank"], ["Strategy", "Qode All Weather"]],
    message: isSip
      ? "Your mandate is verified and active. The first instalment will be debited on 01 Sep 2026, and you will receive a confirmation email shortly."
      : "Your funds have been received. A confirmation email is on its way, and the amount will appear in your portfolio once deployed.",
  }),
  fail: (_isSip, amount) => ({
    title: "Payment failed",
    badge: "Not charged",
    tone: "bad",
    label: "Amount debited",
    value: "₹0",
    rows: [["Reason", "Declined by issuing bank"], ["Order", ORDER_ID, true], ["Amount attempted", inr(amount)]],
    message: "Your bank declined the payment and no amount has been debited. You can try a different payment method, or contact your bank.",
  }),
  cancel: () => ({
    title: "Payment cancelled",
    badge: "Not charged",
    tone: "wait",
    label: "Amount debited",
    value: "₹0",
    rows: [["Order", ORDER_ID, true], ["Status", "Still open — you can retry"]],
    message: "You closed the payment window and no amount has been debited. Your investment was not started; you can try again whenever you are ready.",
  }),
  net: (_isSip, amount) => ({
    title: "Confirming your payment",
    badge: "Confirming",
    tone: "hold",
    label: "Payment received",
    value: inr(amount),
    rows: [["Reference", PAY_ID, true], ["Order", ORDER_ID, true], ["Status", "Awaiting confirmation"]],
    message: "Your payment went through and we are confirming it. This usually takes a few moments — you will receive an email once it is complete. Please do not pay again.",
  }),
  hold: (_isSip, amount) => ({
    title: "Mandate under verification",
    badge: "Pending verification",
    tone: "hold",
    label: "Monthly SIP",
    value: inr(amount),
    rows: [["Subscription", SUB_ID, true], ["Authorised via", "UPI Autopay · arjun@okhdfcbank"],
           ["Registered account", "HDFC ····9412"], ["Payer account", "Not disclosed by UPI"]],
    message: "Your mandate has been authorised and is pending a final verification check. Because UPI Autopay does not disclose the paying bank account, our team confirms it manually. Your SIP will start within one working day.",
  }),
};

function Result({ data, onDone, retry }: { data: ResultData; onDone: () => void; retry: boolean }) {
  const tone = {
    ok: "text-[#008455] bg-[#008455]/12 dark:text-[#12a06c] dark:bg-[#12a06c]/15",
    bad: "text-destructive bg-destructive/12",
    hold: "text-[#9a6b12] bg-[#9a6b12]/15 dark:text-[#e0b558] dark:bg-[#e0b558]/15",
    wait: "text-muted-foreground bg-muted-foreground/12",
  }[data.tone];

  const muted = data.tone === "bad" || data.tone === "wait";

  return (
    <>
      <span className={`inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full text-[11.5px] font-bold tracking-wider uppercase ${tone}`}>
        <span className="w-[7px] h-[7px] rounded-full bg-current" />
        {data.badge}
      </span>

      <div className="text-center pt-1">
        <div className="text-[10.5px] font-bold tracking-[0.13em] uppercase text-muted-foreground">{data.label}</div>
        <div className={`font-serif text-[2.5rem] leading-tight mt-1 tabular-nums ${muted ? "text-muted-foreground" : ""}`}>
          {data.value}
        </div>
      </div>

      <dl className="flex flex-col gap-2 text-[13.5px]">
        {data.rows.map(([k, v, mono]) => <Row key={k} k={k} v={v} mono={mono} />)}
      </dl>

      <p className="text-[13.8px] text-muted-foreground leading-relaxed">{data.message}</p>

      <button
        onClick={onDone}
        className="w-full rounded-md bg-primary text-primary-foreground font-bold text-[14.5px] py-3 min-h-[46px] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
      >
        {retry ? "Try again" : "Done"}
      </button>
    </>
  );
}

// ── Portfolio ────────────────────────────────────────────────────────────────

function Portfolio({ onSignOut }: { onSignOut: () => void }) {
  const [modal, setModal] = useState<Mode | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between gap-3.5 px-4 sm:px-8 py-3.5 bg-primary text-primary-foreground flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-[30px] h-[30px] rounded-full bg-white/10 grid place-items-center font-serif text-[15px]">Q</div>
          <div className="text-[14.5px] font-bold leading-tight">
            Demo Investor
            <span className="block text-[11.5px] font-normal opacity-75">QAW0001 · {DEMO_EMAIL}</span>
          </div>
        </div>
        <button onClick={onSignOut} className="text-[13px] underline underline-offset-4 opacity-85 hover:opacity-100">
          Sign out
        </button>
      </div>

      <div className="max-w-[1060px] mx-auto px-4 sm:px-8 pt-6 sm:pt-9 pb-20">
        <div className="flex justify-between items-end gap-5 flex-wrap pb-5 border-b border-border/20 mb-6">
          <div>
            <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">Portfolio Value</p>
            <div className="font-serif text-[clamp(2.3rem,6vw,3.1rem)] leading-none mt-2 tabular-nums">
              {inr(TOTAL_VALUE)}
            </div>
            <div className="text-[14px] font-bold mt-1.5 text-[#008455] dark:text-[#12a06c] tabular-nums">
              +{inr(GAIN)} · +{((GAIN / TOTAL_INVESTED) * 100).toFixed(2)}% since inception
            </div>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            As of 28 Jul 2026
            <br />
            NAV is published daily, not live.
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-3.5 mb-7">
          <Tile label="Total Invested" value={inr(TOTAL_INVESTED)} context="Across 3 strategies" />
          <Tile label="Unrealised Gain" value={`+${inr(GAIN)}`} context="Since inception" positive />
          <Tile label="XIRR" value="18.4%" context="Annualised" positive />
          <Tile label="Active SIP" value={inr(25000)} context="Monthly · next 01 Aug" />
        </div>

        <div className="flex items-baseline justify-between gap-3.5 mt-8 mb-3.5 flex-wrap">
          <h2 className="font-serif text-[1.3rem]">Holdings</h2>
          <span className="text-[12.5px] text-muted-foreground">3 strategies</span>
        </div>

        <div className="overflow-x-auto bg-card border border-border/20 rounded-xl shadow-sm">
          <table className="w-full border-collapse text-[14px] min-w-[520px]">
            <thead>
              <tr>
                {["Strategy", "Invested", "Current Value", "Return"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10.5px] tracking-[0.11em] uppercase text-muted-foreground font-bold border-b border-border/15 ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOLDINGS.map((h, i) => (
                <tr key={h.code}>
                  <td className={`px-4 py-3.5 ${i < HOLDINGS.length - 1 ? "border-b border-border/15" : ""}`}>
                    <span className="flex items-center gap-2.5 font-bold">
                      <span className="w-[9px] h-[9px] rounded-sm shrink-0" style={{ background: h.colour }} />
                      {h.name}
                    </span>
                  </td>
                  <td className={`px-4 py-3.5 text-right tabular-nums ${i < HOLDINGS.length - 1 ? "border-b border-border/15" : ""}`}>
                    {inr(h.invested)}
                  </td>
                  <td className={`px-4 py-3.5 text-right tabular-nums ${i < HOLDINGS.length - 1 ? "border-b border-border/15" : ""}`}>
                    {inr(h.value)}
                  </td>
                  <td className={`px-4 py-3.5 text-right tabular-nums text-[#008455] dark:text-[#12a06c] ${i < HOLDINGS.length - 1 ? "border-b border-border/15" : ""}`}>
                    +{h.ret.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-baseline justify-between gap-3.5 mt-8 mb-3.5">
          <h2 className="font-serif text-[1.3rem]">Account services</h2>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
          <Action
            title="Add funds"
            body="Invest a lump sum into an existing strategy. Funds must come from your registered bank account."
            cta="Add funds"
            onClick={() => setModal("one_time")}
          />
          <Action
            title="Start a SIP"
            body="Set up a recurring investment with an auto-debit mandate from your registered account."
            cta="Start a SIP"
            ghost
            onClick={() => setModal("sip")}
          />
        </div>

        <p className="mt-11 pt-5 border-t border-border/20 text-[12.3px] text-muted-foreground">
          Qode Advisors LLP · SEBI Portfolio Manager INP000008914 · Mumbai
          <br />
          Demonstration data. Figures shown are illustrative and do not represent any real holding.
        </p>
      </div>

      {modal && <PaymentModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function Tile({ label, value, context, positive }: { label: string; value: string; context: string; positive?: boolean }) {
  return (
    <div className="bg-card border border-border/20 rounded-xl p-4 shadow-sm">
      <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">{label}</div>
      <div className={`font-serif text-[1.55rem] mt-1.5 leading-tight tabular-nums ${positive ? "text-[#008455] dark:text-[#12a06c]" : ""}`}>
        {value}
      </div>
      <div className="text-[12px] text-muted-foreground mt-0.5">{context}</div>
    </div>
  );
}

function Action({ title, body, cta, onClick, ghost }: {
  title: string; body: string; cta: string; onClick: () => void; ghost?: boolean;
}) {
  return (
    <div className="bg-card border border-border/20 rounded-xl p-5 shadow-sm flex flex-col gap-2 items-start">
      <h3 className="font-serif text-[1.05rem]">{title}</h3>
      <p className="text-[13.2px] text-muted-foreground flex-1">{body}</p>
      <button
        onClick={onClick}
        className={`rounded-md font-bold text-[14px] px-5 py-2.5 min-h-[44px] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground ${
          ghost
            ? "bg-transparent text-muted-foreground border border-border/25 hover:border-primary hover:text-foreground"
            : "bg-primary text-primary-foreground hover:brightness-110"
        }`}
      >
        {cta}
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [signedIn, setSignedIn] = useState(false);

  const signOut = useCallback(() => {
    setSignedIn(false);
    window.scrollTo(0, 0);
  }, []);

  const signIn = useCallback(() => {
    setSignedIn(true);
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <div className="bg-primary text-primary-foreground text-[12px] font-bold tracking-[0.09em] uppercase py-2 px-4 text-center">
        Demonstration environment · sample data · Razorpay test mode
      </div>
      {signedIn ? <Portfolio onSignOut={signOut} /> : <SignIn onSuccess={signIn} />}
    </>
  );
}
