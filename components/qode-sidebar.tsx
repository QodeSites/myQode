"use client"

import type React from "react"
import { useEffect, useState } from "react"
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
} from "lucide-react"

function NavLink({
  href,
  children,
  icon,
}: {
  href: string
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
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
    <nav className="flex flex-col gap-1">
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
                <NavLink href="/experience/account-services" icon={<Settings className="h-4 w-4" />}>
                  Account Services
                </NavLink>
              </li>
              <li>
                <NavLink href="/experience/family-account" icon={<Users className="h-4 w-4" />}>
                  Family Account
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
            "absolute left-0 top-0 h-full w-72 max-w-[85vw] translate-x-0 rounded-r-2xl border-r bg-sidebar mt-16 p-4 shadow-xl transition-transform",
            open ? "translate-x-0" : "-translate-x-full"
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
