"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  BarChart3,
  Building2,
  History,
  Home,
  LineChart,
  Users,
  UsersRound,
} from "lucide-react";

/**
 * Back-office navigation.
 *
 * Grouped by purpose — Today / People / Insight — so the sidebar answers
 * "where do I go" before any label is read. Counts are live: the badge on
 * Families is the same number the console shows, fetched once here so the two
 * cannot disagree.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Which count to show, if any. */
  count?: "families" | "clients" | "distributors";
  /** Render the badge in red when the count is above zero. */
  alert?: boolean;
};

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Today",
    items: [{ href: "/admin/console", label: "Console", icon: Home }],
  },
  {
    title: "People",
    items: [
      { href: "/admin/clients", label: "Clients", icon: Users, count: "clients" },
      {
        href: "/admin/families",
        label: "Families",
        icon: UsersRound,
        count: "families",
        alert: true,
      },
      {
        href: "/distributors/internal",
        label: "Distributors",
        icon: Building2,
        count: "distributors",
      },
    ],
  },
  {
    title: "Insight",
    items: [
      { href: "/admin/onboarding", label: "Analytics", icon: BarChart3 },
      { href: "/admin/queries", label: "Queries", icon: LineChart },
    ],
  },
];

type Counts = { clients: number; families: number; distributors: number } | null;

export function AdminNav() {
  const pathname = usePathname();
  const [counts, setCounts] = React.useState<Counts>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/console", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const d = await res.json();
        setCounts({
          clients: d?.totals?.accounts ?? 0,
          families: d?.families?.missingHead ?? 0,
          distributors: d?.distributors?.length ?? 0,
        });
      } catch {
        // Counts are an enhancement — the nav works without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
      {GROUPS.map((group) => (
        <React.Fragment key={group.title}>
          <p className="hidden px-2 pb-1.5 pt-4 text-[9.5px] font-black uppercase tracking-[0.14em] text-sidebar-foreground/45 first:pt-0 lg:block">
            {group.title}
          </p>

          {group.items.map(({ href, label, icon: Icon, count, alert }) => {
            // startsWith so /admin/clients/123 still highlights Clients.
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const value = counts && count ? counts[count] : null;
            const showAlert = Boolean(alert) && (value ?? 0) > 0;

            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-[38px] shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                  active
                    ? "bg-primary-foreground/15 font-bold text-primary-foreground"
                    : "text-sidebar-foreground/75 hover:bg-black/15"
                }`}
              >
                <Icon className="size-4 shrink-0 opacity-85" />
                <span className="truncate">{label}</span>
                {value !== null ? (
                  <span
                    className={`ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-black tabular-nums ${
                      showAlert
                        ? "bg-destructive text-white"
                        : "bg-sidebar-foreground/15 text-sidebar-foreground/80"
                    }`}
                  >
                    {value}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </React.Fragment>
      ))}

      <p className="hidden px-2 pb-1.5 pt-4 text-[9.5px] font-black uppercase tracking-[0.14em] text-sidebar-foreground/45 lg:block">
        System
      </p>
      <Link
        href="/admin/onboarding"
        className="flex min-h-[38px] shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-black/15"
      >
        <History className="size-4 shrink-0 opacity-85" />
        <span className="truncate">Legacy dashboard</span>
      </Link>
      <Link
        href="/admin/console"
        className="flex min-h-[38px] shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-black/15"
      >
        <AlertCircle className="size-4 shrink-0 opacity-85" />
        <span className="truncate">Error log</span>
      </Link>
    </nav>
  );
}
