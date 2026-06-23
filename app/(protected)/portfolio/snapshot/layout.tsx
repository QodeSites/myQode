import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "Portfolio Snapshot | myQode",
};

export default function SnapshotLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
