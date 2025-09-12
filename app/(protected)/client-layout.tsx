// app/client-layout.tsx
"use client";

import { useState } from "react";
import QodeSidebar from "@/components/qode-sidebar";
import { Suspense } from "react";
import QodeHeader from "@/components/qode-header";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

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