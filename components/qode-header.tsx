"use client"
import { useTransition, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown } from "lucide-react"
import { useClient } from "@/contexts/ClientContext"

export default function QodeHeader() {
  const [isPending, startTransition] = useTransition()
  const { clients, selectedClientCode, setSelectedClient, loading } = useClient()

  // Auto-select first account if none is selected and clients are available
  useEffect(() => {
    if (!loading && clients.length > 0 && !selectedClientCode) {
      setSelectedClient(clients[0].clientcode)
    }
  }, [clients, selectedClientCode, setSelectedClient, loading])

  async function logout() {
    startTransition(async () => {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/login"
    })
  }

  const handleClientSelect = (clientCode: string) => {
    setSelectedClient(clientCode)
  }

  if (loading) {
    return (
      <header className="w-full border-b bg-secondary px-6 py-4">
        <div className="mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-serif text-3xl font-bold text-primary leading-none">
              <sub className="text-sm">my</sub>Qode
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground animate-pulse">
              <span className="h-4 w-16 bg-gray-300 rounded"></span>
            </div>
            <button
              disabled
              className="rounded-md border px-3 py-2 text-sm text-foreground opacity-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="w-full border-b bg-secondary px-6 py-4">
      <div className="mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-serif text-3xl font-bold text-primary leading-none">
            <sub className="text-sm">my</sub>Qode
          </span>
        </div>
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
              <span className="font-medium text-primary">
                {selectedClientCode || (clients.length > 0 ? clients[0].clientcode : 'Select Account')}
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel className="text-sm text-muted-foreground">
                Accounts ({clients.length})
              </DropdownMenuLabel>
              {clients.length > 0 ? (
                clients.map((client) => (
                  <DropdownMenuItem 
                    key={client.clientid}
                    onClick={() => handleClientSelect(client.clientcode)}
                    className={`cursor-pointer ${
                      selectedClientCode === client.clientcode ? 'bg-accent' : ''
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{client.clientcode}</span>
                      <span className="text-xs text-muted-foreground">{client.clientid}</span>
                    </div>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  No accounts found
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={logout}
            disabled={isPending}
            className="rounded-md border px-3 py-2 text-sm text-foreground disabled:opacity-50"
          >
            {isPending ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </div>
    </header>
  )
}