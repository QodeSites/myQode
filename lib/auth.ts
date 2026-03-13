// lib/auth.ts
import { cookies } from "next/headers"
import { query } from "@/lib/db"

export interface ClientData {
  clientid: string;
  clientcode: string;
}

export interface ExtendedClientData {
  clientid: string;
  clientcode: string;
  email: string;
  groupid: string;
  head_of_family: boolean;
}

/** Sets session cookies (qode-auth, qode-clients, qode-head-of-family, qode-user-context). Used after login and admin impersonation. */
export async function setSessionCookies(user: ExtendedClientData): Promise<void> {
  const cookieStore = await cookies()

  const { groupid, email, head_of_family } = user
  let result

  if (head_of_family) {
    result = await query(
      "SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1",
      [groupid]
    )
  } else {
    result = await query(
      "SELECT clientid, clientcode FROM pms_clients_master WHERE email = $1",
      [email]
    )
  }

  const clientData: ClientData[] = result.rows.map((row: { clientid: string; clientcode: string }) => ({
    clientid: row.clientid,
    clientcode: row.clientcode,
  }))

  cookieStore.set("qode-auth", "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  })

  cookieStore.set("qode-clients", JSON.stringify(clientData), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  })

  cookieStore.set("qode-head-of-family", user.head_of_family ? "true" : "false", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  })

  const userContext = {
    clientid: user.clientid,
    clientcode: user.clientcode,
    email: user.email,
    groupid: user.groupid,
    head_of_family: user.head_of_family,
  }

  cookieStore.set("qode-user-context", JSON.stringify(userContext), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  })
}

// Check if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies()
  const accessTokenCookie = cookieStore.get("qode-access-token")
  return !!accessTokenCookie?.value
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
  cookieStore.delete("qode-access-token")
  cookieStore.delete("qode-refresh-token")
  cookieStore.delete("qode-clients")
}