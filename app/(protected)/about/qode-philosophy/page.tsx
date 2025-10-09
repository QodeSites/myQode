"use client";
import React from "react";

/* =========================
   Example page with static content
   ========================= */
export default function DashboardHome() {
  return (
    <div className="space-y-8">
      {/* Page content */}
      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">Who We Are</h2>
        <p className="text-card-foreground">
          Qode is a SEBI-registered Portfolio Management Service (PMS) built on the principle that evidence, not
          opinion, should drive investment decisions. Founded by seasoned professionals with over a decade of
          experience in Indian markets, we exist to give investors a disciplined, transparent, and performance-oriented
          platform for long-term wealth creation.
        </p>
      </section>

      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">What We Do</h2>
        <p className="text-card-foreground">
          We design and manage differentiated investment strategies that combine the power of quantitative models with
          the insight of fundamental research. Our range spans ETF-only portfolios, systematic momentum strategies,
          diversified growth funds, and high-conviction stock picks—offering clients the flexibility to align with
          their goals and risk appetite.
        </p>
      </section>

      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">How We Work</h2>
        <p className="text-card-foreground">
          At Qode, every investment decision is guided by data, tested frameworks, and structured review processes. We
          believe in clarity over complexity: our clients receive concise updates that explain what we hold, why we
          hold it, and when we make changes. With bank-grade custody, strong operational controls, and a proactive
          investor support team, we ensure the experience is as robust as the strategy itself.
        </p>
      </section>

      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">Why It Matters</h2>
        <p className="text-card-foreground">
          Markets are noisy and narratives change quickly. Qode’s approach is designed to cut through that noise. By
          combining systematic rigor with long-term conviction, we aim to protect portfolios in challenging times while
          positioning them to capture opportunities that can compound meaningfully over years.
        </p>
      </section>
    </div>
  );
}