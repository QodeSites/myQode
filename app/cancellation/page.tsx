'use client'

// import { cookies } from "next/headers"
// import { redirect } from "next/navigation"
import QodeHeader from "@/components/qode-header"
import QodeSidebar from "@/components/qode-sidebar"
import { ClientProvider } from "@/contexts/ClientContext"
import QodeFooter from "@/components/footer"

export default async function Page() {
  // const cookieStore = await cookies()
  // const isAuthed = cookieStore.get("qode-auth")?.value === "1"
  // if (!isAuthed) redirect("/login")

  return (
    <div className="min-h-screen">
      <ClientProvider>
        <QodeHeader />
        <div className="flex min-h-lvh gap-2 py-6 mt-16 p-6">
          <div className="w-64 shrink-0">
            <QodeSidebar />
          </div>

          {/* Main content grows to fill remaining space */}
          <main className="flex-1 overflow-y-auto">
              <div className="w-full h-fit rounded-lg bg-card px-10 py-20 card-shadow flex flex-col content-center text-center gap-3">
                <h1 className="text-4xl">Refund and Cancellation</h1>
                <span className="text-lg">
                  As a portfolio management service, Qode does not offer refunds or cancellations. All investments are actively managed on your behalf and are subject to market risks; once investment decisions are executed, they cannot be undone. Please review your investment commitments carefully before proceeding.
                </span>
              </div>
            </main>
        </div>
        <QodeFooter />
      </ClientProvider>

    </div>
  )
}