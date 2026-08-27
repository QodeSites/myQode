"use client";

import * as React from "react";
import { LogOut } from "lucide-react";

/**
 * Who is signed in, and how to sign out. Sits at the foot of the rail.
 *
 * Role is shown alongside the name because the back office looks different
 * per role — someone seeing fewer sections than a colleague should be able to
 * tell why without asking.
 */

const ROLE_LABEL: Record<string, string> = {
  super: "Full access",
  distributor: "Distributor manager",
  invoices: "Finance",
  default: "Investor support",
};

type Me = { name: string; email: string; role: string };

export function AdminUser() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        setMe((await res.json()) as Me);
      } catch {
        // Nothing to show; the sign-out button still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/admin/logout", { method: "POST" });
    } catch {
      // Even if the request fails, send them to the login screen — staying
      // on a page they may no longer be authorised for is worse.
    } finally {
      window.location.href = "/admin/login";
    }
  }

  // Initials for the avatar. Falls back to the email when there is no name.
  const initials = React.useMemo(() => {
    const source = me?.name || me?.email || "";
    const parts = source.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return "··";
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }, [me]);

  return (
    <div className="mt-auto hidden border-t border-sidebar-foreground/15 pt-3 lg:block">
      <div className="flex items-center gap-2.5 px-2 pb-2.5">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-foreground/20 text-[10px] font-black text-primary-foreground"
        >
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-bold text-sidebar-foreground">
            {me?.name ?? "Signed in"}
          </p>
          <p className="truncate text-[10.5px] text-sidebar-foreground/60">
            {me ? (ROLE_LABEL[me.role] ?? me.role) : "Loading…"}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="flex min-h-[36px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] text-sidebar-foreground/75 transition-colors hover:bg-black/15 disabled:opacity-50"
      >
        <LogOut className="size-4 shrink-0 opacity-85" />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
