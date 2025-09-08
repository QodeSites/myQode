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
        <div className="mx-auto flex  gap-6  py-6">
          <QodeSidebar />
          <main className=" max-w-7xl flex-1 rounded-lg bg-card p-6 card-shadow">{children}</main>
        </div>
      </ClientProvider>

    </div>
  )
}