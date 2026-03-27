"use client"
import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { ChevronDown, MenuIcon, Crown, User, Users, X } from "lucide-react"
import { useClient } from "@/contexts/ClientContext"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type HeaderProps = { setSidebarOpen: (open: boolean) => void }

export default function QodeHeader({ setSidebarOpen }: HeaderProps) {
  const [isPending, startTransition] = useTransition()
  const [fpOpen, setFpOpen] = useState(false)
  const [fpEmail, setFpEmail] = useState("")
  const [fpSending, setFpSending] = useState(false)
  const [fpMsg, setFpMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const { 
    clients, 
    selectedClientCode,
    selectedClientHolderName,
    selectedEmailClient,
    isHeadOfFamily,
    setSelectedClient, 
    loading 
  } = useClient()
  
  console.log('Header clients:', clients);
  console.log('Is head of family:', isHeadOfFamily);
  
  const handleClientSelect = (clientCode: string) => setSelectedClient(clientCode)

  async function logout() {
    startTransition(async () => {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/login"
    })
  }

  const openForgot = () => {
    setFpMsg(null)
    setFpEmail(selectedEmailClient || "")
    setFpOpen(true)
  }

  const closeForgot = () => {
    setFpOpen(false)
    setFpMsg(null)
    setFpEmail("")
  }

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFpMsg(null)
    setFpSending(true)
    try {
      const resp = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail.trim() }),
      })
      const data = await resp.json()

      if (!resp.ok) {
        throw new Error(data.error || "Could not send reset email")
      }

      setFpMsg({
        type: "success",
        text: "If that email exists, a reset link has been sent. Be sure to check your email",
      })

      setTimeout(() => {
        closeForgot()
      }, 2000)
    } catch (err) {
      setFpMsg({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      })
    } finally {
      setFpSending(false)
    }
  }

  // Get current selected client for additional info
  const selectedClient = clients.find(c => c.clientcode === selectedClientCode)
  const displayName = selectedClientHolderName || selectedClient?.holderName || selectedClientCode || "Select Account"

  return (
    <>
      <header className="w-full fixed top-0 left-0 right-0 z-[1000]">
        <div className="w-full border-b bg-secondary px-4 sm:px-6 md:px-8 py-4">
          <div className="mx-auto flex items-center justify-between gap-4">
            {/* Left: Logo */}
            <div className="flex items-center">
              <Link href="/">
                <h1 className="text-2xl sm:text-3xl font-bold text-primary leading-none">
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
                    <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
                      <div className="flex items-center gap-2">
                        {/* Role indicator icon */}
                        {isHeadOfFamily ? (
                          <Crown className="h-4 w-4 text-blue-600 shrink-0" />
                        ) : (
                          <User className="h-4 w-4 text-gray-600 shrink-0" />
                        )}
                        <span className="font-medium text-primary truncate max-w-[120px] sm:max-w-[160px]">
                          {displayName}
                        </span>
                      </div>
                      <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-64 z-20000">
                    {/* Header with role indicator */}
                    <DropdownMenuLabel className="flex items-center gap-2 text-sm">
                      {isHeadOfFamily ? (
                        <>
                          <Users className="h-4 w-4 text-blue-600" />
                          <span>Family Accounts ({clients.length})</span>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                            Head of Family
                          </Badge>
                        </>
                      ) : (
                        <>
                          <User className="h-4 w-4 text-gray-600" />
                          <span>My Accounts ({clients.length})</span>
                          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 text-xs">
                            Owner
                          </Badge>
                        </>
                      )}
                    </DropdownMenuLabel>
                    
                    <DropdownMenuSeparator />
                    
                    {clients.length > 0 ? (
                      clients.map((client) => (
                        <DropdownMenuItem
                          key={client.clientid}
                          onClick={() => handleClientSelect(client.clientcode)}
                          className={`cursor-pointer ${
                            selectedClientCode === client.clientcode ? "bg-accent" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 w-full">
                            {/* Client role indicator */}
                            <div className="flex items-center gap-1 shrink-0">
                              {client.head_of_family ? (
                                <Crown className="h-3 w-3 text-blue-600" />
                              ) : isHeadOfFamily ? (
                                <div className="h-2 w-2 rounded-full bg-gray-400" />
                              ) : (
                                <User className="h-3 w-3 text-gray-600" />
                              )}
                            </div>
                            
                            {/* Client details */}
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="font-medium truncate">
                                {client.holderName || client.clientname}
                              </span>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="truncate">{client.clientcode}</span>
                                {isHeadOfFamily && client.relation && (
                                  <>
                                    <span>•</span>
                                    <span className="truncate">{client.relation}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            
                            {/* Selected indicator */}
                            {selectedClientCode === client.clientcode && (
                              <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>No accounts found</DropdownMenuItem>
                    )}
                    
                      {/* Role explanation */}
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        {isHeadOfFamily ? (
                          "As head of family, you can view all family accounts"
                        ) : (
                          "Owner account access only"
                        )}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={openForgot} className="cursor-pointer text-primary">
                        Forgot password?
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

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

      {fpOpen && (
        <div
          aria-modal="true"
          role="dialog"
          className="fixed inset-0 z-[2000] flex items-center justify-center"
        >
          <button
            aria-label="Close"
            onClick={closeForgot}
            className="absolute inset-0 bg-black/50"
          />
          <div className="relative w-full max-w-md rounded-lg border bg-card p-5 mx-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Reset your password</h2>
              <button
                onClick={closeForgot}
                className="p-1 rounded-md hover:bg-muted/60"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              Enter your account email. If it exists, we&apos;ll send a reset link.
            </p>

            {fpMsg && (
              <div
                className={`mb-3 rounded-md px-3 py-2 text-sm ${
                  fpMsg.type === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {fpMsg.text}
              </div>
            )}

            <form onSubmit={handleForgotSubmit} className="space-y-3">
              <div className="grid gap-2">
                <label htmlFor="header-fp-email" className="text-sm font-medium">Email</label>
                <input
                  id="header-fp-email"
                  type="email"
                  required
                  value={fpEmail}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value.includes("@")) {
                      setFpEmail(value.toLowerCase())
                    } else {
                      setFpEmail(value)
                    }
                  }}
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring"
                  placeholder="you@example.com"
                  disabled={fpSending}
                  autoComplete="email"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeForgot}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted/40"
                  disabled={fpSending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={fpSending || !fpEmail.trim()}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {fpSending ? "Sending..." : "Send reset link"}
                </button>
              </div>
            </form>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Tip: The email may take a minute. Also check your spam folder.
            </p>
          </div>
        </div>
      )}
    </>
  )
}