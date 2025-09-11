// app/layout.tsx
import type React from "react"
import "@/app/globals.css"
import { Suspense } from "react"
import QodeHeader from "@/components/qode-header"
import QodeSidebar from "@/components/qode-sidebar"
import QodeFooter from "@/components/footer"


export default async function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div>
            <QodeHeader />

            <div className="mt-16 p-6">
                <div className="flex min-h-[calc(100vh-8rem)] gap-4 items-start">
                    {/* Sidebar */}
                    <div className="w-74 shrink-0">
                        <QodeSidebar />
                    </div>

                    {/* Page content */}
                    <main className="flex-1 overflow-y-auto">
                        <div className="w-full h-fit rounded-lg bg-card p-6 card-shadow">
                            <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
                        </div>
                    </main>
                </div>
            </div>

            <QodeFooter />
        </div>
    )
}
