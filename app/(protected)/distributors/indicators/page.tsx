"use client";

import * as React from "react";
import { ValuationSpreadIndicator } from "@/components/indicators/valuation-spread-indicator";

/**
 * Market valuation for distribution partners.
 *
 * One indicator, the same one Qode's research team uses, read live from the
 * qode360 backend. Partners get this so they can answer "is the market
 * expensive right now?" with the number Qode would give, not a second-hand
 * summary.
 */
export default function DistributorIndicatorsPage() {
  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Market indicators</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How much of the market is trading rich versus its own history, updated daily from Qode
          research.
        </p>
      </header>

      <ValuationSpreadIndicator />
    </div>
  );
}
