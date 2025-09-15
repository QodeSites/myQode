"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Menu, MenuIcon, Sidebar } from "lucide-react"
import {
  Home,
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
} from "lucide-react"
import { useClient } from "@/contexts/ClientContext"

function NavLink({
  href,
  children,
  icon,
  onClose,
}: {
  href: string
  children: React.ReactNode
  icon?: React.ReactNode
  onClose?: () => void
}) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      onClick={onClose} // Trigger onClose when the link is clicked
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
  const [openAccordions, setOpenAccordions] = useState<string[]>([])
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
  // Which accordion should be open based on current path
  useEffect(() => {
    const section = pathname.split("/")[1] // first segment after root
    const map: Record<string, string> = {
      about: "about",
      experience: "experience",
      engagement: "engagement",
      trust: "trust",
    }
    const toOpen = map[section]
    if (toOpen) {
      setOpenAccordions((prev) => (prev.includes(toOpen) ? prev : [...prev, toOpen]))
    }
  }, [pathname])

  // Shared inner content
  const SidebarContent = (
    <nav className="flex flex-col gap-1 h-full">
      <NavLink href="/dashboard" icon={<Home className="h-4 w-4" />} onClose={onClose}>
        Home
      </NavLink>

      <Accordion
        type="multiple"
        className="mt-1"
        value={openAccordions}
        onValueChange={setOpenAccordions}
      >
        <AccordionItem value="about">
          <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm flex items-center gap-2">
            <Info className="h-4 w-4" />
            About Qode
          </AccordionTrigger>
          <AccordionContent className="pl-3">
            <ul className="space-y-1">
              <li>
                <NavLink href="/about/foundation" icon={<Building2 className="h-4 w-4" />} onClose={onClose}>
                  Foundation
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/strategy-snapshot" icon={<Target className="h-4 w-4" />} onClose={onClose}>
                  Strategy Snapshot
                </NavLink>
              </li>
              <li>
                <NavLink href="/about/your-team-at-qode" icon={<Users className="h-4 w-4" />} onClose={onClose}>
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
                  onClose={onClose}
                >
                  Investor Portal Guide
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/account-services" icon={<Settings className="h-4 w-4" />} onClose={onClose}>
                  Account Services
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/family-account" icon={<Users className="h-4 w-4" />} onClose={onClose}>
                  Account Mapping
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/service-cadence" icon={<Clock className="h-4 w-4" />} onClose={onClose}>
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
                  onClose={onClose}
                >
                  Your Voice Matters
                </NavLink>
              </li>
              <li>
                <NavLink href="/engagement/referral-program" icon={<Gift className="h-4 w-4" />} onClose={onClose}>
                  Referral Program
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/engagement/insights-and-events"
                  icon={<Calendar className="h-4 w-4" />}
                  onClose={onClose}
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
                  onClose={onClose}
                >
                  Client Document Vault
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/trust/risk-managment-and-controls"
                  icon={<Shield className="h-4 w-4" />}
                  onClose={onClose}
                >
                  Risk Management & Controls
                </NavLink>
              </li>
              <li>
                <NavLink
                  href="/trust/escalation-and-grievance-redressal"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  onClose={onClose}
                >
                  Escalation and Grievance Redressal
                </NavLink>
              </li>
              <li>
                <NavLink href="/trust/faq-and-glossary" icon={<HelpCircle className="h-4 w-4" />} onClose={onClose}>
                  FAQs & Glossary
                </NavLink>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="md:hidden mt-auto mb-15 pt-4">
        <div className="flex flex-col gap-2 px-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-between w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground">
              <span className="font-medium text-primary truncate max-w-[200px]">
                {selectedClientCode || (clients[0]?.clientcode ?? "Select Account")}
              </span>
              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56 z-20000">
              <DropdownMenuLabel className="text-sm text-muted-foreground">
                Accounts ({clients.length})
              </DropdownMenuLabel>
              {clients.length > 0 ? (
                clients.map((client) => (
                  <DropdownMenuItem
                    key={client.clientid}
                    onClick={() => handleClientSelect(client.clientcode)}
                    className={`cursor-pointer ${selectedClientCode === client.clientcode ? "bg-accent" : ""}`}
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
            className="w-full rounded-md border bg-primary text-primary-foreground px-3 py-2 text-sm hover:bg-primary-foreground hover:text-primary"
          >
            {isPending ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>
    </nav>
  )

  return (
    <>
      {/* Desktop / Large screens: original fixed panel */}
      <aside className="hidden lg:block sticky top-20 h-fit w-74 shrink-0 rounded-2xl border-r bg-sidebar/90 p-4">
        {SidebarContent}
      </aside>

      {/* Mobile overlay drawer */}
      <div
        className={cn(
          "lg:hidden", // only on small screens
          open ? "fixed inset-0 z-50" : "pointer-events-none"
        )}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity",
            open ? "opacity-100" : "opacity-0"
          )}
          onClick={onClose}
        />

        {/* Drawer panel */}
        <aside
          className={cn(
            "absolute right-0 top-0 h-full w-72 max-w-[85vw] translate-x-0 rounded-l-2xl border-l bg-sidebar mt-16 p-4 shadow-xl transition-transform",
            open ? "translate-x-0" : "translate-x-full"
          )}
          role="dialog"
          aria-modal="true"
        >
          {SidebarContent}
        </aside>
      </div>
    </>
  )
}