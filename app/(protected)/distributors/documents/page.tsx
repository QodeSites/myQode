"use client";

import * as React from "react";
import { Download, FileText } from "lucide-react";
import {
  DISTRIBUTOR_DOCUMENTS,
  type DistributorDocument,
} from "@/lib/distributorDocuments";
import { STRATEGY_COLOR, NEUTRAL_COLOR } from "@/lib/distributorVocabulary";

/**
 * Qode documents a partner can download and pass to a client.
 *
 * The files are not in public/ — they stream through /api/distributor/document
 * behind the same distributor check as the rest of this module. That is why
 * each row is a button that fetches, rather than a plain link: an anchor to a
 * protected route would show the browser's own error page to anyone whose
 * session had lapsed, instead of a message that explains itself.
 */

function DocumentRow({ doc }: { doc: DistributorDocument }) {
  const [state, setState] = React.useState<"idle" | "busy">("idle");
  const [error, setError] = React.useState<string | null>(null);

  const color = doc.strategy
    ? (STRATEGY_COLOR[doc.strategy] ?? NEUTRAL_COLOR)
    : "#02422b";

  async function download() {
    setError(null);
    setState("busy");
    try {
      const res = await fetch(
        `/api/distributor/document?slug=${encodeURIComponent(doc.slug)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "Please sign in again to download this."
            : "That document is unavailable just now.",
        );
        setState("idle");
        return;
      }

      // Saved through a blob so the download keeps its proper filename and
      // the request still carries the session cookie.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setError("Download failed. Please check your connection and try again.");
      setState("idle");
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/20 bg-background px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: `${color}1a`, color }}
      >
        <FileText className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {doc.title}
        </span>
        <span className="block text-[12px] text-muted-foreground">
          {doc.description}
        </span>
        {error ? (
          <span role="alert" className="mt-0.5 block text-[12px] text-destructive">
            {error}
          </span>
        ) : null}
      </span>

      {/* The date each document states on its own cover, so a partner knows
          how current it is before sending it to a client. */}
      <span className="text-[12px] tabular-nums text-muted-foreground">
        {doc.asOf}
      </span>

      <button
        type="button"
        onClick={download}
        disabled={state === "busy"}
        className="flex min-h-[44px] items-center gap-2 rounded-md border border-border/20 px-4 text-sm font-semibold text-foreground hover:border-primary/50 disabled:opacity-60"
      >
        <Download className="size-4" />
        {state === "busy" ? "Preparing…" : "Download"}
      </button>
    </li>
  );
}

export default function DistributorDocumentsPage() {
  const strategyDocs = DISTRIBUTOR_DOCUMENTS.filter((d) => d.strategy);
  const firmDocs = DISTRIBUTOR_DOCUMENTS.filter((d) => !d.strategy);

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <header>
        <h1 className="text-2xl">Decks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download and share with prospective investors.
        </p>
      </header>

      {firmDocs.length ? (
        <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
          <h2 className="text-base font-semibold text-foreground">The firm</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {firmDocs.map((d) => (
              <DocumentRow key={d.slug} doc={d} />
            ))}
          </ul>
        </section>
      ) : null}

      {strategyDocs.length ? (
        <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
          <h2 className="text-base font-semibold text-foreground">
            Strategy factsheets
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One per strategy, with performance and risk metrics.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {strategyDocs.map((d) => (
              <DocumentRow key={d.slug} doc={d} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
