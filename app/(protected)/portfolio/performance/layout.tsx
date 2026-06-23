import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "Portfolio Performance | myQode",
};

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
