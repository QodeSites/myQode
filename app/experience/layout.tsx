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
            <div className="flex min-h-lvh justify-center content-center gap-2 py-6">
              <QodeSidebar />
    
              <main className="w-[80%] flex">
                <div className="w-full h-fit mr-2 ml-2  rounded-lg bg-card p-6 card-shadow">{children}
                </div>
              </main>
            </div>
            <QodeFooter />
          </ClientProvider>
    
        </div>
  )
}