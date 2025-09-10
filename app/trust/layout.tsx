import type React from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import QodeHeader from "@/components/qode-header"
import QodeSidebar from "@/components/qode-sidebar"
import { ClientProvider } from "@/contexts/ClientContext"

export default async function EngagementLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const isAuthed = cookieStore.get("qode-auth")?.value === "1"
  if (!isAuthed) redirect("/login")

  return (
    <div className="min-h-screen">
          <ClientProvider>
            <QodeHeader />
            <div className="flex justify-center content-center gap-2 py-6">
              <QodeSidebar />
    
              <main className="w-[80%] flex">
                <div className="w-full mr-2 ml-2  rounded-lg bg-card p-6 card-shadow">{children}
                </div>
              </main>
            </div>
          </ClientProvider>
    
        </div>
  )
}