import type React from "react";
import Link from "next/link";
import { AdminNav } from "./_components/admin-nav";

export const metadata = {
  title: "myQode Back Office",
  robots: { index: false, follow: false },
};

/**
 * Shell for every /admin route.
 *
 * Full-bleed rather than a centred column: this is an operations console, and
 * the tables and charts inside it want the width. The rail uses the sidebar
 * treatment already in the design system (deep green ground, gold for the
 * active state) and collapses above the content on mobile.
 *
 * A server component so it can export `metadata` — a "use client" component
 * cannot. The nav needs usePathname() and fetches live counts, so it lives in
 * its own client component rather than forcing this whole layout client-side.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background lg:flex-row">
      {/* Rail */}
      <aside className="flex shrink-0 flex-col gap-0.5 bg-sidebar px-3.5 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-[232px] lg:overflow-y-auto lg:py-5">
        <div className="flex items-baseline gap-1.5 px-2 pb-4 lg:pb-5">
          <span className="text-xs text-sidebar-foreground/60">my</span>
          <span className="font-serif text-[21px] text-sidebar-foreground">Qode</span>
          <span className="ml-auto rounded-sm border border-primary-foreground/45 px-1.5 py-px text-[8.5px] font-black tracking-[0.1em] text-primary-foreground">
            OPS
          </span>
        </div>

        <AdminNav />

        <div className="mt-auto hidden border-t border-sidebar-foreground/15 px-2 pb-0.5 pt-3.5 text-[11px] text-sidebar-foreground/50 lg:block">
          Qode Advisors LLP
          <br />
          Back office
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3.5 border-b border-border/20 bg-card px-4 py-3 sm:px-6">
          <Link
            href="/admin/console"
            className="text-sm font-bold text-foreground hover:text-primary dark:hover:text-primary-foreground"
          >
            Back office
          </Link>
          <span className="text-[11px] text-muted-foreground">
            Qode Advisors LLP · internal
          </span>
        </header>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
