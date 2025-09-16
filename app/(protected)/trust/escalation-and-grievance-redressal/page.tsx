export default function EscalationProcessPage() {
  return (
    <main className="space-y-10">
      <header className="mb-6">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Escalation Framework</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We take every investor query seriously. If something isn't resolved quickly by our Investor Relations team,
          this structured framework ensures clarity and accountability.
        </p>
      </header>

      <section className="rounded-md border bg-card">
        <div className="divide-y">
          <div className="p-4">
            <h3 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Level 1 — Investor Relations (IR)</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Role:</span> Your first point of contact for all queries — from portfolio updates to operational requests.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Response SLA:</span> Within 1 business day.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Contact:</span> investor.relations@qodeinvest.com · WhatsApp IR Desk
            </p>
          </div>

          <div className="p-4">
            <h3 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Level 2 — Compliance Officer</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Role:</span> If an issue isn't resolved by IR, it's escalated to the Compliance Officer for review and redressal.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Scope:</span> Regulatory matters, delayed responses, or unresolved service issues.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Escalation Timeline:</span> Within 24 hours of non‑resolution at Level 1.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Contact:</span> compliance@qodeinvest.com
            </p>
          </div>

          <div className="p-4">
            <h3 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Level 3 — Principal Officer</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Role:</span> Final level of escalation, handled directly by the Principal Officer.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Scope:</span> Persistent grievances or concerns requiring senior oversight.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Escalation Timeline:</span> If unresolved at Compliance level within prescribed timeframes.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold">Contact:</span> karan.salecha@qodeinvest.com
            </p>
          </div>

          <div className="p-4">
            <h3 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Investor Protection</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              All complaints and resolutions are documented and reviewed periodically.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}