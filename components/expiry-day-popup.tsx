"use client";

// ----------------------------------------------------------------------------
// Expiry-day notice popup
// ----------------------------------------------------------------------------
// On Nifty weekly options expiry days, if the signed-in client's portfolio
// shows an abnormal single-day spike (the symptom of the index-level
// mispricing), this surfaces a one-time-per-day modal explaining that the
// inflated value is a temporary reporting artefact, linking to the full FAQ.
// ----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useClient } from "@/contexts/ClientContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

const DISMISS_KEY_PREFIX = "qode-expiry-notice-dismissed:";

export default function ExpiryDayPopup() {
  const { clients, selectedClientType } = useClient();
  const [open, setOpen] = useState(false);
  const [dateKey, setDateKey] = useState<string>("");

  useEffect(() => {
    // Distributors don't see client-level portfolio spikes here.
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
        if (!data?.success || !data?.shouldShow) return;

        const dKey: string = data.dateKey || "";
        // Show at most once per expiry day per browser.
        const dismissed = localStorage.getItem(`${DISMISS_KEY_PREFIX}${dKey}`);
        if (dismissed === "1") return;

        setDateKey(dKey);
        setOpen(true);
      } catch {
        // Silent: never block the app on this advisory check.
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [clients, selectedClientType]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && dateKey) {
      try {
        localStorage.setItem(`${DISMISS_KEY_PREFIX}${dateKey}`, "1");
      } catch {
        /* ignore storage errors */
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </span>
            <DialogTitle className="text-primary">
              A note on today&apos;s portfolio value
            </DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left leading-relaxed">
            Today is a Nifty options expiry day. You may notice an unusual swing in
            your portfolio value or gain/loss on myQode. This is a{" "}
            <strong className="text-foreground">
              temporary reporting discrepancy
            </strong>{" "}
            in how some hedging (derivative) positions are priced after expiry — not
            a change to your actual investments. It typically corrects itself within
            a few hours.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted/40 p-3 text-sm text-card-foreground">
          Your holdings, cash balance, executed trades and realised gains are all
          unchanged. No action is needed.
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Got it
          </Button>
          <Button asChild variant="gradient">
            <Link
              href="/portfolio/expiry-day-faq"
              onClick={() => handleOpenChange(false)}
            >
              Learn more
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
