// contexts/ClientContext.tsx
"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ClientData {
  clientid: string;
  clientcode: string;
}

interface ClientContextType {
  clients: ClientData[]
  selectedClientCode: string
  selectedClientId: string
  setSelectedClient: (clientCode: string) => void
  loading: boolean
}

const ClientContext = createContext<ClientContextType | undefined>(undefined)

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClientCode, setSelectedClientCode] = useState<string>('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  // Fetch client data on mount
  useEffect(() => {
    async function fetchClientData() {
      try {
        const response = await fetch('/api/auth/client-data')
        if (response.ok) {
          const data = await response.json()
          const clientData = data.clients || []
          setClients(clientData)
          
          // Check for saved selection in localStorage
          const savedClientCode = localStorage.getItem('selectedClientCode')
          
          if (savedClientCode && clientData.find((c: ClientData) => c.clientcode === savedClientCode)) {
            // Use saved selection if it exists and is valid
            setSelectedClient(savedClientCode)
          } else if (clientData.length > 0) {
            // Set first client as default
            setSelectedClient(clientData[0].clientcode)
          }
        }
      } catch (error) {
        console.error('Failed to fetch client data:', error)
      } finally {
        setLoading(false)
      }
    }
    
    fetchClientData()
  }, [])

  const setSelectedClient = (clientCode: string) => {
    const client = clients.find(c => c.clientcode === clientCode)
    if (client) {
      setSelectedClientCode(clientCode)
      setSelectedClientId(client.clientid)
      localStorage.setItem('selectedClientCode', clientCode)
      localStorage.setItem('selectedClientId', client.clientid)
    }
  }

  const value: ClientContextType = {
    clients,
    selectedClientCode,
    selectedClientId,
    setSelectedClient,
    loading
  }

  return (
    <ClientContext.Provider value={value}>
      {children}
    </ClientContext.Provider>
  )
}

export function useClient() {
  const context = useContext(ClientContext)
  if (context === undefined) {
    throw new Error('useClient must be used within a ClientProvider')
  }
  return context
}