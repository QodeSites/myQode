import type React from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import QodeHeader from "@/components/qode-header"
import QodeSidebar from "@/components/qode-sidebar"
import { ClientProvider } from "@/contexts/ClientContext"
import QodeFooter from "@/components/footer"

export default async function Layout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const isAuthed = cookieStore.get("qode-auth")?.value === "1"
  if (!isAuthed) redirect("/login")

  return (
    <div className="min-h-screen">
      <ClientProvider>
        <QodeHeader />

        {/* Content area under the header */}
        <div className="mt-16 p-6">
          {/* Sidebar + Main side-by-side */}
          <div className="flex min-h-[calc(100vh-8rem)] gap-4 items-start">
            {/* Ensure sidebar doesn't shrink and has a fixed width, even if QodeSidebar itself has styles */}
            <div className="w-64 shrink-0">
              <QodeSidebar />
            </div>

            {/* Main content grows to fill remaining space */}
            <main className="flex-1 overflow-y-auto">
              <div className="w-full h-fit rounded-lg bg-card p-6">
                {children}
              </div>
            </main>
          </div>
        </div>

        <QodeFooter />
      </ClientProvider>
    </div>
  )
}
