import type React from "react"

export const metadata = {
  title: "Reporting Portal • Qode",
}

function Banner() {
  return (
    <div className="mb-5 rounded-sm bg-primary px-4 py-2 text-center text-sm font-semibold text-white">
      Access all your portfolio details anytime on our secure reporting portal.
    </div>
  )
}

function LinkBox() {
  return (
    <div className="flex justify-center">
      <a
        href="https://eclientreporting.nuvamaassetservices.com/wealthspectrum/app/"
        aria-label="Open reporting portal link"
        target="_blank"
        className="inline-flex min-w-48 items-center justify-center bg-primary text-white rounded-md border border-border px-1 py-1 text-center text-lg font-semibold text-primary "
      >
        Wealth Spectrum
      </a>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white">
      {children}
    </div>
  )
}

function InfoCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="mb-2 text-center text-sm font-bold text-foreground">{title}</h3>
      <div className="text-center text-sm leading-relaxed text-card-foreground">{children}</div>
    </section>
  )
}

export default function ReportingPortalPage() {
  return (
    <main className="space-y-6">
      <header className="mb-2">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Reporting Portal</h1>
        <p className="text-sm text-muted-foreground">
          The Reporting Portal provides secure, round-the-clock access to all portfolio information in a single, organized platform. Designed with institutional standards of accuracy, compliance, and security, it enables investors to monitor, analyse, and reconcile their holdings with confidence
        </p>
      </header>

      <Banner />

      <LinkBox />

      <SectionHeader>What You Can Access</SectionHeader>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <InfoCard title="Portfolio & Performance">
          <p>Real-time snapshot of your investments.</p>
          <p>Allocation across strategies, sectors, and asset classes.</p>
          <p>Benchmark comparisons to track relative performance.</p>
        </InfoCard>

        <InfoCard title="Transactions & Cash Flows">
          <p>Complete log of purchases, sales, top-ups, and withdrawals.</p>
          <p>Corporate actions (dividends, splits, bonus issues) reflected seamlessly.</p>
        </InfoCard>

        <InfoCard title="Capital Gains & Tax Pack">
          <p>Realized and unrealized gains updated regularly.</p>
          <p>Dividend and interest income records.</p>
          <p>Annual tax-ready reports for filing convenience.</p>
        </InfoCard>

        <InfoCard title="Regulatory Statements">
          <p>SEBI-mandated quarterly portfolio disclosures.</p>
          <p>Related-party transaction reports.</p>
          <p>Credit ratings and other compliance-linked statements.</p>
        </InfoCard>

        <InfoCard title="Account Confirmations">
          <p>Bank & Demat linkage confirmations.</p>
          <p>Power of Attorney acknowledgements.</p>
          <p>Fee statements and billing summaries.</p>
        </InfoCard>
      </div>
    </main>
  )
}
