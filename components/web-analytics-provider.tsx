'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { WebAnalytics } from '@/lib/web-analytics'
import { useClient } from '@/contexts/ClientContext'

// Auto-tracks page views + identifies the logged-in client once known.
// Mount once near the root of the protected app.
export function WebAnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { selectedEmailClient } = useClient()
  const identifiedRef = useRef<string | null>(null)
  const lastTracked = useRef<string | null>(null)

  useEffect(() => {
    if (selectedEmailClient && identifiedRef.current !== selectedEmailClient) {
      WebAnalytics.identify(selectedEmailClient)
      identifiedRef.current = selectedEmailClient
    }
  }, [selectedEmailClient])

  useEffect(() => {
    if (!pathname || pathname === lastTracked.current) return
    lastTracked.current = pathname
    WebAnalytics.screen(pathname, { page_path: pathname })
  }, [pathname])

  useEffect(() => {
    const handleBeforeUnload = () => WebAnalytics.flush()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return <>{children}</>
}
