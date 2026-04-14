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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

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
                        <span className="font-medium text-black truncate max-w-[120px] sm:max-w-[160px]">
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
                          <span className="text-black">Family Accounts ({clients.length})</span>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                            Head of Family
                          </Badge>
                        </>
                      ) : (
                        <>
                          <User className="h-4 w-4 text-gray-600" />
                          <span className="text-black">My Accounts ({clients.length})</span>
                          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 text-xs">
                            Owner
                          </Badge>
                        </>
                      )}
                    </DropdownMenuLabel>
                    
                    <DropdownMenuSeparator />
                    
                    {clients.length > 0 ? (() => {
                      const grouped = clients.reduce((acc: Record<string, typeof clients>, c) => {
                        const key = c.groupid || c.groupname || "UNGROUPED"
                        if (!acc[key]) acc[key] = []
                        acc[key].push(c)
                        return acc
                      }, {})

                      const groupEntries = Object.entries(grouped).map(([key, groupClients]) => {
                        const groupName = groupClients[0]?.groupname || "Accounts"
                        return { key, groupName, groupClients }
                      })

                      groupEntries.sort((a, b) => {
                        const aActiveCount = a.groupClients.filter(c => c.status !== "Closed").length
                        const bActiveCount = b.groupClients.filter(c => c.status !== "Closed").length
                        if (aActiveCount !== bActiveCount) return bActiveCount - aActiveCount

                        const aHasHof = a.groupClients.some(c => c.head_of_family || c.relation === "Primary")
                        const bHasHof = b.groupClients.some(c => c.head_of_family || c.relation === "Primary")
                        if (aHasHof && !bHasHof) return -1
                        if (!aHasHof && bHasHof) return 1
                        return (a.groupName || "").localeCompare(b.groupName || "")
                      })

                      const byDisplay = (a: any, b: any) => {
                        const aPrimary = a.head_of_family || a.relation === "Primary"
                        const bPrimary = b.head_of_family || b.relation === "Primary"
                        if (aPrimary && !bPrimary) return -1
                        if (!aPrimary && bPrimary) return 1
                        const aLabel = (a.holderName || a.clientname || a.clientcode || "").toString()
                        const bLabel = (b.holderName || b.clientname || b.clientcode || "").toString()
                        return aLabel.localeCompare(bLabel)
                      }

                      const ItemRow = ({ client }: { client: any }) => (
                        <DropdownMenuItem
                          key={client.clientid}
                          onClick={() => handleClientSelect(client.clientcode)}
                          className={`cursor-pointer ${selectedClientCode === client.clientcode ? "bg-accent" : ""}`}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <div className="flex items-center gap-1 shrink-0">
                              {(client.head_of_family || client.relation === "Primary") ? (
                                <Crown className="h-3 w-3 text-blue-600" />
                              ) : isHeadOfFamily ? (
                                <div className="h-2 w-2 rounded-full bg-gray-400" />
                              ) : (
                                <User className="h-3 w-3 text-gray-600" />
                              )}
                            </div>

                            <div className="flex flex-col flex-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium truncate text-black">
                                  {client.holderName || client.clientname || client.clientcode}
                                </span>
                                {client.status === "Closed" ? (
                                  <Badge
                                    variant="outline"
                                    className="shrink-0 bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0"
                                  >
                                    Closed
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0"
                                  >
                                    Active
                                  </Badge>
                                )}
                              </div>
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

                            {selectedClientCode === client.clientcode && (
                              <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                        </DropdownMenuItem>
                      )

                      return (
                        <div className="px-1">
                          <Accordion
                            type="multiple"
                            className="w-full"
                            defaultValue={groupEntries[0] ? [groupEntries[0].key] : []}
                          >
                            {groupEntries.map((g) => {
                              const activeClients = g.groupClients.filter(c => c.status !== "Closed").sort(byDisplay)
                              const closedClients = g.groupClients.filter(c => c.status === "Closed").sort(byDisplay)

                              return (
                                <AccordionItem key={g.key} value={g.key} className="border-none">
                                  <AccordionTrigger className="text-black px-2 py-2 text-sm hover:no-underline">
                                    <div className="flex text-black items-center justify-between w-full pr-2">
                                      <span className="truncate">{g.groupName}</span>
                                      <span className="text-xs text-muted-foreground shrink-0">{g.groupClients.length}</span>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="pl-1 pr-1 pb-1">
                                    <div className="flex flex-col">
                                      {activeClients.length > 0 && (
                                        <>
                                          <div className="px-2 pt-1 pb-1">
                                            <div className="flex items-center gap-2">
                                              <div className="h-px flex-1 bg-emerald-200" />
                                              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
                                                Active accounts
                                              </span>
                                              <div className="h-px flex-1 bg-emerald-200" />
                                            </div>
                                          </div>
                                          {activeClients.map((client) => (
                                            <ItemRow key={client.clientid} client={client} />
                                          ))}
                                        </>
                                      )}

                                      {closedClients.length > 0 && (
                                        <>
                                          <div className="mt-1 px-2 pt-2 pb-1">
                                            <div className="flex items-center gap-2">
                                              <div className="h-px flex-1 bg-red-200" />
                                              <span className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">
                                                Deactive / Closed accounts
                                              </span>
                                              <div className="h-px flex-1 bg-red-200" />
                                            </div>
                                          </div>
                                          {closedClients.map((client) => (
                                            <ItemRow key={client.clientid} client={client} />
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              )
                            })}
                          </Accordion>
                        </div>
                      )
                    })() : (
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