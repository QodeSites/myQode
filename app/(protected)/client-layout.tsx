// app/client-layout.tsx
"use client";

import React, { useState, Suspense, ReactNode, useRef, useEffect } from "react";
import QodeSidebar from "@/components/qode-sidebar";
import QodeHeader from "@/components/qode-header";
import DistributorQodeSidebar from "@/components/qode-distributor-sidebar";
import QodeDistributorHeader from "@/components/qode-distributor-header";
import { useClient } from "@/contexts/ClientContext";
import { FullscreenLoader } from "./portfolio/performance/page";
import { useRouter } from "next/navigation";
import api from "@/lib/api/axios";
import { tokenStore } from "@/lib/api/token-store";

type ClientLayoutProps = {
  children: ReactNode;
};


export default function ClientLayout({ children }: ClientLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { selectedClientType } = useClient();
  const router = useRouter();
  const didBootstrap = useRef(false);

  useEffect(() => {
    // Prevent running bootstrapAuth twice (e.g. during React StrictMode or double rendering)
    if (didBootstrap.current) return;
    didBootstrap.current = true;

    async function bootstrapAuth() {
      try {
        // Only attempt refresh if there is no access token set yet
        if (!tokenStore.get()) {
          const res = await api.post("/api/auth/refresh");
          if (res.data && res.data.accessToken) {
            tokenStore.set(res.data.accessToken);
          }
        }
      } catch (err) {
        router.push("/login");
      }
    }

    bootstrapAuth();
  }, [router]);

  if (
    selectedClientType === "" ||
    typeof selectedClientType === "undefined" ||
    selectedClientType === null
  ) {
    return (
      <FullscreenLoader brand="Qode" subtitle="Loading details…" />
    );
  }

  if (selectedClientType === "DISTRIBUTORS") {
    // Distributor layout: show only the distributor sidebar (mobile/desktop)
    return (
      <>
        <QodeDistributorHeader setSidebarOpen={setSidebarOpen} />

        <div className="my-20 p-1 sm:p-6 md:p-2 flex-1">
          <div className="flex min-h-[calc(100vh-8rem)] gap-0 sm:gap-4 items-start px-2 sm:px-6 md:px-6">
            {/* Sidebar: Visible on mobile when toggled, always visible on desktop */}
            <DistributorQodeSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Page content */}
            <main className="flex-1 overflow-y-auto">
              <div className="w-full h-fit rounded-lg bg-card p-4 sm:p-6">
                <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
              </div>
            </main>
          </div>
        </div>
      </>
    );
  }

  // Default client layout
  return (
    <>
      <QodeHeader setSidebarOpen={setSidebarOpen} />
      <div className="my-20 p-1 sm:p-6 md:p-2 flex-1">
        <div className="flex min-h-[calc(100vh-8rem)] gap-0 sm:gap-4 items-start px-2 sm:px-6 md:px-6">
          {/* Sidebar: Visible on mobile when toggled, always visible on desktop */}
          <QodeSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            <div className="w-full h-fit rounded-lg bg-card p-4 sm:p-6">
              <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}