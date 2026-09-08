"use client";

// ----------------------------------------------------------------------------
// usePrimaryUcc
// ----------------------------------------------------------------------------
// Fetches the logged-in investor's primary UCC code(s) — the code that, on
// Nuvama's WealthSpectrum portal, shows all of a group's mapped schemes in one
// view rather than a single scheme. Shared by the dashboard notice and the
// account hierarchy, so both agree on which account is marked primary.
//
// Resolution happens server-side (see lib/primaryUcc.ts). Codes are returned
// uppercased for comparison, since clientcode casing varies across views.
// ----------------------------------------------------------------------------

import { useEffect, useState } from "react";

export interface PrimaryUccEntry {
  uccCode: string;
  strategy: string | null;
  groupName: string | null;
}

export function usePrimaryUcc() {
  const [primaries, setPrimaries] = useState<PrimaryUccEntry[]>([]);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/primary-ucc");
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && Array.isArray(data.primaries)) {
          setPrimaries(data.primaries);
          setDataAsOf(data.dataAsOf ?? null);
        }
      } catch {
        // Advisory only — never block the screen on failure.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const codes = new Set(primaries.map((p) => (p.uccCode || "").trim().toUpperCase()));

  return {
    primaries,
    /** ISO date (yyyy-mm-dd) the portfolio figures are current to, if known. */
    dataAsOf,
    loaded,
    /** True when this account code is the primary UCC for its family. */
    isPrimaryUcc: (clientcode?: string | null) =>
      !!clientcode && codes.has(clientcode.trim().toUpperCase()),
  };
}
