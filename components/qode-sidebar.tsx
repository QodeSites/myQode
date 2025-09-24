"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"
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
  ChevronDown,
} from "lucide-react"
import { useClient } from "@/contexts/ClientContext"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  const [openAccordions, setOpenAccordions] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const { clients, selectedClientCode, setSelectedClient } = useClient()

  const handleClientSelect = (clientCode: string) => setSelectedClient(clientCode)

  // 1) Open proper accordion from path (unchanged)
  useEffect(() => {
    const section = pathname.split("/")[1]
    const map: Record<string, string> = {
      about: "about",
      experience: "experience",
      engagement: "engagement",
      trust: "trust",
    }
    const toOpen = map[section]
    if (toOpen) {
      setOpenAccordions(prev => (prev.includes(toOpen) ? prev : [...prev, toOpen]))
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

  const SidebarContent = (
    <nav className="h-full flex flex-col gap-1">
      <NavLink href="/dashboard" icon={<Home className="h-4 w-4" />}>
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
                <NavLink
                  href="/experience/portfolio-snapshot"
                  icon={<BookOpen className="h-4 w-4" />}
                >
                  Portfolio Snapshot
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
        <div className="w-full inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
          <DropdownMenu>
            {/* Make trigger full-width for consistent dropdown sizing */}
            <DropdownMenuTrigger className="inline-flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
              <span className="font-medium text-primary truncate max-w-[70%]">
                {selectedClientCode || (clients[0]?.clientcode ?? "Select Account")}
              </span>
              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              side="bottom"
              className="w-[min(80vw,22rem)] max-h-64 overflow-y-auto z-[200]"
            >
              <DropdownMenuLabel className="text-sm text-muted-foreground sticky top-0 bg-popover">
                Accounts ({clients.length})
              </DropdownMenuLabel>

              {clients.length > 0 ? (
                clients.map((client) => (
                  <DropdownMenuItem
                    key={client.clientid}
                    onClick={() => handleClientSelect(client.clientcode)}
                    className={cn(
                      "cursor-pointer h-10",
                      selectedClientCode === client.clientcode && "bg-accent"
                    )}
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
        </div>

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
      <NavLink href="/dashboard" icon={<Home className="h-4 w-4" />} onClick={onClose}>
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
                <NavLink
                  href="/experience/portfolio-snapshot"
                  icon={<BookOpen className="h-4 w-4" />}
                >
                  Portfolio Snapshot
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
        <div className="w-full inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
          <DropdownMenu>
            {/* Make trigger full-width for consistent dropdown sizing */}
            <DropdownMenuTrigger className="inline-flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground">
              <span className="font-medium text-primary truncate max-w-[70%]">
                {selectedClientCode || (clients[0]?.clientcode ?? "Select Account")}
              </span>
              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              side="bottom"
              className="w-[min(80vw,22rem)] max-h-64 overflow-y-auto z-[200]"
            >
              <DropdownMenuLabel className="text-sm text-muted-foreground sticky top-0 bg-popover">
                Accounts ({clients.length})
              </DropdownMenuLabel>

              {clients.length > 0 ? (
                clients.map((client) => (
                  <DropdownMenuItem
                    key={client.clientid}
                    onClick={() => handleClientSelect(client.clientcode)}
                    className={cn(
                      "cursor-pointer h-10",
                      selectedClientCode === client.clientcode && "bg-accent"
                    )}
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
        </div>

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
            // fixed so it doesn’t “float” with page scroll; right-anchored drawer
            "fixed right-0 top-0 h-full w-72 max-w-[85vw] rounded-l-2xl border-l bg-sidebar shadow-xl",
            // pad for your fixed header height (adjust 64px if your header differs)
            "pt-[calc(env(safe-area-inset-top)+64px)] pb-[calc(env(safe-area-inset-bottom)+16px)] px-4",
            // make the drawer content scroll, not the page
            "overflow-y-auto overscroll-contain touch-pan-y",
            // slide-in/out
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
    </>
  )
}
