"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

/**
 * Where a partner raises a ticket with the Qode team.
 *
 * Tickets go into the same queue as investor queries, so the team works one
 * list. The partner is identified from their session on the server — this
 * form never asks who they are, and could not be used to write in as
 * somebody else.
 */

const TOPICS: { value: string; label: string; hint: string }[] = [
  {
    value: "onboarding",
    label: "Onboarding help",
    hint: "An account that is stuck or needs chasing",
  },
  {
    value: "investor",
    label: "Question about an investor",
    hint: "Anything specific to one of your clients",
  },
  {
    value: "payout",
    label: "Payout or brokerage",
    hint: "What you are due, and when",
  },
  {
    value: "reporting",
    label: "Reporting or statements",
    hint: "SOA, valuations, tax documents",
  },
  {
    value: "access",
    label: "Portal access",
    hint: "Logging in, or data that looks wrong",
  },
  { value: "other", label: "Other", hint: "Anything else" },
];

const MAX_MESSAGE = 4000;

export default function DistributorSupportPage() {
  const [topic, setTopic] = React.useState("");
  const [aboutInvestor, setAboutInvestor] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = React.useState<string | null>(null);

  const chosen = TOPICS.find((t) => t.value === topic);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!topic) {
      setError("Please pick what this is about.");
      return;
    }
    if (!message.trim()) {
      setError("Please tell us what you need.");
      return;
    }

    setState("sending");
    try {
      const res = await fetch("/api/distributor/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, aboutInvestor, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "We couldn't send that. Please try again.");
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError(
        "We couldn't send that. Please check your connection and try again.",
      );
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="rounded-xl border border-border/20 bg-card px-5 py-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto size-10 text-primary" />
          <h1 className="mt-3 text-lg font-semibold text-foreground">
            Ticket raised
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            The partnerships team has it and will reply to you by email. You do
            not need to send it again.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTopic("");
                setAboutInvestor("");
                setMessage("");
                setState("idle");
              }}
              className="min-h-[44px] rounded-md border border-border/20 px-4 text-sm text-foreground hover:border-primary/50"
            >
              Raise another
            </button>
            <Link
              href="/distributors"
              className="flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Back to overview
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/distributors"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Overview
      </Link>

      <h1 className="mt-3 text-xl font-semibold text-foreground">
        Raise a ticket
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us what you need and the partnerships team will reply by email.
      </p>

      <form
        onSubmit={submit}
        className="mt-5 rounded-xl border border-border/20 bg-card px-5 py-5 shadow-sm"
      >
        <fieldset>
          <legend className="text-sm font-semibold text-foreground">
            What is this about?
          </legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TOPICS.map((t) => (
              <label
                key={t.value}
                className={`flex cursor-pointer flex-col rounded-md border px-3 py-3 ${
                  topic === t.value
                    ? "border-primary bg-primary/5"
                    : "border-border/20 hover:border-primary/50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="topic"
                    value={t.value}
                    checked={topic === t.value}
                    onChange={(e) => setTopic(e.target.value)}
                    className="size-4 accent-[#02422b]"
                  />
                  <span className="text-sm font-medium text-foreground">
                    {t.label}
                  </span>
                </span>
                <span className="mt-1 pl-6 text-[12px] text-muted-foreground">
                  {t.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Only asked when it could apply — an investor name on a payout
            question is noise for whoever picks the ticket up. */}
        {topic === "investor" || topic === "onboarding" ? (
          <div className="mt-4">
            <label
              htmlFor="about-investor"
              className="text-sm font-semibold text-foreground"
            >
              Which investor?{" "}
              <span className="font-normal text-muted-foreground">
                Optional
              </span>
            </label>
            <input
              id="about-investor"
              value={aboutInvestor}
              onChange={(e) => setAboutInvestor(e.target.value)}
              placeholder="Name or email"
              className="mt-1 min-h-[44px] w-full rounded-md border border-border/20 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>
        ) : null}

        <div className="mt-4">
          <label
            htmlFor="message"
            className="text-sm font-semibold text-foreground"
          >
            What do you need?
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
            rows={6}
            placeholder={
              chosen
                ? `${chosen.hint}. The more detail you give, the fewer times we have to come back to you.`
                : "The more detail you give, the fewer times we have to come back to you."
            }
            className="mt-1 w-full rounded-md border border-border/20 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">
            {message.length} / {MAX_MESSAGE}
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state === "sending"}
            className="min-h-[44px] rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {state === "sending" ? "Sending…" : "Raise ticket"}
          </button>
          <p className="text-[12px] text-muted-foreground">
            Or email{" "}
            <a
              className="font-bold underline underline-offset-4"
              href="mailto:partnerships@qodeinvest.com"
            >
              partnerships@qodeinvest.com
            </a>{" "}
            or call{" "}
            <a
              className="font-bold underline underline-offset-4"
              href="tel:+919326535470"
            >
              +91 9326535470
            </a>
            .
          </p>
        </div>
      </form>
    </div>
  );
}
