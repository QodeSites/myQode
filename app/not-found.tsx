import Link from "next/link";

export const metadata = {
  title: "Page not found — myQode",
};

/**
 * 404. Kept plain: someone who mistyped a URL wants a way back, not an
 * apology or an illustration.
 */
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
        404
      </p>
      <h1 className="text-2xl">We couldn&apos;t find that page</h1>
      <p className="text-sm text-muted-foreground">
        The link may be out of date, or the page may have moved.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link
          href="/portfolio/performance"
          className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          Go to my portfolio
        </Link>
        <a
          href="mailto:operations@qodeinvest.com"
          className="inline-flex min-h-[44px] items-center rounded-md border border-border/20 px-5 text-sm font-bold text-primary hover:border-primary/50 dark:text-primary-foreground"
        >
          Contact operations
        </a>
      </div>
    </main>
  );
}
