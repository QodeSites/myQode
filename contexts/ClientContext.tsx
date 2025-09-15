// contexts/ClientContext.tsx
"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ClientData {
  clientid: string;
  clientcode: string;
  email: string
}

interface ClientContextType {
  clients: ClientData[]
  selectedClientCode: string
  selectedClientId: string
  setSelectedClient: (clientCode: string) => void
  loading: boolean
  refresh: () => void
  selectedEmailClient: string,
  setSelectedEmailClient:string
}

const ClientContext = createContext<ClientContextType | undefined>(undefined)

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClientCode, setSelectedClientCode] = useState<string>('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [selectedEmailClient, setSelectedEmailClient] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const fetchClientData = async () => {
    try {
      console.log('Fetching client data...');
      setLoading(true);
      const response = await fetch('/api/auth/client-data', {
        method: 'GET',
        credentials: 'include',
      });
      console.log('API response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Client data fetched:', data);
        const clientData = data.clients || [];
        setClients(clientData);

        if (clientData.length > 0) {
          // Check localStorage for previous selection
          const savedClientCode = localStorage.getItem('selectedClientCode');
          const savedClientId = localStorage.getItem('selectedClientId');
          const savedEmailClient = localStorage.getItem('selectedEmailClient');
          
          let clientToSelect: ClientData | null = null;
          
          // First, try to find the saved client in current data
          if (savedClientCode && savedClientId) {
            clientToSelect = clientData.find((client: ClientData) => 
              client.clientcode === savedClientCode && client.clientid === savedClientId
            ) || null;
            
            if (clientToSelect) {
              console.log('Found saved client in current data:', clientToSelect);
            } else {
              console.log('Saved client not found in current data, clearing localStorage');
              localStorage.removeItem('selectedClientCode');
              localStorage.removeItem('selectedClientId');
              localStorage.removeItem('selectedEmailClient');
            }
          }
          
          // If no valid saved client, default to first client
          if (!clientToSelect) {
            clientToSelect = clientData[0];
            console.log('Using first client as default:', clientToSelect);
          }
          
          // Set the selected client
          setSelectedClientCode(clientToSelect.clientcode);
          setSelectedClientId(clientToSelect.clientid);
          setSelectedEmailClient(clientToSelect.email);
          
          // Save to localStorage if it's not already saved or if it's different
          if (savedClientCode !== clientToSelect.clientcode || savedClientId !== clientToSelect.clientid) {
            localStorage.setItem('selectedClientCode', clientToSelect.clientcode);
            localStorage.setItem('selectedClientId', clientToSelect.clientid);
            localStorage.setItem('selectedEmailClient', clientToSelect.email);
            console.log('Updated localStorage with client:', clientToSelect);
          }
          
        } else {
          console.log('No clients available');
          setSelectedClientCode('');
          setSelectedClientId('');
          localStorage.removeItem('selectedClientCode');
          localStorage.removeItem('selectedClientId');
          localStorage.removeItem('selectedEmailClient');
        }
      } else {
        console.error('Failed to fetch client data:', response.status, response.statusText);
        setClients([]);
        setSelectedClientCode('');
        setSelectedClientId('');
        localStorage.removeItem('selectedClientCode');
        localStorage.removeItem('selectedClientId');
        localStorage.removeItem('selectedEmailClient');
      }
    } catch (error) {
      console.error('Failed to fetch client data:', error);
      setClients([]);
      setSelectedClientCode('');
      setSelectedClientId('');
      localStorage.removeItem('selectedClientCode');
      localStorage.removeItem('selectedClientId');
      localStorage.removeItem('selectedEmailClient');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    console.log('Manual refresh triggered');
    await fetchClientData();
  };

  useEffect(() => {
    console.log('ClientProvider useEffect triggered');
    fetchClientData();
  }, []);

  const setSelectedClient = (clientCode: string) => {
    const client = clients.find(c => c.clientcode === clientCode);
    if (client) {
      console.log('Setting selected client:', client);
      setSelectedClientCode(client.clientcode);
      setSelectedClientId(client.clientid);
      localStorage.setItem('selectedClientCode', client.clientcode);
      localStorage.setItem('selectedClientId', client.clientid);
      localStorage.removeItem('selectedEmailClient');
    } else {
      console.warn('Client not found for code:', clientCode);
      if (clients.length > 0) {
        // Fallback to first client if invalid code
        const defaultClient = clients[0];
        setSelectedClientCode(defaultClient.clientcode);
        setSelectedClientId(defaultClient.clientid);
        setSelectedEmailClient(defaultClient.email)
        localStorage.setItem('selectedClientCode', defaultClient.clientcode);
        localStorage.setItem('selectedClientId', defaultClient.clientid);
        localStorage.setItem('selectedEmailClient',defaultClient.email);
        console.log('Fell back to first client:', defaultClient);
      } else {
        setSelectedClientCode('');
        setSelectedClientId('');
        localStorage.removeItem('selectedClientCode');
        localStorage.removeItem('selectedClientId');
        localStorage.removeItem('selectedEmailClient');
      }
    }
  };

  const value: ClientContextType = {
    clients,
    selectedClientCode,
    selectedClientId,
    setSelectedClient,
    loading,
    refresh,
    selectedEmailClient,
    setSelectedEmailClient
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