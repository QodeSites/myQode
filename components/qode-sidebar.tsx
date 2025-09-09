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
  Info
} from "lucide-react"

function NavLink({ href, children, icon }: { href: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary",
        active ? "bg-background text-primary" : "",
      )}
    >
      {icon}
      {children}
    </Link>
  )
}

export default function QodeSidebar() {
  const pathname = usePathname()
  const [openAccordions, setOpenAccordions] = useState<string[]>([])

  // Determine which accordion should be open based on current path
  useEffect(() => {
    const pathSegments = pathname.split('/')
    const section = pathSegments[1] // First segment after root
    
    const accordionMap: Record<string, string> = {
      'about': 'about',
      'experience': 'experience', 
      'engagement': 'engagement',
      'trust': 'trust'
    }

    const accordionToOpen = accordionMap[section]
    if (accordionToOpen) {
      setOpenAccordions(prev => 
        prev.includes(accordionToOpen) ? prev : [...prev, accordionToOpen]
      )
    }
  }, [pathname])

  return (
    <aside className="w-[20%] shrink-0 border-r bg-sidebar p-4 h-full rounded-2xl ml-2 opacity-80">
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
            <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm  flex items-center gap-2">
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
            <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm  flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Your Qode Experience
            </AccordionTrigger>
            <AccordionContent className="pl-3">
              <ul className="space-y-1">
                <li>
                  <NavLink href="/experience/investor-portal-guide" icon={<BookOpen className="h-4 w-4" />}>
                    Investor Portal Guide
                  </NavLink>
                </li>
                <li>
                  <NavLink href="/experience/account-services" icon={<Settings className="h-4 w-4" />}>
                    Account Services
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
            <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm  flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Engagement & Growth
            </AccordionTrigger>
            <AccordionContent className="pl-3">
              <ul className="space-y-1">
                <li>
                  <NavLink href="/engagement/your-voice-matters" icon={<MessageSquare className="h-4 w-4" />}>
                    Your Voice Matters
                  </NavLink>
                </li>
                <li>
                  <NavLink href="/engagement/referral-program" icon={<Gift className="h-4 w-4" />}>
                    Referral Program
                  </NavLink>
                </li>
                <li>
                  <NavLink href="/engagement/insights-and-events" icon={<Calendar className="h-4 w-4" />}>
                    Insights & Events
                  </NavLink>
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="trust">
            <AccordionTrigger className="rounded-md px-3 py-2 text-left text-sm  flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Trust & Security
            </AccordionTrigger>
            <AccordionContent className="pl-3">
              <ul className="space-y-1">
                <li>
                  <NavLink href="/trust/client-document-vault" icon={<FileKey className="h-4 w-4" />}>
                    Client Document Vault
                  </NavLink>
                </li>
                <li>
                  <NavLink href="/trust/risk-managment-and-controls" icon={<Shield className="h-4 w-4" />}>
                    Risk Management & Controls
                  </NavLink>
                </li>
                <li>
                  <NavLink href="/trust/escalation-and-grievance-redressal" icon={<AlertTriangle className="h-4 w-4" />}>
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
    </aside>
  )
}