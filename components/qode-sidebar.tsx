"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"
import {
  Building2,
  Target,
  Users,
  BookOpen,
  Settings,
  Clock,
  MessageSquare,
  Gift,
  Calendar,
  Shield,
  FileKey,
  AlertTriangle,
  HelpCircle,
  Info,
  X,
  ChevronDown,
  Crown,
  User,
  TrendingUp,
  BarChart3,
} from "lucide-react"
import { useClient } from "@/contexts/ClientContext"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

function NavLink({
  href,
  children,
  icon,
  onClick,
}: {
  href: string
  children: React.ReactNode
  icon?: React.ReactNode
  onClick?: () => void
}) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary hover:bg-muted/60",
        active && "bg-background text-primary"
      )}
    >
      {icon}
      {children}
    </Link>
  )
}

type QodeSidebarProps = {
  /** Controls the mobile overlay */
  open?: boolean
  /** Called when clicking backdrop or close button (mobile) */
  onClose?: () => void
}

export default function QodeSidebar({ open = false, onClose }: QodeSidebarProps) {
  const pathname = usePathname()
  const [openAccordions, setOpenAccordions] = useState<string[]>(["portfolio"])
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
    selectedClientType
  } = useClient()
  console.log(clients,selectedClientType,"=====================SelectedClientType")
  const handleClientSelect = (clientCode: string) => setSelectedClient(clientCode)

  // Get the display name (same logic as header)
  const selectedClient = clients.find(c => c.clientcode === selectedClientCode)
  const displayName = selectedClientHolderName || selectedClient?.holderName || selectedClient?.clientname || selectedClientCode || (clients[0]?.holderName || clients[0]?.clientname || clients[0]?.clientcode) || "Select Account"

  // 1) Open proper accordion from path
  useEffect(() => {
    const section = pathname.split("/")[1]
    const map: Record<string, string> = {
      portfolio: "portfolio",
      about: "about",
      experience: "experience",
      engagement: "engagement",
      trust: "trust",
    }
    const toOpen = map[section]
    if (toOpen) {
  setOpenAccordions([toOpen])
}
  }, [pathname])

  // 2) LOCK scroll when drawer is open
  useEffect(() => {
    const el = document.documentElement
    if (open) {
      // Prevent the background from scrolling under the overlay
      el.style.overflow = "hidden"
    } else {
      el.style.overflow = ""
    }
    return () => {
      el.style.overflow = ""
    }
  }, [open])

  // 3) CLOSE drawer on route change (after a link is tapped)
  useEffect(() => {
    if (open) onClose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

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

  // Reusable mobile account dropdown component (matches header styling)
  const MobileAccountDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
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

      <DropdownMenuContent align="end" className="min-w-64 z-[200]">
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

        {clients.length > 0 ? (() => {
          const grouped = clients.reduce((acc: Record<string, typeof clients>, c) => {
            const key = c.groupid || c.groupname || "UNGROUPED"
            if (!acc[key]) acc[key] = []
            acc[key].push(c)
            return acc
          }, {})

          const groupEntries = Object.entries(grouped).map(([key, groupClients]) => {
            const groupName = groupClients[0]?.groupname || "Accounts"
            const groupId = groupClients[0]?.groupid || key
            return { key, groupId, groupName, groupClients }
          })

          // Stable ordering: group with most active accounts first, then primary presence, then name
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

          return (
            <div className="px-1">
              <Accordion
                type="multiple"
                className="w-full"
                defaultValue={groupEntries[0] ? [groupEntries[0].key] : []}
              >
                {groupEntries.map((g) => (
                  <AccordionItem key={g.key} value={g.key} className="border-none">
                    <AccordionTrigger className="px-2 py-2 text-sm hover:no-underline">
                      <div className="flex text-black items-center justify-between w-full pr-2">
                        <span className="truncate">
                          {g.groupName}
                        </span>
                        <span className="text-xs text-black shrink-0">
                          {g.groupClients.length}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pl-1 pr-1 pb-1">
                      {(() => {
                        const isClosed = (c: any) => c.status === "Closed"
                        const activeClients = g.groupClients.filter(c => !isClosed(c))
                        const closedClients = g.groupClients.filter(c => isClosed(c))

                        // Within each section: head-of-family first, then by display label
                        const byDisplay = (a: any, b: any) => {
                          const aPrimary = a.head_of_family || a.relation === "Primary"
                          const bPrimary = b.head_of_family || b.relation === "Primary"
                          if (aPrimary && !bPrimary) return -1
                          if (!aPrimary && bPrimary) return 1
                          const aLabel = (a.holderName || a.clientname || a.clientcode || "").toString()
                          const bLabel = (b.holderName || b.clientname || b.clientcode || "").toString()
                          return aLabel.localeCompare(bLabel)
                        }
                        activeClients.sort(byDisplay)
                        closedClients.sort(byDisplay)

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
                        )
                      })()}
                    </AccordionContent>
                  </AccordionItem>
                ))}
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
  )

  const SidebarContent = (
    <nav className="h-full flex flex-col gap-1">
      <Accordion
        type="multiple"
        className="mt-1"
        value={openAccordions}
        onValueChange={setOpenAccordions}
      >
        <AccordionItem value="portfolio">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Portfolio
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink href="/portfolio/performance" icon={<BarChart3 className="h-4 w-4" />}>
                  Performance
                </NavLink>
              </li>
              <li>
                <NavLink href="/portfolio/snapshot" icon={<BookOpen className="h-4 w-4" />}>
                  Snapshot
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="about">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <Info className="h-4 w-4" />
            About Qode
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink href="/about/qode-philosophy" icon={<Building2 className="h-4 w-4" />}>
                  Qode Philosophy
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/foundation" icon={<Building2 className="h-4 w-4" />}>
                  Foundation
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/strategy-snapshot" icon={<Target className="h-4 w-4" />}>
                  Strategy Snapshot
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/your-team-at-qode" icon={<Users className="h-4 w-4" />}>
                  Your Team At Qode
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="experience">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Your Qode Experience
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink
                  href="/experience/investor-portal-guide"
                  icon={<BookOpen className="h-4 w-4" />}
                >
                  Investor Portal Guide
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/account-services" icon={<Settings className="h-4 w-4" />}>
                  Account Services
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/family-account" icon={<Users className="h-4 w-4" />}>
                  Account Mapping
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/service-cadence" icon={<Clock className="h-4 w-4" />}>
                  Service Cadence
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="engagement">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Engagement & Growth
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink
                  href="/engagement/your-voice-matters"
                  icon={<MessageSquare className="h-4 w-4" />}
                >
                  Your Voice Matters
                </NavLink>
              </li>
              <li>
                <NavLink href="/engagement/referral-program" icon={<Gift className="h-4 w-4" />}>
                  Referral Program
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/engagement/insights-and-events"
                  icon={<Calendar className="h-4 w-4" />}
                >
                  Insights & Events
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="trust">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Trust & Security
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink
                  href="/trust/client-document-vault"
                  icon={<FileKey className="h-4 w-4" />}
                >
                  Client Document Vault
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/trust/risk-managment-and-controls"
                  icon={<Shield className="h-4 w-4" />}
                >
                  Risk Management & Controls
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/trust/escalation-and-grievance-redressal"
                  icon={<AlertTriangle className="h-4 w-4" />}
                >
                  Escalation and Grievance Redressal
                </NavLink>
              </li>
              <li>
                <NavLink href="/trust/faq-and-glossary" icon={<HelpCircle className="h-4 w-4" />}>
                  FAQs & Glossary
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Mobile-only: account dropdown + logout */}
      <div className="flex gap-2 mb-15 mt-auto flex-col md:hidden">
        <MobileAccountDropdown />

        <button
          onClick={logout}
          disabled={isPending}
          className="hover:bg-primary-foreground hover:text-primary rounded-md border px-3 py-2 text-sm bg-primary text-primary-foreground"
        >
          {isPending ? "Logging out..." : "Logout"}
        </button>
      </div>
    </nav>
  )

  const SidebarContentMobile = ({ onClose }: { onClose?: () => void }) => (
    <nav className="h-full flex flex-col gap-1 mt-5">
      <Accordion
        type="multiple"
        className="mt-1"
        value={openAccordions}
        onValueChange={setOpenAccordions}
      >
        <AccordionItem value="portfolio">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Portfolio
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink href="/portfolio/performance" icon={<BarChart3 className="h-4 w-4" />} onClick={onClose}>
                  Performance
                </NavLink>
              </li>
              <li>
                <NavLink href="/portfolio/snapshot" icon={<BookOpen className="h-4 w-4" />} onClick={onClose}>
                  Snapshot
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="about">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <Info className="h-4 w-4" />
            About Qode
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink href="/about/foundation" icon={<Building2 className="h-4 w-4" />} onClick={onClose}>
                  Foundation
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/strategy-snapshot" icon={<Target className="h-4 w-4" />} onClick={onClose}>
                  Strategy Snapshot
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/your-team-at-qode" icon={<Users className="h-4 w-4" />} onClick={onClose}>
                  Your Team At Qode
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="experience">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Your Qode Experience
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink
                  href="/experience/investor-portal-guide"
                  icon={<BookOpen className="h-4 w-4" />}
                  onClick={onClose}
                >
                  Investor Portal Guide
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/account-services" icon={<Settings className="h-4 w-4" />} onClick={onClose}>
                  Account Services
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/family-account" icon={<Users className="h-4 w-4" />} onClick={onClose}>
                  Account Mapping
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/service-cadence" icon={<Clock className="h-4 w-4" />} onClick={onClose}>
                  Service Cadence
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="engagement">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Engagement & Growth
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink
                  href="/engagement/your-voice-matters"
                  icon={<MessageSquare className="h-4 w-4" />}
                  onClick={onClose}
                >
                  Your Voice Matters
                </NavLink>
              </li>
              <li>
                <NavLink href="/engagement/referral-program" icon={<Gift className="h-4 w-4" />} onClick={onClose}>
                  Referral Program
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/engagement/insights-and-events"
                  icon={<Calendar className="h-4 w-4" />}
                  onClick={onClose}
                >
                  Insights & Events
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="trust">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Trust & Security
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink
                  href="/trust/client-document-vault"
                  icon={<FileKey className="h-4 w-4" />}
                  onClick={onClose}
                >
                  Client Document Vault
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/trust/risk-managment-and-controls"
                  icon={<Shield className="h-4 w-4" />}
                  onClick={onClose}
                >
                  Risk Management & Controls
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/trust/escalation-and-grievance-redressal"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  onClick={onClose}
                >
                  Escalation and Grievance Redressal
                </NavLink>
              </li>
              <li>
                <NavLink href="/trust/faq-and-glossary" icon={<HelpCircle className="h-4 w-4" />} onClick={onClose}>
                  FAQs & Glossary
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Mobile-only: account dropdown + logout */}
      <div className="flex gap-2 mb-5 mt-auto flex-col md:hidden">
        <MobileAccountDropdown />

        <button
          onClick={logout}
          disabled={isPending}
          className="hover:bg-primary-foreground hover:text-primary rounded-md border px-3 py-2 text-sm bg-primary text-primary-foreground"
        >
          {isPending ? "Logging out..." : "Logout"}
        </button>
      </div>
    </nav>
  )

  return (
    <>
      {/* Desktop sidebar (unchanged) */}
      <aside className="hidden lg:block sticky top-20 h-fit w-74 shrink-0 rounded-2xl border-r bg-sidebar/90 p-4">
        {SidebarContent}
      </aside>

      {/* MOBILE OVERLAY DRAWER */}
      <div
        className={cn("lg:hidden", open ? "fixed inset-0 z-50" : "pointer-events-none")}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          className={cn(
            "fixed inset-0 bg-black/40 transition-opacity",
            open ? "opacity-100" : "opacity-0"
          )}
          onClick={onClose}
        />

        {/* Drawer panel */}
        <aside
          className={cn(
            "fixed right-0 top-0 h-full w-72 max-w-[85vw] rounded-l-2xl border-l bg-sidebar shadow-xl",
            "pt-[calc(env(safe-area-inset-top)+64px)] pb-[calc(env(safe-area-inset-bottom)+16px)] px-4",
            "overflow-y-auto overscroll-contain touch-pan-y",
            "transition-transform",
            open ? "translate-x-0" : "translate-x-full"
          )}
          role="dialog"
          aria-modal="true"
        >
          {/* Close button */}
          <button
            aria-label="Close"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted/60"
          >
            <X className="h-5 w-5" />
          </button>

          <SidebarContentMobile onClose={onClose} />
        </aside>
      </div>

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
                <label htmlFor="sidebar-fp-email" className="text-sm font-medium">Email</label>
                <input
                  id="sidebar-fp-email"
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