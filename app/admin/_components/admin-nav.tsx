"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Users, UsersRound } from "lucide-react";

const LINKS = [
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/families", label: "Families", icon: UsersRound },
  { href: "/admin/onboarding", label: "Analytics (legacy)", icon: BarChart3 },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
      {LINKS.map(({ href, label, icon: Icon }) => {
        // startsWith, so /admin/clients/123 still highlights Clients.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors ${
              active
                ? "bg-card font-bold text-primary dark:text-primary-foreground"
                : "text-muted-foreground hover:bg-card/60"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
