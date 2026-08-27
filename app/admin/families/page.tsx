"use client";

import * as React from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

type Member = {
  id: number;
  clientname: string | null;
  clientcode: string | null;
  headOfFamily: boolean | null;
  onboardingStatus: string | null;
};

type FamilyGroup = {
  groupid: string;
  groupname: string | null;
  memberCount: number;
  headCount: number;
  members: Member[];
};

type FamiliesResponse = {
  groups: FamilyGroup[];
  total: number;
  missingHead: number;
};

export default function AdminFamiliesPage() {
  const [data, setData] = React.useState<FamiliesResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "unauthorized" | "error">(
    "loading",
  );
  // Defaults to the work: families with nobody marked as head.
  const [missingOnly, setMissingOnly] = React.useState(true);
  const [message, setMessage] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/families", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setStatus("unauthorized");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setData((await res.json()) as FamiliesResponse);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function makeHead(groupid: string, clientId: number) {
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/families/${encodeURIComponent(groupid)}/head`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body?.error ?? "Couldn't set head of family.");
        return;
      }
      await load();
    } catch {
      setMessage("Couldn't reach the server. Please try again.");
    }
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "unauthorized") {
    return (
      <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Your session has expired.{" "}
          <a
            className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
            href="/admin/login?redirect=/admin/families"
          >
            Sign in again
          </a>{" "}
          to continue.
        </p>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <p className="text-sm text-foreground">
          We couldn&apos;t load the family list. Please refresh to try again.
        </p>
      </div>
    );
  }

  const visible = missingOnly
    ? data.groups.filter((g) => g.headCount === 0)
    : data.groups;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl">Families</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Households holding more than one account. The head of family is the person
          whose login sees the whole group.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <button
          type="button"
          onClick={() => setMissingOnly(false)}
          aria-pressed={!missingOnly}
          className={`rounded-md border px-4 py-3 text-left transition-colors hover:border-primary/50 ${
            !missingOnly ? "border-primary bg-primary/5" : "border-border/20 bg-background"
          }`}
        >
          <p className="text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
            All families
          </p>
          <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-foreground">
            {data.total}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setMissingOnly(true)}
          aria-pressed={missingOnly}
          className={`rounded-md border px-4 py-3 text-left transition-colors hover:border-primary/50 ${
            missingOnly ? "border-primary bg-primary/5" : "border-border/20 bg-background"
          }`}
        >
          <p className="text-[11px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
            Missing a head
          </p>
          <p
            className={`mt-1 font-sans text-2xl font-bold tabular-nums ${
              data.missingHead > 0 ? "text-destructive" : "text-foreground"
            }`}
          >
            {data.missingHead}
          </p>
        </button>
      </div>

      {message ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {missingOnly
              ? "Every family has a head assigned."
              : "No multi-account families found."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((g) => (
            <section
              key={g.groupid}
              className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-foreground">
                  {g.groupname ?? `Group ${g.groupid}`}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {g.memberCount} accounts
                  {g.headCount === 0 ? (
                    <span className="ml-2 text-destructive">No head assigned</span>
                  ) : null}
                </p>
              </div>

              <ul className="mt-3 flex flex-col gap-2">
                {g.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/20 bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/clients/${m.id}`}
                        className="text-sm text-foreground underline-offset-4 hover:underline"
                      >
                        {m.clientname ?? "—"}
                      </Link>
                      <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                        {m.clientcode ?? "—"}
                      </span>
                    </div>

                    {m.headOfFamily ? (
                      <span className="rounded-full border border-border/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary dark:text-primary-foreground">
                        Head
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => makeHead(g.groupid, m.id)}
                        className="min-h-[36px] shrink-0 rounded-md border border-border/20 bg-card px-3 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground dark:text-primary-foreground"
                      >
                        Set as head
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
