"use client";
import type React from "react";
import { motion } from "framer-motion";
import { Mail, BarChart3, CalendarClock, ShieldCheck, ClipboardCheck, MessageSquare } from "lucide-react";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-bold text-foreground tracking-wide border-b border-border pb-2 mb-4">
      {children}
    </h2>
  );
}

function InfoCard({
  title,
  children,
  icon: Icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.35 }}
      className="group flex flex-col rounded-lg border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
    >
      <div className="mb-3 flex items-center gap-2">
        {Icon && (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
        )}
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-card-foreground space-y-2">
        {children}
      </div>
    </motion.section>
  );
}

export default function ReportsReviewsPage() {
  return (
    <main className="space-y-6">
      <header className="mb-2">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
          Reports & Reviews
        </h1>
        <p className="text-sm text-muted-foreground">
          Stay consistently informed with structured reports and timely reviews. From monthly updates to annual reviews, everything is designed to keep you aligned with your portfolio and goals.
        </p>
      </header>

      {/* Monthly */}
      <SectionHeader>Monthly Report</SectionHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard title="Delivered via Email" icon={Mail}>
          <p><strong>How:</strong> Sent directly to your registered email ID.</p>
        </InfoCard>
        <InfoCard title="Performance Updates" icon={BarChart3}>
          <p>
            <strong>Content:</strong> Performance summary across all four Qode strategies (QAW, QTF, QGF, QFH).
          </p>
        </InfoCard>
        <InfoCard title="Timeline & Purpose" icon={CalendarClock}>
          <p><strong>Timeline:</strong> Within the first 15 days of the following month.</p>
          <p><strong>Purpose:</strong> Keeps you updated consistently, without waiting for quarterly or annual reviews.</p>
        </InfoCard>
      </div>

      {/* Quarterly */}
      <SectionHeader>Quarterly Report</SectionHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard title="Regulatory Disclosure" icon={ShieldCheck}>
          <p><strong>Mandated by SEBI:</strong> Shared within 15 days of quarter‑end.</p>
        </InfoCard>
        <InfoCard title="What You Receive" icon={ClipboardCheck}>
          <ul className="list-disc space-y-1 pl-5">
            <li>Portfolio holdings & transactions</li>
            <li>Performance vs. benchmark</li>
            <li>Regulatory disclosures</li>
          </ul>
        </InfoCard>
        <InfoCard title="Why It Matters" icon={BarChart3}>
          <p><strong>Purpose:</strong> Ensures full transparency and keeps you aligned with your portfolio on a regulatory‑mandated frequency.</p>
        </InfoCard>
      </div>

      {/* Annual */}
      <SectionHeader>Annual Review</SectionHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard title="One‑on‑One Engagement" icon={MessageSquare}>
          <p><strong>Format:</strong> Review session with your Fund Manager and Investor Relations team.</p>
        </InfoCard>
        <InfoCard title="Deep‑Dive Agenda" icon={BarChart3}>
          <ul className="list-disc space-y-1 pl-5">
            <li>Annual performance across strategies</li>
            <li>Risk‑return attribution & positioning</li>
            <li>Forward outlook & strategic adjustments</li>
          </ul>
        </InfoCard>
        <InfoCard title="Cadence & Outcomes" icon={CalendarClock}>
          <p><strong>Timeline:</strong> Once every year.</p>
          <p><strong>Purpose:</strong> Align long‑term goals, review progress, and set expectations for the year ahead.</p>
        </InfoCard>
      </div>

      {/* SLA */}
      <SectionHeader>Response SLA</SectionHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard title="Standard Queries" icon={MessageSquare}>
          <p><strong>Email / WhatsApp:</strong> Response within 1 business day.</p>
        </InfoCard>
        <InfoCard title="Operational Requests" icon={ClipboardCheck}>
          <p><strong>Top‑up, withdrawal, KYC:</strong> Acknowledged next day, executed as per regulatory timelines.</p>
        </InfoCard>
        <InfoCard title="Escalations" icon={ShieldCheck}>
          <p><strong>Routing:</strong> Escalated within 24 hours to Compliance if not resolved.</p>
        </InfoCard>
      </div>
    </main>
  );
}
