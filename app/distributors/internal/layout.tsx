import type React from "react";
import Link from "next/link";
import { AdminNav } from "@/app/admin/_components/admin-nav";
import { AdminUser } from "@/app/admin/_components/admin-user";

/**
 * Internal distributor overview — deliberately OUTSIDE app/(protected).
 *
 * That route group's layout requires a `qode-auth` investor session and
 * redirects to /login without one. Internal staff authenticate with the
 * `admin-session` cookie instead, so a page placed inside (protected) bounced
 * them to the investor login even with a valid admin session.
 *
 * Access is enforced in two places, neither of them here:
 *   1. middleware.ts redirects to /admin/login when the admin-session cookie
 *      is absent — UX only, since it does not validate the cookie.
 *   2. /api/distributor/internal-overview validates the session against Redis
 *      before returning any data. That is the real security boundary.
 *
 * The shell is the same rail, nav and grid as app/admin/layout.tsx: this page
 * is part of the back office, and the team should not cross a visual seam
 * moving between Distributors and Clients. The nav component is imported
 * rather than duplicated so the two cannot drift apart.
 */
export const metadata = {
  title: "Distributor Management — myQode Back Office",
  robots: { index: false, follow: false },
};

export default function InternalDistributorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen w-full grid-cols-1 grid-rows-[auto_1fr] bg-background lg:grid-cols-[232px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="flex h-auto flex-col gap-0.5 bg-sidebar px-3.5 py-3 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:py-5">
        <div className="flex items-baseline gap-1.5 px-2 pb-4 lg:pb-5">
          <span className="text-xs text-sidebar-foreground/60">my</span>
          <span className="font-serif text-[21px] text-sidebar-foreground">Qode</span>
          <span className="ml-auto rounded-sm border border-primary-foreground/45 px-1.5 py-px text-[8.5px] font-black tracking-[0.1em] text-primary-foreground">
            OPS
          </span>
        </div>

        <AdminNav />

        <AdminUser />
      </aside>

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
