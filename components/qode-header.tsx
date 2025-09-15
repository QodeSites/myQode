"use client"
import type React from "react"
import { useTransition } from "react"
import Link from "next/link"
import { ChevronDown, MenuIcon } from "lucide-react"
import { useClient } from "@/contexts/ClientContext"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type HeaderProps = { setSidebarOpen: (open: boolean) => void }

export default function QodeHeader({ setSidebarOpen }: HeaderProps) {
  const [isPending, startTransition] = useTransition()
  const { clients, selectedClientCode,setSelectedClient, loading } = useClient()
  const handleClientSelect = (clientCode: string) => setSelectedClient(clientCode)

  async function logout() {
    startTransition(async () => {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/login"
    })
  }

  return (
    <header className="w-full fixed top-0 left-0 right-0 z-[1000]">
      <div className="w-full border-b bg-secondary px-4 sm:px-6 md:px-8 py-4">
        <div className="mx-auto flex items-center justify-between gap-4">
          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/">
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-primary leading-none">
                <sub className="text-xs sm:text-sm">my</sub>Qode
              </h1>
            </Link>
          </div>

          {/* Right: Menu button (mobile/tablet), desktop extras */}
          <div className="flex items-center gap-3">
            {/* Desktop (≥lg): show account + logout in header */}
            {!loading && (
              <div className="hidden lg:flex items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
                    <span className="font-medium text-primary truncate max-w-[120px] sm:max-w-[160px]">
                      {selectedClientCode || (clients[0]?.clientcode ?? "Select Account")}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56 z-20000">
                    <DropdownMenuLabel className="text-sm text-muted-foreground">
                      Accounts ({clients.length})
                    </DropdownMenuLabel>
                    {clients.length > 0 ? (
                      clients.map((client) => (
                        <DropdownMenuItem
                          key={client.clientid}
                          onClick={() => handleClientSelect(client.clientcode)}
                          className={`cursor-pointer ${selectedClientCode === client.clientcode ? "bg-accent" : ""
                            }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{client.clientcode}</span>
                            <span className="text-xs text-muted-foreground">{client.clientid}</span>
                          </div>
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>No accounts found</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={logout}
                  disabled={isPending}
                  className="hover:bg-primary-foreground hover:text-primary rounded-md border px-3 py-2 text-sm bg-primary text-primary-foreground"
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
