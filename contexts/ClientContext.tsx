"use client"
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode
} from "react";
import api from "@/lib/api/axios";
import { tokenStore } from "@/lib/api/token-store";

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
  clienttype: string;
}

interface ClientContextType {
  clients: ClientData[];
  selectedClientCode: string;
  selectedClientId: string;
  selectedClientMobile: string;
  selectedClientName: string;
  selectedClientHolderName: string;
  selectedClientType: string;
  selectedEmailClient: string;
  isHeadOfFamily: boolean;
  loading: boolean;
  unauthorized: boolean;
  setSelectedClient: (clientCode: string) => Promise<void>;
  refresh: () => Promise<void>;
  setSelectedEmailClient: (email: string) => void;
  setSelectedClientType: (type: string) => void;
  clearAllClientData?: () => Promise<void>;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

const STORAGE_KEYS = {
  code: "selectedClientCode",
  id: "selectedClientId",
  email: "selectedEmailClient",
  mobile: "selectedClientMobile",
  name: "selectedClientName",
  type: "selectedClientType",
  holderName: "selectedClientHolderName"
} as const;

type StorageKey = keyof typeof STORAGE_KEYS;

function getClientStorage(keys: StorageKey[]): Record<string, string> {
  const result: Record<string, string> = {};
  keys.forEach((key) => {
    const val = localStorage.getItem(STORAGE_KEYS[key]);
    if (val !== null && val !== undefined) {
      result[STORAGE_KEYS[key]] = val;
    }
  });
  return result;
}

function clearClientStorage() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}

function setClientStorage(obj: Partial<Record<StorageKey, string>>) {
  Object.entries(obj).forEach(([k, v]) => {
    localStorage.setItem(STORAGE_KEYS[k as StorageKey], v ?? "");
  });
}

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientData[]>([]);
  const [selectedClientCode, setSelectedClientCode] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedClientType, setSelectedClientType] = useState("");
  const [selectedEmailClient, setSelectedEmailClient] = useState("");
  const [selectedClientMobile, setSelectedClientMobile] = useState("");
  const [selectedClientName, setSelectedClientName] = useState("");
  const [selectedClientHolderName, setSelectedClientHolderName] = useState("");
  const [isHeadOfFamily, setIsHeadOfFamily] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const initialized = useRef(false);

  // Clear all stored data AND context state
  const clearAllClientData = async () => {
    setClients([]);
    setSelectedClientCode("");
    setSelectedClientId("");
    setSelectedClientType("");
    setSelectedEmailClient("");
    setSelectedClientMobile("");
    setSelectedClientName("");
    setSelectedClientHolderName("");
    setIsHeadOfFamily(false);
    setLoading(false);
    setUnauthorized(false);
    clearClientStorage();
  };

  const clearSelectedClient = async () => {
    setClients([]);
    setSelectedClientCode("");
    setSelectedClientId("");
    setSelectedClientType("");
    setSelectedEmailClient("");
    setSelectedClientMobile("");
    setSelectedClientName("");
    setSelectedClientHolderName("");
    setIsHeadOfFamily(false);
    clearClientStorage();
  };

  const updateSelectedClient = async (client: ClientData) => {
    setSelectedClientCode(client.clientcode);
    setSelectedClientId(client.clientid);
    setSelectedEmailClient(client.email);
    setSelectedClientMobile(client.mobile);
    setSelectedClientName(client.clientname);
    setSelectedClientType(client.clienttype);
    setSelectedClientHolderName(client.holderName || client.clientname);

    setClientStorage({
      code: client.clientcode,
      id: client.clientid,
      email: client.email,
      mobile: client.mobile,
      name: client.clientname,
      type: client.clienttype,
      holderName: client.holderName || client.clientname
    });
  };

  const fetchClientData = async () => {
    try {
      setLoading(true);
      setUnauthorized(false);
      const res = await api.get("/api/auth/client-data");
      const data = res.data;

      setIsHeadOfFamily(!!data.isHeadOfFamily);

      let availableClients: ClientData[] = [];

      if (data.isHeadOfFamily && data.family?.length) {
        availableClients = data.family.map((m: any) => ({
          clientid: m.clientid,
          clientcode: m.clientcode,
          email: m.email,
          clientname: m.clientname || m.holderName,
          mobile: m.mobile,
          holderName: m.holderName,
          relation: m.relation,
          head_of_family: m.head_of_family,
          groupid: m.groupid,
          groupname: m.groupname,
          clienttype: typeof m.clienttype === "string" ? m.clienttype : ""
        }));
      } else if (data.clients?.length) {
        availableClients = data.clients.map((c: any) => ({
          clientid: c.clientid,
          clientcode: c.clientcode,
          email: c.email,
          clientname: c.clientname,
          mobile: c.mobile,
          holderName: c.clientname,
          relation: "Individual Account",
          head_of_family: !!c.head_of_family,
          groupid: c.groupid,
          groupname: c.groupname,
          clienttype: typeof c.clienttype === "string" ? c.clienttype : ""
        }));
      }
      setClients(availableClients);

      if (!availableClients.length) {
        await clearSelectedClient();
        return;
      }

      const storage = getClientStorage(["code", "id"]);

      let selected =
        availableClients.find(
          (c) =>
            c.clientcode === storage[STORAGE_KEYS.code] &&
            c.clientid === storage[STORAGE_KEYS.id]
        ) ||
        (data.isHeadOfFamily
          ? availableClients.find((c) => c.head_of_family)
          : availableClients[0]) ||
        availableClients[0];

      // Make sure to set the client type from selected, if present
      setSelectedClientType(selected?.clienttype || "");
      console.log(selected?.clienttype)

      await updateSelectedClient(selected);
    } catch (err: any) {
      console.log(err,":ffffffffffffffffetch data")
      if (err?.response?.status === 401) {
        setUnauthorized(true);
        // tokenStore.clear();
      }
      await clearSelectedClient();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    fetchClientData();
  }, []);

  const setSelectedClient = async (clientCode: string) => {
    const client = clients.find((c) => c.clientcode === clientCode);
    if (client) await updateSelectedClient(client);
  };

  const refresh = async () => {
    console.log("===============referesh hit")
    await fetchClientData();
    console.log(tokenStore.get(),"===========fetchClientData set ")
  };

  const value: ClientContextType = {
    clients,
    selectedClientCode,
    selectedClientId,
    selectedClientMobile,
    selectedClientName,
    selectedClientHolderName,
    selectedClientType,
    selectedEmailClient,
    isHeadOfFamily,
    loading,
    unauthorized,
    setSelectedClient,
    refresh,
    setSelectedEmailClient,
    setSelectedClientType,
    clearAllClientData // optional on context type
  };

  return (
    <ClientContext.Provider value={value}>
      {children}
    </ClientContext.Provider>
  );
}

export async function clearAllClientData() {
  clearClientStorage();
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error("useClient must be used within ClientProvider");
  }
  return ctx;
}