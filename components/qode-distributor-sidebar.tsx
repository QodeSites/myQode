"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { Calculator } from "lucide-react"

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
  // No active highlight logic needed with single link
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary hover:bg-muted/60"
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

export default function DistributorQodeSidebar({ open = false, onClose }: QodeSidebarProps) {
  // Only a simple nav with Calculator link for both desktop and mobile

  const SidebarContent = (
    <nav className="h-full flex flex-col gap-1">
      <NavLink href="/calculator" icon={<Calculator className="h-4 w-4" />}>
        Distributor Fee Calculator
      </NavLink>
    </nav>
  )

  const SidebarContentMobile = ({ onClose }: { onClose?: () => void }) => (
    <nav className="h-full flex flex-col gap-1 mt-5">
      <NavLink href="/calculator" icon={<Calculator className="h-4 w-4" />} onClick={onClose}>
        Calculator
      </NavLink>
    </nav>
  )

  return (
    <>
      {/* Desktop sidebar */}
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
            {/* Use SVG X for close */}
            <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none"><line x1="18" y1="6" x2="6" y2="18" strokeWidth="2" strokeLinecap="round"/><line x1="6" y1="6" x2="18" y2="18" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>

          <SidebarContentMobile onClose={onClose} />
        </aside>
      </div>
    </>
  )
}