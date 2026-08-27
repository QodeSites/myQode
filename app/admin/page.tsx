"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * /admin sends each person to the surface their job starts from.
 *
 * Client-side because the role comes from an authenticated fetch. This is
 * convenience, not access control — every destination enforces its own role
 * check server-side, so a user who guesses another role's URL is refused
 * there regardless of what this redirect does.
 */
export default function AdminIndexPage() {
  const router = useRouter();

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { cache: "no-store" });
        if (!res.ok) {
          router.replace("/admin/login?redirect=/admin");
          return;
        }
        const me = await res.json();
        router.replace(me?.landing ?? "/admin/clients");
      } catch {
        router.replace("/admin/login?redirect=/admin");
      }
    })();
  }, [router]);

  return (
    <div className="px-1 py-8">
      <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
    </div>
  );
}
