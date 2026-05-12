'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackScreen, ensureAnalytics } from '@/lib/firebase-client'

// Auto-tracks page views as Firebase Analytics screen_view events.
// Mount once near the root of the app; safe to render server-side (no-ops).
export function FirebaseAnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastTracked = useRef<string | null>(null)

  // Initialize on mount
  useEffect(() => {
    ensureAnalytics()
  }, [])

  // Fire a screen_view on every route change
  useEffect(() => {
    if (!pathname) return
    const fullPath = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname
    if (fullPath === lastTracked.current) return
    lastTracked.current = fullPath
    trackScreen(pathname, {
      page_path: fullPath,
      page_title: typeof document !== 'undefined' ? document.title : undefined,
    })
  }, [pathname, searchParams])

  return <>{children}</>
}
