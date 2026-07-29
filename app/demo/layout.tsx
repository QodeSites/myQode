// Standalone layout for the payment-flow demo.
//
// Deliberately does NOT reuse (protected)/client-layout: this route has its own
// simulated sign-in and must render without the portal chrome, so that what a
// viewer sees is the demo and nothing else.
//
// It also sits outside the (protected) group on purpose — see page.tsx for why
// the simulated login never touches the real auth cookie.
import type React from "react";
import "@/app/globals.css";

export const metadata = {
  title: "myQode — Payment Flow Demo",
  description: "Demonstration of the Razorpay payment integration. Sample data only.",
  // Keep this route out of search results; it is meant to be shared by link.
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
