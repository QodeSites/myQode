// lib/auth.ts
import { cookies } from "next/headers"
import { webSession } from "@/lib/webSession"
import { query } from "@/lib/db"

export interface ClientData {
  clientid: string;
  clientcode: string;
}

// Check if user is authenticated
// Signed session only (lib/webSession.ts): the plain qode-auth / qode-clients cookies can be forged.
export async function isAuthenticated(): Promise<boolean> {
  return !!(await webSession())
}

// Get all client data from cookies
// Client codes come from the signed session; client ids from the database for those codes.
export async function getClientData(): Promise<ClientData[]> {
  const s = await webSession()
  if (!s?.codes.length) return []
  const r = await query<ClientData>(`SELECT clientid, clientcode FROM pms_clients_master WHERE clientcode = ANY($1::text[])`, [s.codes])
  return r.rows
}

// Get all client IDs for current user
export async function getClientIds(): Promise<string[]> {
  const clients = await getClientData()
  return clients.map(client => client.clientid)
}

// Get all client codes for current user
export async function getClientCodes(): Promise<string[]> {
  const clients = await getClientData()
  return clients.map(client => client.clientcode)
}

// Get client code by client ID
export async function getClientCodeById(clientid: string): Promise<string | null> {
  const clients = await getClientData()
  const client = clients.find(c => c.clientid === clientid)
  return client?.clientcode || null
}

// Get client ID by client code
export async function getClientIdByCode(clientcode: string): Promise<string | null> {
  const clients = await getClientData()
  const client = clients.find(c => c.clientcode === clientcode)
  return client?.clientid || null
}

// Logout function - clear all auth cookies
export async function logout() {
  const cookieStore = await cookies()
  cookieStore.delete("qode-auth")
  cookieStore.delete("qode-clients")
}