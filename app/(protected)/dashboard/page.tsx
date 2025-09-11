"use client";
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/* Small helper: per-letter staggered reveal (wave) */
function LetterReveal({
  text,
  className = "",
  delay = 0.15, // initial delay before the wave starts
  stagger = 0.045, // time between letters
  rise = 14, // how much each letter lifts on reveal
}: {
  text: string;
  className?: string;
  delay?: number;
  stagger?: number;
  rise?: number;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <span className={className}>{text}</span>;
  }

  const container = {
    hidden: { opacity: 1 }, // keep container visible; we animate letters
    visible: {
      opacity: 1,
      transition: {
        delayChildren: delay,
        staggerChildren: stagger,
        ease: "easeOut",
      },
    },
  };

  const letter = {
    hidden: { y: rise, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
    },
  };

  // Preserve spaces with nbsp so layout doesn’t collapse
  const chars = Array.from(text).map((ch) => (ch === " " ? "\u00A0" : ch));

  return (
    <motion.span
      className={`inline-flex select-none ${className}`}
      variants={container}
      initial="hidden"
      animate="visible"
      aria-label={text}
      role="heading"
    >
      {chars.map((ch, i) => (
        <motion.span key={`${ch}-${i}`} variants={letter} className="inline-block will-change-transform">
          {ch}
        </motion.span>
      ))}
    </motion.span>
  );
}

/* =========================
   Fullscreen, calming loader
   - Brand: letter-by-letter wave reveal
   - Subtitle: gentle breathing
   - Shimmer progress bar
   - Smooth slide-up exit
   - Honors prefers-reduced-motion
   ========================= */
function FullscreenLoader({
  brand = "myQode",
  subtitle = "Preparing your dashboard…",
}: {
  brand?: string;
  subtitle?: string;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      initial={{ y: 0, opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "-100%", opacity: 0.98 }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
      className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-[1px] flex items-center justify-center"
      aria-label="Loading"
    >
      {/* Soft vignette */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background:radial-gradient(60%_50%_at_50%_50%,theme(colors.primary/20),transparent_60%)]" />
      {/* Gentle vertical fade */}
      <div className="pointer-events-none absolute inset-0 [background:linear-gradient(180deg,transparent,theme(colors.background)_60%)]" />

      <div className="relative flex flex-col items-center px-6">
        {/* Brand: wave reveal per letter */}
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-primary">
          <LetterReveal text={brand} delay={0.1} stagger={0.05} rise={16} />
        </h1>

        {/* Subtitle: breathing opacity (reduced-motion = static) */}
        <motion.div
          className="mt-4 text-sm sm:text-base text-card-foreground"
          initial={prefersReduced ? { opacity: 1 } : { opacity: 0.6 }}
          animate={prefersReduced ? { opacity: 1 } : { opacity: [0.6, 1, 0.6] }}
          transition={prefersReduced ? {} : { repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
        >
          {subtitle}
        </motion.div>

        {/* Progress shimmer bar */}
        <div className="mt-6 w-56 sm:w-64 h-1.5 rounded-full bg-primary/10 overflow-hidden">
          <motion.span
            className="block h-full w-1/3 bg-primary/60"
            initial={{ x: "-100%" }}
            animate={{ x: ["-100%", "150%"] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
  );
}

/* =========================
   Example page using loader
   ========================= */
export default function DashboardHome() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate bootstrapping (auth, initial fetch, etc.)
    const t = setTimeout(() => setLoading(false), 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <AnimatePresence mode="wait">
        {loading && <FullscreenLoader brand="myQode" subtitle="Preparing your dashboard…" />}
      </AnimatePresence>

      {/* Page content */}
      <div className="space-y-8 p-6">
        <section className="prose prose-sm max-w-none">
          <h2 className="text-xl font-bold text-foreground">Who We Are</h2>
          <p className="text-card-foreground">
            Qode is a SEBI-registered Portfolio Management Service (PMS) built on the principle that evidence, not
            opinion, should drive investment decisions. Founded by seasoned professionals with over a decade of
            experience in Indian markets, we exist to give investors a disciplined, transparent, and performance-oriented
            platform for long-term wealth creation.
          </p>
        </section>

        <section className="prose prose-sm max-w-none">
          <h2 className="text-xl font-bold text-foreground">What We Do</h2>
          <p className="text-card-foreground">
            We design and manage differentiated investment strategies that combine the power of quantitative models with
            the insight of fundamental research. Our range spans ETF-only portfolios, systematic momentum strategies,
            diversified growth funds, and high-conviction stock picks—offering clients the flexibility to align with
            their goals and risk appetite.
          </p>
        </section>

        <section className="prose prose-sm max-w-none">
          <h2 className="text-xl font-bold text-foreground">How We Work</h2>
          <p className="text-card-foreground">
            At Qode, every investment decision is guided by data, tested frameworks, and structured review processes. We
            believe in clarity over complexity: our clients receive concise updates that explain what we hold, why we
            hold it, and when we make changes. With bank-grade custody, strong operational controls, and a proactive
            investor support team, we ensure the experience is as robust as the strategy itself.
          </p>
        </section>

        <section className="prose prose-sm max-w-none">
          <h2 className="text-xl font-bold text-foreground">Why It Matters</h2>
          <p className="text-card-foreground">
            Markets are noisy and narratives change quickly. Qode’s approach is designed to cut through that noise. By
            combining systematic rigor with long-term conviction, we aim to protect portfolios in challenging times while
            positioning them to capture opportunities that can compound meaningfully over years.
          </p>
        </section>
      </div>
    </>
  );
}
