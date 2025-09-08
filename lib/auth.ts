// lib/auth.ts
import { cookies } from "next/headers"

export interface ClientData {
  clientid: string;
  clientcode: string;
}

// Check if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies()
  const authCookie = cookieStore.get("qode-auth")
  return authCookie?.value === "1"
}

// Get all client data from cookies
export async function getClientData(): Promise<ClientData[]> {
  const cookieStore = await cookies()
  const clientsCookie = cookieStore.get("qode-clients")
  
  if (!clientsCookie?.value) {
    return []
  }
  
  try {
    return JSON.parse(clientsCookie.value)
  } catch (error) {
    console.error("Error parsing clients cookie:", error)
    return []
  }
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