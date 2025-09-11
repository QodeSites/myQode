"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";


function TypingText({ text, speed = 80 }: { text: string; speed?: number }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= text.length) return;
    const t = setTimeout(() => setIdx((i) => i + 1), speed);
    return () => clearTimeout(t);
  }, [idx, speed, text.length]);

  return (
    <div className="flex items-center">
      <h1 className="whitespace-pre text-6xl font-extrabold tracking-tight text-primary">
        {text.slice(0, idx)}
      </h1>
      {/* Blinking caret */}
      <h1 className="ml-1 h-[1.4em] w-[0.08em] bg-primary caret-blink" />
      {/* caret styles */}
      <style jsx>{`
        @keyframes caretBlink {
          0%,
          49% {
            opacity: 1;
          }
          50%,
          100% {
            opacity: 0;
          }
        }
        .caret-blink {
          animation: caretBlink 1s step-end infinite;
        }
      `}</style>
    </div>
  );
}
export default function DashboardHome() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate loading delay (e.g., fetch, auth, etc.)
    const timer = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);





  // --- your existing component ---
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
        {/* Slide-up + fade-in container */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 16 }}
          className="flex flex-col items-center"
        >
          <TypingText text="myQode" speed={70} />

          {/* Optional subtle upscroll float while loading */}
          <motion.div
            className="mt-6 text-sm text-card-foreground"
            initial={{ y: 0 }}
            animate={{ y: [-2, 2, -2] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
          >
            Preparing your dashboard…
          </motion.div>

          {/* Minimal spinner */}
          <div className="mt-4 h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">Who We Are</h2>
        <p className="text-card-foreground">
          Qode is a SEBI-registered Portfolio Management Service (PMS) built on the principle that evidence, not
          opinion, should drive investment decisions. Founded by seasoned professionals with over a decade of experience
          in Indian markets, we exist to give investors a disciplined, transparent, and performance-oriented platform
          for long-term wealth creation.
        </p>
      </section>

      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">What We Do</h2>
        <p className="text-card-foreground">
          We design and manage differentiated investment strategies that combine the power of quantitative models with
          the insight of fundamental research. Our range spans ETF-only portfolios, systematic momentum strategies,
          diversified growth funds, and high-conviction stock picks—offering clients the flexibility to align with their
          goals and risk appetite.
        </p>
      </section>

      <section className="prose prose-sm max-w-none">
        <h2 className="text-xl font-bold text-foreground">How We Work</h2>
        <p className="text-card-foreground">
          At Qode, every investment decision is guided by data, tested frameworks, and structured review processes. We
          believe in clarity over complexity: our clients receive concise updates that explain what we hold, why we hold
          it, and when we make changes. With bank-grade custody, strong operational controls, and a proactive investor
          support team, we ensure that experience is as robust as the strategy itself.
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
  );
}
