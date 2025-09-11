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
  refresh: () => void // Add refresh function
}

const ClientContext = createContext<ClientContextType | undefined>(undefined)

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClientCode, setSelectedClientCode] = useState<string>('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const fetchClientData = async () => {
    try {
      console.log('Fetching client data...'); // Debug log
      setLoading(true);
      const response = await fetch('/api/auth/client-data', {
        method: 'GET',
        credentials: 'include', // Ensure cookies are sent
      });
      console.log('API response status:', response.status); // Debug log
      if (response.ok) {
        const data = await response.json();
        console.log('Client data fetched:', data); // Debug log
        const clientData = data.clients || [];
        setClients(clientData);

        const savedClientCode = localStorage.getItem('selectedClientCode');
        const validClient = clientData.find((c: ClientData) => c.clientcode === savedClientCode);

        if (savedClientCode && validClient) {
          setSelectedClient(savedClientCode);
        } else if (clientData.length > 0) {
          setSelectedClient(clientData[0].clientcode);
        } else {
          setSelectedClientCode('');
          setSelectedClientId('');
        }
      } else {
        console.error('Failed to fetch client data:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to fetch client data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Expose refresh function
  const refresh = () => {
    console.log('Manual refresh triggered'); // Debug log
    fetchClientData();
  };

  // Fetch on mount
  useEffect(() => {
    console.log('ClientProvider useEffect triggered'); // Debug log
    fetchClientData();
  }, []);

  const setSelectedClient = (clientCode: string) => {
    const client = clients.find(c => c.clientcode === clientCode);
    if (client) {
      console.log('Setting selected client:', client); // Debug log
      setSelectedClientCode(clientCode);
      setSelectedClientId(client.clientid);
      localStorage.setItem('selectedClientCode', clientCode);
      localStorage.setItem('selectedClientId', client.clientid);
    } else {
      console.warn('Client not found for code:', clientCode);
    }
  };

  const value: ClientContextType = {
    clients,
    selectedClientCode,
    selectedClientId,
    setSelectedClient,
    loading,
    refresh
  };

  return (
    <ClientContext.Provider value={value}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  const context = useContext(ClientContext);
  if (context === undefined) {
    throw new Error('useClient must be used within a ClientProvider');
  }
  return context;
}