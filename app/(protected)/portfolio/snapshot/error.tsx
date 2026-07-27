"use client";

import { useEffect } from "react";

/**
 * Error boundary for the Portfolio Snapshot route.
 * Renders inside the (protected) layout's <main id="main-content">, so the
 * crash state stays within the page landmark. Provides an announced, high-
 * contrast message plus recovery actions (WCAG 2.2 AA).
 */
export default function SnapshotError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Snapshot page crashed:", error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <h1 className="text-xl font-bold text-foreground mb-2">
        Application Error
      </h1>
      <p className="text-sm text-foreground mb-6 max-w-sm">
        Something went wrong while loading your portfolio snapshot. Please try
        again, or return to your dashboard.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Try again
        </button>
        <a
          href="/portfolio"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Return to dashboard
        </a>
      </div>
    </div>
  );
}
