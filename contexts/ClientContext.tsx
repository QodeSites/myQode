// contexts/ClientContext.tsx
"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ClientData {
  clientid: string;
  clientcode: string;
  email: string;
  clientname: string;
  mobile: string;
  holderName?: string;
  relation?: string;
  head_of_family?: boolean;
  groupid?: string;
  groupname?: string;
}

interface ClientContextType {
  clients: ClientData[]
  selectedClientCode: string
  selectedClientId: string
  selectedClientMobile: string
  selectedClientName: string
  selectedClientHolderName: string
  isHeadOfFamily: boolean
  setSelectedClient: (clientCode: string) => void
  loading: boolean
  refresh: () => void
  selectedEmailClient: string
  setSelectedEmailClient: (email: string) => void
  clientLoading: boolean
}

const ClientContext = createContext<ClientContextType | undefined>(undefined)

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClientCode, setSelectedClientCode] = useState<string>('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [selectedEmailClient, setSelectedEmailClient] = useState<string>('')
  const [selectedClientMobile, setSelectedClientMobile] = useState<string>('')
  const [selectedClientName, setSelectedClientName] = useState<string>('')
  const [selectedClientHolderName, setSelectedClientHolderName] = useState<string>('')
  const [isHeadOfFamily, setIsHeadOfFamily] = useState<boolean>(false)
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
        
        // Set head of family status
        setIsHeadOfFamily(data.isHeadOfFamily || false);
        
        let availableClients: ClientData[] = [];

        if (data.isHeadOfFamily && data.family?.length > 0) {
          // If head of family, show all family members as selectable clients
          availableClients = data.family.map((member: any) => ({
            clientid: member.clientid,
            clientcode: member.clientcode,
            email: member.email,
            clientname: member.clientname || member.holderName,
            mobile: member.mobile,
            holderName: member.holderName,
            relation: member.relation,
            head_of_family: member.head_of_family,
            groupid: member.groupid,
            groupname: member.groupname,
          }));
          console.log('Head of family - available clients:', availableClients);
        } else if (data.clients?.length > 0) {
          // If individual member, show only their own accounts
          availableClients = data.clients.map((client: any) => ({
            clientid: client.clientid,
            clientcode: client.clientcode,
            email: client.email,
            clientname: client.clientname,
            mobile: client.mobile,
            holderName: client.clientname, // Use clientname as holderName for consistency
            relation: 'Individual Account',
            head_of_family: client.head_of_family || false,
            groupid: client.groupid,
            groupname: client.groupname,
          }));
          console.log('Individual member - available clients:', availableClients);
        }

        setClients(availableClients);

        if (availableClients.length > 0) {
          // Check localStorage for previous selection
          const savedClientCode = localStorage.getItem('selectedClientCode');
          const savedClientId = localStorage.getItem('selectedClientId');
          
          let clientToSelect: ClientData | null = null;
          
          // First, try to find the saved client in current data
          if (savedClientCode && savedClientId) {
            clientToSelect = availableClients.find((client: ClientData) => 
              client.clientcode === savedClientCode && client.clientid === savedClientId
            ) || null;
            
            if (clientToSelect) {
              console.log('Found saved client in current data:', clientToSelect);
            } else {
              console.log('Saved client not found in current data, clearing localStorage');
              clearLocalStorage();
            }
          }
          
          // If no valid saved client, default to first client (or head of family if available)
          if (!clientToSelect) {
            // For head of family, prioritize selecting the head account
            if (data.isHeadOfFamily) {
              clientToSelect = availableClients.find(c => c.head_of_family) || availableClients[0];
            } else {
              clientToSelect = availableClients[0];
            }
            console.log('Using default client:', clientToSelect);
          }
          
          // Set the selected client
          updateSelectedClient(clientToSelect);
          
        } else {
          console.log('No clients available');
          clearSelectedClient();
        }
      } else {
        console.error('Failed to fetch client data:', response.status, response.statusText);
        clearSelectedClient();
      }
    } catch (error) {
      console.error('Failed to fetch client data:', error);
      clearSelectedClient();
    } finally {
      setLoading(false);
    }
  };

  const clearLocalStorage = () => {
    localStorage.removeItem('selectedClientCode');
    localStorage.removeItem('selectedClientId');
    localStorage.removeItem('selectedEmailClient');
    localStorage.removeItem('selectedClientMobile');
    localStorage.removeItem('selectedClientName');
    localStorage.removeItem('selectedClientHolderName');
  };

  const clearSelectedClient = () => {
    setClients([]);
    setSelectedClientCode('');
    setSelectedClientId('');
    setSelectedEmailClient('');
    setSelectedClientMobile('');
    setSelectedClientName('');
    setSelectedClientHolderName('');
    setIsHeadOfFamily(false);
    clearLocalStorage();
  };

  const updateSelectedClient = (client: ClientData) => {
    setSelectedClientCode(client.clientcode);
    setSelectedClientId(client.clientid);
    setSelectedEmailClient(client.email);
    setSelectedClientMobile(client.mobile);
    setSelectedClientName(client.clientname);
    setSelectedClientHolderName(client.holderName || client.clientname);
    
    // Save to localStorage
    localStorage.setItem('selectedClientCode', client.clientcode);
    localStorage.setItem('selectedClientId', client.clientid);
    localStorage.setItem('selectedEmailClient', client.email);
    localStorage.setItem('selectedClientMobile', client.mobile);
    localStorage.setItem('selectedClientName', client.clientname);
    localStorage.setItem('selectedClientHolderName', client.holderName || client.clientname);
    
    console.log('Updated selected client:', client);
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
      updateSelectedClient(client);
    } else {
      console.warn('Client not found for code:', clientCode);
      if (clients.length > 0) {
        // Fallback to first client if invalid code
        const defaultClient = clients[0];
        updateSelectedClient(defaultClient);
        console.log('Fell back to first client:', defaultClient);
      } else {
        clearSelectedClient();
      }
    }
  };

  const value: ClientContextType = {
    clients,
    selectedClientCode,
    selectedClientId,
    selectedClientMobile,
    selectedClientName,
    selectedClientHolderName,
    isHeadOfFamily,
    setSelectedClient,
    loading,
    refresh,
    selectedEmailClient,
    setSelectedEmailClient,
    clientLoading: loading
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