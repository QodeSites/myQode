"use client"
import type React from "react"
import { useTransition } from "react"
import Link from "next/link"
import { MenuIcon, User } from "lucide-react"
import { useClient } from "@/contexts/ClientContext"
import { Button } from "./ui/button"

type HeaderProps = { setSidebarOpen: (open: boolean) => void }

export default function QodeDistributorHeader({ setSidebarOpen }: HeaderProps) {
  const [isPending, startTransition] = useTransition()
  const { 
    selectedClientHolderName,
    selectedClientCode,
    loading
  } = useClient()

  async function logout() {
    startTransition(async () => {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/login"
    })
  }

  // There will only be one client
  const displayName = selectedClientHolderName || selectedClientCode || "Account"

  return (
    <header className="w-full fixed top-0 left-0 right-0 z-[1000]">
      <div className="w-full border-b bg-secondary px-4 sm:px-6 md:px-8 py-4">
        <div className="mx-auto flex items-center justify-between gap-4">
          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/calculator">
              <h1 className="text-2xl sm:text-3xl font-bold text-primary leading-none">
                <sub className="text-xs sm:text-sm">my</sub>Qode
              </h1>
            </Link>
          </div>

          {/* Right: Details & Logout */}
          <div className="flex items-center gap-3">
            {!loading && (
              <div className="hidden lg:flex items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
                  <User className="h-4 w-4 text-gray-600 shrink-0" />
                  <span className="font-medium text-primary truncate max-w-[120px] sm:max-w-[160px]">
                    {displayName}
                  </span>
                </div>
                <button
                  onClick={logout}
                  disabled={isPending}
                  className="hover:bg-primary-foreground hover:text-primary rounded-md border px-3 py-2 text-sm bg-primary text-primary-foreground transition-colors"
                >
                  {isPending ? "Logging out..." : "Logout"}
                </button>
              </div>
            )}

            {/* Mobile/Tablet: Menu button on RIGHT, account/logout hidden (moved to sidebar) */}
            <Button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden rounded-md border bg-primary px-3 py-2 text-sm"
              aria-label="Open sidebar"
            >
              <MenuIcon className="h-5 w-5" />
              <span className="sr-only">Menu</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}