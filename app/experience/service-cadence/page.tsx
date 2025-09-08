import type React from "react"

export const metadata = {
  title: "Reports & Reviews • Qode",
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
      <h3 className="mb-2 text-center text-sm font-bold text-foreground whitespace-pre-line">
        {title}
      </h3>
      <div className="text-sm leading-relaxed text-card-foreground space-y-2 text-center md:text-left">
        {children}
      </div>
    </section>
  )
}

export default function ReportsReviewsPage() {
  return (
    <main className="space-y-6">
      <header className="mb-2">
        <h1 className="text-pretty text-xl font-bold text-foreground">
          Reports & Reviews
        </h1>
        <p className="text-sm text-muted-foreground">
          Stay consistently informed with structured reports and timely reviews.
          From monthly updates to annual reviews, everything is designed to keep
          you aligned with your portfolio and goals.
        </p>
      </header>

      <SectionHeader>Monthly Report</SectionHeader>
      <InfoCard title="Performance Updates">
        <p>
          <strong>Delivered via Email:</strong> Sent directly to your registered
          email ID.
        </p>
        <p>
          <strong>Content:</strong> Performance summary across all four Qode
          strategies (QAW, QTF, QGF, QFH).
        </p>
        <p>
          <strong>Timeline:</strong> Shared within the first 15 days of the
          following month.
        </p>
        <p>
          <strong>Purpose:</strong> Keeps you updated on performance
          consistently, without waiting for quarterly or annual reviews.
        </p>
      </InfoCard>

      <SectionHeader>Quarterly Report</SectionHeader>
      <InfoCard title="Regulatory & Performance Disclosure">
        <p>
          <strong>Mandated by SEBI:</strong> Shared within 15 days of
          quarter-end.
        </p>
        <p>
          <strong>Content:</strong> Portfolio holdings, transactions,
          performance vs. benchmark, and regulatory disclosures.
        </p>
        <p>
          <strong>Purpose:</strong> Ensures full transparency and keeps you
          aligned with your portfolio on a regulatory-mandated frequency.
        </p>
      </InfoCard>

      <SectionHeader>Annual Review</SectionHeader>
      <InfoCard title="One-on-One Engagement">
        <p>
          <strong>Format:</strong> One-on-one review session with your Fund
          Manager and Investor Relations team.
        </p>
        <div>
          <strong>Content:</strong>
          <ul className="ml-5 list-disc space-y-1 text-left">
            <li>Annual performance across strategies.</li>
            <li>Risk-return attribution and portfolio positioning.</li>
            <li>Forward outlook and any strategic adjustments.</li>
          </ul>
        </div>
        <p>
          <strong>Timeline:</strong> Conducted once every year.
        </p>
        <p>
          <strong>Purpose:</strong> Aligns long-term goals, reviews progress,
          and sets expectations for the year ahead.
        </p>
      </InfoCard>

      <SectionHeader>Response SLA</SectionHeader>
      <InfoCard title="Service Commitments">
        <p>
          <strong>Standard Queries (email/WhatsApp):</strong> Response within 1
          business day.
        </p>
        <p>
          <strong>Operational Requests (top-up, withdrawal, KYC):</strong>{" "}
          Acknowledged next day, executed as per regulatory timelines.
        </p>
        <p>
          <strong>Escalations:</strong> Routed within 24 hours to Compliance if
          not resolved.
        </p>
      </InfoCard>
    </main>
  )
}
