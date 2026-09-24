"use client";

// ----------------------------------------------------------------------------
// Expiry-day inline banner
// ----------------------------------------------------------------------------
// A persistent (non-dismissible-permanently) notice rendered inline on the
// portfolio screen. Unlike the popup, it stays visible the entire time the
// value is spiked on a Nifty expiry day, and disappears on its own once the
// data reconciles (the API stops returning shouldShow) or it's no longer an
// expiry day. Users can collapse it for the current session, but it returns
// on reload while the spike persists.
// ----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useClient } from "@/contexts/ClientContext";
import { AlertTriangle, X } from "lucide-react";

export default function ExpiryDayBanner() {
  const { clients, selectedClientType } = useClient();
  const [show, setShow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (selectedClientType === "DISTRIBUTORS") return;
    if (!clients || clients.length === 0) return;

    let cancelled = false;

    const run = async () => {
      try {
        const codes = Array.from(
          new Set(
            clients
              .map((c: any) => c.clientcode)
              .filter((code: string) => !!code)
          )
        );
        if (codes.length === 0) return;

        const res = await fetch(
          `/api/expiry-check?nuvama_codes=${encodeURIComponent(codes.join(","))}`
        );
        const data = await res.json();
        if (cancelled) return;
        setShow(!!data?.success && !!data?.shouldShow);
      } catch {
        // Advisory only — never block the screen on failure.
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [clients, selectedClientType]);

  if (!show || collapsed) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 sm:p-4"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
      </span>

      <div className="flex-1 text-sm leading-relaxed text-card-foreground">
        <p className="font-semibold text-foreground">
          Today&apos;s portfolio value may look unusual — this is a temporary
          reporting issue.
        </p>
        <p className="mt-1">
          It&apos;s a Nifty options expiry day, and some hedging (derivative)
          positions can be temporarily mispriced after expiry, making your value
          or gain/loss swing sharply. Your actual holdings, cash and realised
          gains are unchanged, and it typically corrects within a few hours.{" "}
          <Link
            href="/portfolio/expiry-day-faq"
            className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
          >
            Learn more
          </Link>
          .
        </p>
      </div>

      <button
        type="button"
        aria-label="Hide notice"
        onClick={() => setCollapsed(true)}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-amber-100 hover:text-foreground dark:hover:bg-amber-900/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
