"use client"
import type React from "react"
import { useTransition, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Menu, MenuIcon, Sidebar } from "lucide-react"
import { useClient } from "@/contexts/ClientContext"
import { Button } from "./ui/button"
import Link from "next/link"


type FamilyAccount = {
  clientid: string
  clientcode: string
  holderName: string
  relation: string
  status: string
}

type HeaderProps = { setSidebarOpen: (open: boolean) => void }

export default function QodeHeader({ setSidebarOpen }: HeaderProps) {
  const [isPending, startTransition] = useTransition()
  const { clients, selectedClientCode, setSelectedClient, loading } = useClient()
  console.log(clients)

  async function logout() {
    startTransition(async () => {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/login"
    })
  }

  const handleClientSelect = (clientCode: string) => setSelectedClient(clientCode)

  if (loading) {
    return (
      <header className="w-full fixed top-0 left-0 right-0 z-10">
        <div className="border-b bg-secondary px-4 sm:px-6 md:px-8 py-4">
          <div className="mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link href="/">
                <span className="font-serif text-2xl sm:text-3xl font-bold text-primary leading-none">
                  <sub className="text-xs sm:text-sm">my</sub>Qode
                </span>
              </Link>

            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground animate-pulse">
                <span className="h-4 w-16 bg-gray-300 rounded"></span>
              </div>
              <button disabled className="rounded-md border px-3 py-2 text-sm bg-primary text-primary-foreground">
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="w-full fixed top-0 left-0 right-0 z-1000">
      <div className="w-full border-b bg-secondary px-4 sm:px-6 md:px-8 py-4">
        <div className="mx-auto flex flex-row items-center justify-between gap-6">
          {/* Mobile menu button */}
          <div className="w-full md:max-w-content flex flex-row items-center">
            <Link href="/">
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-primary leading-none">
                <sub className="text-xs sm:text-sm">my</sub>Qode
              </h1>
            </Link>
            <div className="ml-auto">
              <Button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden block rounded-md border bg-primary px-3 py-2 text-sm"
                aria-label="Open sidebar"
              >
                <MenuIcon className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </div>
          </div>
          {/* Right section */}
          <div className="hidden md:flex lg:flex flex-row items-center gap-3 sm:gap-4">
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
              className="rounded-md bg-primary text-primary-foreground border px-3 py-2 text-sm hover:bg-primary-foreground hover:text-primary"
            >
              {isPending ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
