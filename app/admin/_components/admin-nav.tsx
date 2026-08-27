"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  FileText,
  Home,
  LineChart,
  Users,
  UsersRound,
} from "lucide-react";

/**
 * Back-office navigation.
 *
 * Renders only the sections the signed-in role may reach, from
 * /api/admin/me. This mirrors the server-side rule in lib/adminRoles.ts — it
 * does not enforce it. Every destination checks the role itself, so a user
 * who types another role's URL is refused there regardless of what this
 * component shows.
 *
 * Grouped by purpose so the sidebar answers "where do I go" before any label
 * is read.
 */

type Section =
  | "console"
  | "analytics"
  | "clients"
  | "families"
  | "distributor"
  | "invoices"
  | "queries";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section: Section;
  /** Which live count to hang off the item, if any. */
  count?: "families" | "clients";
  /** Show the badge in red when the count is above zero. */
  alert?: boolean;
};

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Today",
    items: [
      { href: "/admin/console", label: "Console", icon: Home, section: "console" },
      {
        href: "/admin/analytics",
        label: "Analytics",
        icon: BarChart3,
        section: "analytics",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        href: "/admin/clients",
        label: "Clients",
        icon: Users,
        section: "clients",
        count: "clients",
      },
      {
        href: "/admin/families",
        label: "Families",
        icon: UsersRound,
        section: "families",
        count: "families",
        alert: true,
      },
      {
        href: "/distributors/internal",
        label: "Distributors",
        icon: Building2,
        section: "distributor",
      },
    ],
  },
  {
    title: "Finance",
    items: [
      {
        href: "/admin/invoices",
        label: "Invoices",
        icon: FileText,
        section: "invoices",
      },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/admin/queries", label: "Queries", icon: LineChart, section: "queries" },
    ],
  },
];

type Counts = { clients: number; families: number };

export function AdminNav() {
  const pathname = usePathname();
  const [sections, setSections] = React.useState<Section[] | null>(null);
  const [counts, setCounts] = React.useState<Counts | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/admin/me", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const me = await res.json();
        const allowed: Section[] = me?.sections ?? [];
        if (cancelled) return;
        setSections(allowed);

        // Only ask for console counts when this role may have them. A
        // distributor-role caller gets a 403 here, and firing a request you
        // expect to fail is just noise in the log.
        if (!allowed.includes("console")) return;

        const c = await fetch("/api/admin/console", { cache: "no-store" });
        if (cancelled || !c.ok) return;
        const d = await c.json();
        setCounts({
          clients: d?.totals?.accounts ?? 0,
          families: d?.families?.missingHead ?? 0,
        });
      } catch {
        // The nav is unusable without a role list, and showing every link
        // would misrepresent what this person can reach. Leave it empty.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Until the role is known, render nothing rather than every link: showing
  // sections then removing them reads as a permissions glitch.
  if (!sections) return <nav aria-busy="true" />;

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => sections.includes(i.section));
        if (!items.length) return null;

        return (
          <React.Fragment key={group.title}>
            <p className="hidden px-2 pb-1.5 pt-4 text-[9.5px] font-black uppercase tracking-[0.14em] text-sidebar-foreground/45 first:pt-0 lg:block">
              {group.title}
            </p>

            {items.map(({ href, label, icon: Icon, count, alert }) => {
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
        );
      })}
    </nav>
  );
}
