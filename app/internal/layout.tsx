import type React from "react"
import { notFound } from "next/navigation"

export const metadata = {
  title: "Internal",
  robots: { index: false, follow: false },
}

/**
 * Internal-only surface. The collection this renders contains real service
 * endpoints and investor data, so the pages are unavailable in production
 * unless explicitly switched on.
 */
export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const enabled =
    process.env.NODE_ENV !== "production" || process.env.ENABLE_INTERNAL_DEMO === "true"

  if (!enabled) notFound()

  return <>{children}</>
}
