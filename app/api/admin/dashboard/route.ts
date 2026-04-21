// app/api/admin/portfolio/performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import pool from '@/lib/db1';

interface DistributorData {
  id: string;
  clientid: string;
  clientcode: string;
  clientname: string;
  email: string;
  mobile: string;
  onboarding_status: string;
  ownerid: string;
  groupid: string;
  groupname: string;
  login_count: number;
  last_login_at: string | null;
  created_at: string;
  salutation: string;
  firstname: string;
  middlename: string;
  lastname: string;
}

interface AdminDashboardData {
  clients: GroupedClientData[];
  queries: QueryData[];
  statistics: DashboardStatistics;
  distributors: DistributorData[];
  intermediaryNames: string[];
}

interface GroupedClientData {
  // Primary owner info
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  groupId: string;
  groupName: string;

  // Aggregated data across all accounts
  totalAccounts: number;
  accounts: ClientAccount[];

  // Status based on all accounts
  onboardingStatus: 'completed' | 'pending' | 'mixed';

  // Aggregated stats
  totalQueries: number;
  totalLogins: number;
  lastActivity: string | null;
  createdAt: string;

  // Primary account for actions (usually head of family or first account)
  primaryClientCode: string;
  primaryClientId: string;
}

interface ClientAccount {
  clientId: string;
  clientCode: string;
  clientName: string;
  onboardingStatus: string;
  headOfFamily: boolean;
  createdAt: string;
  loginCount: number;
  lastLogin: string | null;
}

interface QueryData {
  id: string;
  type: string;
  nuvama_code: string;
  client_id: string;
  user_email: string;
  subject: string;
  status: string;
  priority: string;
  data: any;
  email_sent: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface DashboardStatistics {
  totalOwners: number;
  totalAccounts: number;
  activeOwners: number;
  pendingOnboarding: number;
  completedOnboarding: number;
  mixedOnboarding: number;
  totalQueries: number;
  pendingQueries: number;
  resolvedQueries: number;
  totalLogins: number;
  uniqueLoginsToday: number;
  uniqueLoginsThisWeek: number;
}

export async function GET(request: NextRequest) {
  const client = await pool.connect();

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const limit = parseInt(searchParams.get('limit') || '10000');

    // Get all clients with ownerid
    let clientQuery = `
  SELECT 
    id, clientid, clientcode, clientname, email, mobile, onboarding_status,
    head_of_family, groupid, groupname, ownerid, password, password_set_at, first_login_at,
    login_attempts, login_count, last_login_at, locked_until, created_at, updated_at,
    salutation, firstname, middlename, lastname
  FROM pms_clients_master
  WHERE ownerid IS NOT NULL
  ORDER BY created_at DESC
`;

    const clientResult = await query(clientQuery, []);
    const allClients = clientResult.rows;

    // Group clients by ownerid instead of email
    const clientGroups = new Map<string, any[]>();

    allClients.forEach((client: any) => {
      const ownerId = client.ownerid;
      if (!clientGroups.has(ownerId)) {
        clientGroups.set(ownerId, []);
      }
      clientGroups.get(ownerId)!.push({
        ...client,
        clientname: `${client.salutation || ''} ${client.firstname} ${client.middlename || ''} ${client.lastname}`.trim(),
      });
    });

    // Get all queries data
    const queryResult = await client.query(`
      SELECT 
        id, type, nuvama_code, client_id, user_email, subject, status, priority,
        data, email_sent, created_at, updated_at, resolved_at
      FROM pms_clients_tracker.qode_microsite_inquiries
      ORDER BY created_at DESC
    `);
    const queries = queryResult.rows;

    // Create query map by client code for efficient lookup
    const queryMap = new Map<string, QueryData[]>();
    queries.forEach((q: QueryData) => {
      if (!queryMap.has(q.nuvama_code)) {
        queryMap.set(q.nuvama_code, []);
      }
      queryMap.get(q.nuvama_code)!.push(q);
    });

    // Convert grouped clients to GroupedClientData
    const groupedClients: GroupedClientData[] = Array.from(clientGroups.entries())
      .map(([ownerId, accounts]) => {
        // Find primary account (head of family or first account)
        const primaryAccount = accounts.find(acc => acc.head_of_family) || accounts[0];

        // Calculate aggregated data
        const allQueries = accounts.flatMap(acc => queryMap.get(acc.clientcode) || []);
        const totalLogins = accounts.reduce((sum, acc) => sum + (acc.login_attempts || 0), 0);

        // Determine overall onboarding status based on whether default password has been changed
        const completedCount = accounts.filter(acc => acc.password && acc.password !== 'Qode@123').length;

        let onboardingStatus: 'completed' | 'pending' | 'mixed';
        if (completedCount === accounts.length) {
          onboardingStatus = 'completed';
        } else if (completedCount === 0) {
          onboardingStatus = 'pending';
        } else {
          onboardingStatus = 'mixed';
        }

        // Get last activity from queries
        const lastActivity = allQueries.length > 0
          ? allQueries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
          : null;

        const grouped: GroupedClientData = {
          ownerId: ownerId,
          ownerEmail: primaryAccount.email,
          ownerName: primaryAccount.clientname,
          groupId: primaryAccount.groupid,
          groupName: primaryAccount.groupname,
          totalAccounts: accounts.length,
          accounts: accounts.map(acc => ({
            clientId: acc.clientid,
            clientCode: acc.clientcode,
            clientName: acc.clientname,
            onboardingStatus: (acc.password && acc.password !== 'Qode@123') ? 'completed' : 'pending',
            headOfFamily: acc.head_of_family,
            createdAt: acc.created_at,
            loginCount: acc.login_count || 0,      // Changed from login_attempts
            lastLogin: acc.last_login_at,
          })),
          onboardingStatus,
          totalQueries: allQueries.length,
          totalLogins,
          lastActivity,
          createdAt: primaryAccount.created_at,
          primaryClientCode: primaryAccount.clientcode,
          primaryClientId: primaryAccount.clientid,
        };

        return grouped;
      })
      .filter(group => {
        // Apply search filter
        const matchesSearch = !search ||
          group.ownerName.toLowerCase().includes(search.toLowerCase()) ||
          group.ownerEmail.toLowerCase().includes(search.toLowerCase()) ||
          group.ownerId.toLowerCase().includes(search.toLowerCase()) ||
          group.accounts.some(acc => acc.clientCode.toLowerCase().includes(search.toLowerCase()));

        // Apply status filter
        const matchesStatus = status === 'all' || group.onboardingStatus === status;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    // Calculate statistics
    // Calculate statistics with proper login tracking
    const allGroupedClients = Array.from(clientGroups.entries()).map(([ownerId, accounts]) => {
      const completedCount = accounts.filter(acc => acc.password && acc.password !== 'Qode@123').length;

      let onboardingStatus: 'completed' | 'pending' | 'mixed';
      if (completedCount === accounts.length) {
        onboardingStatus = 'completed';
      } else if (completedCount === 0) {
        onboardingStatus = 'pending';
      } else {
        onboardingStatus = 'mixed';
      }

      return {
        onboardingStatus,
        accounts,
        totalLogins: accounts.reduce((sum, acc) => sum + (acc.login_count || 0), 0),
      };
    });

    // Get accurate login statistics from database
    const loginStatsResult = await query(`
      SELECT 
        COALESCE(SUM(login_count), 0)::int as total_logins,
        COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE)::int as logins_today,
        COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE - INTERVAL '7 days')::int as logins_this_week
      FROM pms_clients_master
      WHERE ownerid IS NOT NULL
    `);

    const loginStats = loginStatsResult.rows[0];

    const statistics: DashboardStatistics = {
      totalOwners: allGroupedClients.length,
      totalAccounts: allClients.length,
      activeOwners: allGroupedClients.filter(g => g.onboardingStatus === 'completed').length,
      pendingOnboarding: allGroupedClients.filter(g => g.onboardingStatus === 'pending').length,
      completedOnboarding: allGroupedClients.filter(g => g.onboardingStatus === 'completed').length,
      mixedOnboarding: allGroupedClients.filter(g => g.onboardingStatus === 'mixed').length,
      totalQueries: queries.length,
      pendingQueries: queries.filter((q: QueryData) => q.status === 'pending').length,
      resolvedQueries: queries.filter((q: QueryData) => q.status === 'resolved').length,
      totalLogins: loginStats.total_logins || 0,
      uniqueLoginsToday: loginStats.logins_today || 0,
      uniqueLoginsThisWeek: loginStats.logins_this_week || 0,
    };

    // Fetch distributors separately
    const distributorResult = await query(
      `SELECT id, clientid, clientcode, clientname, email, mobile, onboarding_status,
              ownerid, groupid, groupname, login_count, last_login_at, created_at,
              salutation, firstname, middlename, lastname
       FROM pms_clients_master
       WHERE clienttype = 'DISTRIBUTORS'
       ORDER BY created_at DESC`,
      []
    );

    const distributors: DistributorData[] = distributorResult.rows.map((row: any) => ({
      ...row,
      clientname: `${row.salutation || ''} ${row.firstname} ${row.middlename || ''} ${row.lastname}`.trim(),
    }));

    // Fetch unique intermediary names
    const intermediaryNamesResult = await query(
      `SELECT DISTINCT intermediaryname FROM public.pms_clients_master WHERE intermediaryname IS NOT NULL ORDER BY intermediaryname`
    );
    const intermediaryNames = intermediaryNamesResult.rows.map((row: any) => row.intermediaryname);

    const dashboardData: AdminDashboardData = {
      clients: groupedClients,
      queries,
      statistics,
      distributors,
      intermediaryNames,
    };

    return NextResponse.json({
      success: true,
      data: dashboardData,
    });

  } catch (error) {
    console.error('Admin dashboard API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin dashboard data' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// Admin impersonation endpoint
export async function POST(request: NextRequest) {
  try {
    const { action, clientCode, distributorEmail } = await request.json();

    // Distributor impersonation — lookup by email since clientcode is null
    if (action === 'impersonate-distributor') {
      if (!distributorEmail) {
        return NextResponse.json(
          { error: 'Distributor email is required for impersonation' },
          { status: 400 }
        );
      }

      const distributorResult = await query(
        `SELECT clientid, clientcode, email, groupid, head_of_family, ownerid,
                salutation, firstname, middlename, lastname, clienttype
         FROM pms_clients_master
         WHERE email = $1 AND clienttype = 'DISTRIBUTORS'
         LIMIT 1`,
        [distributorEmail]
      );

      if (distributorResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Distributor not found' },
          { status: 404 }
        );
      }

      const distributor = distributorResult.rows[0];

      // clientData mirrors real distributor login: clientid present, clientcode may be null
      const clientData = [{
        clientid: distributor.clientid,
        clientcode: distributor.clientcode,
      }];

      const impersonationToken = Buffer.from(JSON.stringify({
        adminImpersonation: true,
        clientCode: distributor.clientcode,
        clientType: 'DISTRIBUTORS',
        timestamp: Date.now(),
        clientData,
        userContext: {
          clientid: distributor.clientid,
          clientcode: distributor.clientcode,
          email: distributor.email,
          groupid: distributor.groupid,
          head_of_family: false,
          ownerid: distributor.ownerid,
        },
        targetClientName: `${distributor.salutation || ''} ${distributor.firstname} ${distributor.middlename || ''} ${distributor.lastname}`.trim(),
      })).toString('base64');

      return NextResponse.json({
        success: true,
        impersonationToken,
        redirectUrl: `/api/admin/impersonate?token=${impersonationToken}`,
        clientData,
        isHeadOfFamily: false,
        targetClientName: `${distributor.salutation || ''} ${distributor.firstname} ${distributor.middlename || ''} ${distributor.lastname}`.trim(),
      });
    }

    if (action === 'impersonate') {
      if (!clientCode) {
        return NextResponse.json(
          { error: 'Client code is required for impersonation' },
          { status: 400 }
        );
      }

      // Get client data for impersonation with role information
      const clientResult = await query(
        `SELECT clientid, clientcode, email, groupid, head_of_family, ownerid,
                salutation, firstname, middlename, lastname
         FROM pms_clients_master
         WHERE clientcode = $1`,
        [clientCode]
      );

      if (clientResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Client not found' },
          { status: 404 }
        );
      }

      const targetClient = clientResult.rows[0];
      const { groupid, email, head_of_family, ownerid } = targetClient;

      // Get associated client codes based on role (same logic as login)
      let associatedResult;

      if (head_of_family) {
        // If target is head of family, get all accounts in the group
        associatedResult = await query(
          'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
          [groupid]
        );
      } else {
        // If target is not head of family, get only accounts with this ownerid
        associatedResult = await query(
          'SELECT clientid, clientcode FROM pms_clients_master WHERE ownerid = $1',
          [ownerid]
        );
      }

      const clientData = associatedResult.rows.map((row: any) => ({
        clientid: row.clientid,
        clientcode: row.clientcode
      }));

      // Create comprehensive impersonation token with role information
      const impersonationToken = Buffer.from(JSON.stringify({
        adminImpersonation: true,
        clientCode,
        timestamp: Date.now(),
        clientData,
        userContext: {
          clientid: targetClient.clientid,
          clientcode: targetClient.clientcode,
          email: targetClient.email,
          groupid: targetClient.groupid,
          head_of_family: targetClient.head_of_family,
          ownerid: targetClient.ownerid
        },
        targetClientName: `${targetClient.salutation || ''} ${targetClient.firstname} ${targetClient.middlename || ''} ${targetClient.lastname}`.trim()
      })).toString('base64');

      return NextResponse.json({
        success: true,
        impersonationToken,
        redirectUrl: `/api/admin/impersonate?token=${impersonationToken}`,
        clientData,
        isHeadOfFamily: head_of_family,
        targetClientName: `${targetClient.salutation || ''} ${targetClient.firstname} ${targetClient.middlename || ''} ${targetClient.lastname}`.trim()
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Admin impersonation error:', error);
    return NextResponse.json(
      { error: 'Failed to process admin action' },
      { status: 500 }
    );
  }
}