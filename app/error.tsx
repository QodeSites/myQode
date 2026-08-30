"use client";

import * as React from "react";

/**
 * Root error boundary.
 *
 * Next.js requires this to be a client component. It catches render errors
 * anywhere below the root layout, so a single broken page no longer shows the
 * bare framework error screen.
 *
 * The message deliberately avoids the underlying error text: it is written for
 * an investor, and a stack trace tells them nothing useful. The real error is
 * logged for us.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this page. Trying again usually works — if it keeps
        happening, our operations team can help.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
        <a
          href="mailto:operations@qodeinvest.com"
          className="inline-flex min-h-[44px] items-center rounded-md border border-border/20 px-5 text-sm font-bold text-primary hover:border-primary/50 dark:text-primary-foreground"
        >
          Contact operations
        </a>
      </div>
      {error.digest ? (
        <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
