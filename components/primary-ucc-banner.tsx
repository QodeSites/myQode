"use client";

// ----------------------------------------------------------------------------
// Primary UCC notice
// ----------------------------------------------------------------------------
// On Nuvama's WealthSpectrum portal, every one of an investor's UCC codes is a
// valid login — but only the primary one shows all their mapped schemes in a
// single view. Logging in with any other code shows just that scheme. This
// banner tells the investor which code gives them the complete picture.
//
// It renders nothing when the code cannot be resolved with confidence (about
// 2% of families) — telling someone the wrong login ID is worse than staying
// quiet. Dismissal is remembered per code, so a resolution change re-surfaces
// the notice rather than staying hidden.
// ----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import { useClient } from "@/contexts/ClientContext";
import { usePrimaryUcc } from "@/hooks/usePrimaryUcc";
import { Info, Check, Copy, X } from "lucide-react";

const dismissKey = (codes: string[]) => `primaryUccDismissed:${codes.join(",")}`;

/** Render an ISO yyyy-mm-dd as "3 September 2026", avoiding timezone shifts. */
function formatAsOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function PrimaryUccBanner() {
  const { selectedClientType } = useClient();
  const { primaries, dataAsOf } = usePrimaryUcc();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Re-check dismissal whenever the resolved codes change, so a change in
  // resolution re-surfaces the notice rather than staying hidden.
  useEffect(() => {
    if (primaries.length === 0) return;
    try {
      const key = dismissKey(primaries.map((p) => p.uccCode));
      setDismissed(localStorage.getItem(key) === "1");
    } catch {
      // Private mode / blocked storage — just show the notice.
    }
  }, [primaries]);

  if (selectedClientType === "DISTRIBUTORS") return null;
  if (primaries.length === 0 || dismissed) return null;

  const multiple = primaries.length > 1;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard unavailable — the code is visible on screen regardless.
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(primaries.map((p) => p.uccCode)), "1");
    } catch {
      // Non-fatal: the notice simply returns on the next load.
    }
  };

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30 sm:p-4"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
        <Info className="h-4 w-4 text-amber-600" />
      </span>

      <div className="flex-1 text-sm leading-relaxed text-card-foreground">
        <p className="font-semibold text-foreground">
          See all your schemes in one place on Nuvama&apos;s WealthSpectrum portal.
        </p>
        <p className="mt-1">
          {multiple
            ? "Each family group has its own primary UCC code. Sign in with the one below to see all the schemes mapped to that group:"
            : "Sign in with your primary UCC code below to view all your mapped schemes together. Your other codes still work, but each one shows only that scheme's portfolio."}
        </p>

        <div className="mt-3 space-y-2">
          {primaries.map((p) => (
            <div
              key={p.uccCode}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-white/70 px-3 py-2 dark:border-amber-900/40 dark:bg-black/20"
            >
              <span className="font-mono text-base font-semibold tracking-wide text-foreground">
                {p.uccCode}
              </span>
              {multiple && p.groupName && (
                <span className="text-xs text-muted-foreground">{p.groupName}</span>
              )}
              {p.strategy && (
                <span className="text-xs text-muted-foreground">{p.strategy}</span>
              )}
              <button
                type="button"
                onClick={() => copy(p.uccCode)}
                aria-label={`Copy ${p.uccCode}`}
                className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
              >
                {copied === p.uccCode ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </>
                )}
              </button>
            </div>
          ))}
        </div>

        {dataAsOf && (
          <p className="mt-2">
            We&apos;re facing downtime issues with Nuvama, so portfolio data is
            available as of{" "}
            <span className="font-medium text-foreground">
              {formatAsOf(dataAsOf)}
            </span>
            . We&apos;ll rectify it shortly.
          </p>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          This applies to Nuvama&apos;s WealthSpectrum portal only — your myQode login
          is unchanged.
        </p>
      </div>

      <button
        type="button"
        aria-label="Hide notice"
        onClick={dismiss}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-amber-100 hover:text-foreground dark:hover:bg-amber-900/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
