// Builds the mobile JWT payload (and the `user` object the app receives) for an investor or a distributor.
// Shared by /api/mobile/auth/login (a real sign-in) and /api/admin/bo/impersonate (target 'app'), so an
// impersonated session is exactly what that person would get by signing in.
import { query } from '@/lib/db'
import type { MobileAuthUser } from '@/lib/mobileAuth'
import { resolveDistributorByEmail, type DistributorIdentity } from '@/lib/distributorIdentity'

export type LoginRow = {
  clientid: string
  clientcode: string | null
  email: string
  groupid: string
  password: string | null
  head_of_family: boolean
  ownerid: string | null
  salutation: string | null
  firstname: string | null
  middlename: string | null
  lastname: string | null
}

export type MobileSession = { payload: MobileAuthUser; user: Record<string, any> }

/** The row a login identifier (email or client code) signs in as: the head-of-family row first. */
export async function findLoginRow(identifier: string): Promise<LoginRow | null> {
  const r = await query(
    `SELECT clientid, clientcode, email, groupid, password, head_of_family, ownerid,
            salutation, firstname, middlename, lastname
     FROM pms_clients_master
     WHERE (email = $1 OR UPPER(clientcode) = UPPER($1))
     ORDER BY head_of_family DESC NULLS LAST, clientcode ASC
     LIMIT 1`,
    [identifier]
  )
  return (r.rows[0] as LoginRow) ?? null
}

export function distributorMobileSession(loginEmail: string, distributor: DistributorIdentity): MobileSession {
  const payload: MobileAuthUser = {
    userId: distributor.email,
    email: loginEmail,
    clientCode: '',
    clientId: '',
    accountCodes: [],
    ownerIds: [],
    groupId: '',
    isHeadOfFamily: false,
    isDistributor: true,
    distributorName: distributor.clientname,
  }
  return {
    payload,
    user: {
      clientId: '', clientCode: '', name: distributor.clientname, email: loginEmail,
      accountCodes: [], isHeadOfFamily: false, isSuperAdmin: false,
      isDistributor: true, role: 'distributor',
    },
  }
}

/** Active (not matured) accounts an investor row can see: the whole group for a head of family, else by email. */
export async function investorActiveAccounts(user: LoginRow, tag = '[login]'): Promise<any[]> {
  let accountsResult
  let accountsFetchMethod: string

  if (user.head_of_family) {
    accountsResult = await query(
      `SELECT clientid, clientcode, ownerid, maturity_date FROM pms_clients_master
       WHERE groupid = $1
         AND (maturity_date IS NULL OR maturity_date > NOW())`,
      [user.groupid]
    )
    accountsFetchMethod = `groupid=${user.groupid} (head of family)`

    // Edge case: entire group may be matured (e.g. client moved to a new group).
    // Fall back to email lookup so active accounts in other groups are still visible.
    if (accountsResult.rows.length === 0) {
      console.log(`${tag} group has 0 active accounts — falling back to email lookup`, {
        groupid: user.groupid,
        email:   user.email,
      })
      accountsResult = await query(
        `SELECT clientid, clientcode, ownerid, maturity_date FROM pms_clients_master
         WHERE email = $1
           AND (maturity_date IS NULL OR maturity_date > NOW())`,
        [user.email]
      )
      accountsFetchMethod = `email=${user.email} (fallback — group fully matured)`
    }
  } else {
    accountsResult = await query(
      `SELECT clientid, clientcode, ownerid, maturity_date FROM pms_clients_master
       WHERE email = $1
         AND (maturity_date IS NULL OR maturity_date > NOW())`,
      [user.email]
    )
    accountsFetchMethod = `email=${user.email}`
  }

  console.log(`${tag} accounts fetched →`, {
    method:   accountsFetchMethod,
    count:    accountsResult.rows.length,
    accounts: accountsResult.rows.map((a: any) => ({
      clientcode:    a.clientcode,
      ownerid:       a.ownerid,
      maturity_date: a.maturity_date ?? 'NULL (open-ended)',
    })),
  })
  return accountsResult.rows
}

/**
 * True when every account for this email exists but has matured (the portfolio is fully closed). Called only
 * when investorActiveAccounts came back empty.
 */
export async function allAccountsClosed(email: string, tag = '[login]'): Promise<boolean> {
  const allAccountsResult = await query(
    `SELECT clientcode, maturity_date
     FROM pms_clients_master
     WHERE email = $1`,
    [email]
  )

  const allRows = allAccountsResult.rows
  const hasAnyRow = allRows.length > 0
  const allMatured = hasAnyRow && allRows.every(
    (r: any) => r.maturity_date && new Date(r.maturity_date) <= new Date()
  )

  console.log(`${tag} no active accounts →`, {
    email,
    totalRows:   allRows.length,
    allMatured,
    maturityDates: allRows.map((r: any) => ({
      clientcode:    r.clientcode,
      maturity_date: r.maturity_date ?? 'NULL',
    })),
  })
  return allMatured
}

/** accountCodes for the JWT: individual codes (QLF excluded) plus owner and group consolidated codes. */
export function investorAccountCodes(user: LoginRow, accounts: any[], tag = '[login]'): string[] {
  // Exclude QLF (Qode Liquid Fund) accounts — not offered through the mobile app.
  const individualCodes: string[] = accounts
    .map((a: any) => a.clientcode)
    .filter((code: string) => Boolean(code) && !code.toUpperCase().startsWith('QLF'))

  // Include group-level and owner-level consolidated account codes so the
  // portfolio APIs (which check accountCodes) allow GROUP/OWNER aggregated views.
  // These match rows in pms_master_sheet where account_code = groupid / ownerid.
  // NOTE: these are deliberately NOT stripped of their ".0" suffix.
  // ownerid/groupid are stored float-formatted ("65941.0") and the mobile app
  // sends that same raw value as `accountId`. The portfolio routes authorise
  // with a strict `accountCodes.includes(accountId)`, so normalising here
  // would make every GROUP/OWNER request 403. The suffix is stripped at the
  // point of the DB lookup instead (see /api/portfolio-history-by-code).
  const uniqueOwnerIds: string[] = [...new Set(
    accounts.map((a: any) => a.ownerid).filter(Boolean)
  )] as string[]
  const groupCode: string[] = user.head_of_family && user.groupid ? [user.groupid] : []

  const accountCodes: string[] = [...individualCodes, ...uniqueOwnerIds, ...groupCode]

  console.log(`${tag} JWT accountCodes →`, {
    individualCodes,
    uniqueOwnerIds,
    groupCode,
    total: accountCodes,
  })
  return accountCodes
}

export function investorMobileSession(user: LoginRow, accountCodes: string[]): MobileSession {
  const clientName = [user.salutation, user.firstname, user.middlename, user.lastname]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Super admin email comes from environment so it can be changed without a code deploy.
  // Set SUPER_ADMIN_EMAIL in .env.local / production environment.
  const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? 'karan@qodeinvest.com').toLowerCase()
  const isSuperAdmin = user.email.toLowerCase() === SUPER_ADMIN_EMAIL

  const payload: MobileAuthUser = {
    userId: user.clientid,
    email: user.email,
    clientCode: user.clientcode as string,
    clientId: user.clientid,
    accountCodes,
    ownerIds: [user.ownerid || user.clientid],
    groupId: user.groupid,
    isHeadOfFamily: user.head_of_family,
    ...(isSuperAdmin && { isSuperAdmin: true }),
  }
  return {
    payload,
    user: {
      clientId: user.clientid,
      clientCode: user.clientcode,
      name: clientName,
      email: user.email,
      accountCodes,
      isHeadOfFamily: user.head_of_family,
      isSuperAdmin,
    },
  }
}

/**
 * The mobile session a person would get by signing in with this email (no password check, no login tracking).
 * Used for impersonation. Returns an error for an unknown email or an investor whose accounts are all closed.
 */
export async function mobileSessionForEmail(email: string): Promise<{ session?: MobileSession; error?: string; code?: string; status?: number }> {
  const tag = '[mobileSession]'
  const e = String(email || '').trim()
  // Match the stored spelling of the email (the login lookup is an exact match).
  const stored = (await query(
    `SELECT email FROM pms_clients_master WHERE lower(trim(email)) = lower($1)
      ORDER BY head_of_family DESC NULLS LAST, clientcode ASC LIMIT 1`,
    [e]
  )).rows[0]?.email
  const user = stored ? await findLoginRow(stored) : null
  if (!user) return { error: 'No user with this email', code: 'USER_NOT_FOUND', status: 404 }

  if (!user.clientcode) {
    const distributor = await resolveDistributorByEmail(user.email)
    if (distributor) return { session: distributorMobileSession(user.email, distributor) }
  }

  const accounts = await investorActiveAccounts(user, tag)
  if (accounts.length === 0 && await allAccountsClosed(user.email, tag)) {
    return { error: 'All accounts for this investor are closed.', code: 'ACCOUNT_CLOSED', status: 400 }
  }
  return { session: investorMobileSession(user, investorAccountCodes(user, accounts, tag)) }
}
