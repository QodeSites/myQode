import type React from "react";
import { AdminNav } from "./_components/admin-nav";

export const metadata = {
  title: "myQode Back Office",
  robots: { index: false, follow: false },
};

/**
 * Shell for every /admin route.
 *
 * A server component so it can export `metadata` — a "use client" component
 * cannot. The nav needs usePathname(), so it lives in its own client
 * component rather than forcing this whole layout client-side.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/20 bg-card px-4 py-3 sm:px-6">
        <p className="text-sm font-bold text-foreground">myQode Back Office</p>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:gap-6">
        <aside className="lg:w-56 lg:shrink-0">
          <AdminNav />
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
