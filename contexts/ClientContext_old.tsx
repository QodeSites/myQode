// contexts/ClientContext.tsx
"use client"

import api from '@/lib/api/axios';
import { tokenStore } from '@/lib/api/token-store';
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
  clienttype: string; // Make clienttype required and always a string
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
  selectedClientType: string
  setSelectedClientType: (type: string) => void
  clientLoading: boolean
}

const ClientContext = createContext<ClientContextType | undefined>(undefined)

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClientCode, setSelectedClientCode] = useState<string>('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [selectedClientType, setSelectedClientType] = useState<string>('')
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
      const response = await api.get('/api/auth/client-data');
      console.log('API response status:', response.status);

      if (response.status === 401) {
        // Handle unauthenticated user
        console.log('Unauthorized (401): clearing client state due to authentication error');
        clearSelectedClient();
        // Optionally, trigger a redirect or other action here if needed
      } else if (response.data.ok) {
        const data = await response.data();
        console.log('Client data fetched:', data);

        setIsHeadOfFamily(data.isHeadOfFamily || false);

        let availableClients: ClientData[] = [];

        if (data.isHeadOfFamily && data.family?.length > 0) {
          // For head of family, ensure clienttype is always a string (fallback empty string if missing)
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
            clienttype: typeof member.clienttype === 'string' ? member.clienttype : "",
          }));
          console.log('Head of family - available clients:', availableClients);
        } else if (data.clients?.length > 0) {
          availableClients = data.clients.map((client: any) => ({
            clientid: client.clientid,
            clientcode: client.clientcode,
            email: client.email,
            clientname: client.clientname,
            mobile: client.mobile,
            holderName: client.clientname,
            relation: 'Individual Account',
            head_of_family: !!client.head_of_family,
            groupid: client.groupid,
            groupname: client.groupname,
            clienttype: typeof client.clienttype === 'string' ? client.clienttype : "",
          }));
          console.log('Individual member - available clients:', availableClients);
        }

        setClients(availableClients);

        if (availableClients.length > 0) {
          const savedClientCode = localStorage.getItem('selectedClientCode');
          const savedClientId = localStorage.getItem('selectedClientId');

          let clientToSelect: ClientData | null = null;

          if (savedClientCode && savedClientId) {
            clientToSelect = availableClients.find(
              (client: ClientData) =>
                client.clientcode === savedClientCode && client.clientid === savedClientId
            ) || null;

            if (clientToSelect) {
              console.log('Found saved client in current data:', clientToSelect);
            } else {
              console.log('Saved client not found in current data, clearing localStorage');
              clearLocalStorage();
            }
          }

          if (!clientToSelect) {
            if (data.isHeadOfFamily) {
              clientToSelect = availableClients.find(c => c.head_of_family) || availableClients[0];
            } else {
              clientToSelect = availableClients[0];
            }
            console.log('Using default client:', clientToSelect);
          }

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
    localStorage.removeItem('selectedClientType');
    localStorage.removeItem('selectedClientHolderName');
  };

  const clearSelectedClient = () => {
    setClients([]);
    setSelectedClientType('');
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
    setSelectedClientType(client.clienttype ?? "");
    setSelectedClientHolderName(client.holderName || client.clientname);

    // Always provide a string to localStorage, never undefined
    localStorage.setItem('selectedClientCode', client.clientcode);
    localStorage.setItem('selectedClientId', client.clientid);
    localStorage.setItem('selectedEmailClient', client.email);
    localStorage.setItem('selectedClientMobile', client.mobile);
    localStorage.setItem('selectedClientName', client.clientname);
    localStorage.setItem('selectedClientType', client.clienttype ?? "");
    localStorage.setItem('selectedClientHolderName', client.holderName || client.clientname);

    console.log('Updated selected client:', client);
  };

  const refresh = async () => {
    console.log('Manual refresh triggered');
    await fetchClientData();
    
    console.log(tokenStore.get(),"===========fetchClientData set ")
  };

  useEffect(() => {
    console.log('ClientProvider useEffect triggered');
    fetchClientData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientType]);

  const setSelectedClient = (clientCode: string) => {
    const client = clients.find((c: ClientData) => c.clientcode === clientCode);
    if (client) {
      console.log('Setting selected client:', client);
      updateSelectedClient(client);
    } else {
      console.warn('Client not found for code:', clientCode);
      if (clients.length > 0) {
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
    selectedClientType,
    setSelectedClientType ,
    clientLoading: loading,
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