"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The partner's onboarding links, and how to reach us.
 *
 * Separated from the overview because referring is something a partner does
 * occasionally, while checking the book is daily — mixing the two made the
 * dashboard open on a setup task.
 */

type JourneyResponse = {
  distributor: { name: string; email: string };
  /** Null when no onboarding slug is recorded for this partner. */
  referralLinks: { individual: string; nonIndividual: string } | null;
};

function CopyLinkRow({
  label,
  hint,
  url,
}: {
  label: string;
  hint: string;
  url: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The URL
      // is on screen and selectable, so this is an inconvenience, not a dead end.
      setCopied(false);
    }
  }, [url]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/20 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="text-[12px] text-muted-foreground">{hint}</p>
        <code className="mt-1.5 block break-all text-xs text-foreground">{url}</code>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the ${label} link`}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md border border-border/20 bg-card px-4 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground dark:text-primary-foreground"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function DistributorReferralsPage() {
  const [data, setData] = React.useState<JourneyResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "forbidden" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/distributor/journey", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setStatus("forbidden");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        setData((await res.json()) as JourneyResponse);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Onboarding Link</h1>
        <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            This page is for Qode distribution partners. If you think you should have
            access, email{" "}
            <a
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
              href="mailto:partnerships@qodeinvest.com"
            >
              partnerships@qodeinvest.com
            </a>
             or call{" "}
            <a
              className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
              href="tel:+919326535470"
            >
              +91 9326535470
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex w-full flex-col gap-5 pb-10">
        <h1 className="text-2xl">Onboarding Link</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t load your links. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 pb-10">
      <div>
        <Link
          href="/distributors"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Overview
        </Link>
        <h1 className="mt-2 text-2xl">Onboarding Link</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send someone the right link and their account is recorded against your
          name automatically.
        </p>
      </div>

      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        {data.referralLinks ? (
          <div className="flex flex-col gap-3">
            <CopyLinkRow
              label="For an individual"
              hint="A person investing in their own name"
              url={data.referralLinks.individual}
            />
            <CopyLinkRow
              label="For a company, LLP, HUF or trust"
              hint="Anything that is not an individual"
              url={data.referralLinks.nonIndividual}
            />
          </div>
        ) : (
          <div className="rounded-md border border-border/20 bg-background px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Your referral links haven&apos;t been set up yet. Email{" "}
              <a
                className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
                href="mailto:partnerships@qodeinvest.com"
              >
                partnerships@qodeinvest.com
              </a>{" "}
              and we&apos;ll create them for you.
            </p>
          </div>
        )}
      </section>

      <a
        href="mailto:partnerships@qodeinvest.com"
        className="flex items-start gap-3 rounded-xl border border-border/20 bg-card px-5 py-4 shadow-sm hover:border-primary/50"
      >
        <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            Questions about your investors or payouts?
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Email partnerships@qodeinvest.com — we usually reply the same day.
          </p>
        </div>
      </a>
    </div>
  );
}
