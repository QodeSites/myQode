// components/admin-auth-provider.tsx
"use client"

import { createContext, useContext, ReactNode } from 'react'
import { useAdminAuth } from '@/hooks/use-admin-auth'

const AdminAuthContext = createContext<ReturnType<typeof useAdminAuth> | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAdminAuth()
  
  return (
    <AdminAuthContext.Provider value={auth}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuthContext() {
  const context = useContext(AdminAuthContext)
  if (!context) {
    throw new Error('useAdminAuthContext must be used within AdminAuthProvider')
  }
  return context
}