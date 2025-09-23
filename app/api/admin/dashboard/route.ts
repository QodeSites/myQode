// app/api/admin/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import pool from '@/lib/db1';

interface AdminDashboardData {
  clients: GroupedClientData[];
  queries: QueryData[];
  statistics: DashboardStatistics;
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
        head_of_family, groupid, groupname, ownerid, password_set_at, first_login_at,
        login_attempts, locked_until, created_at, updated_at,
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
        
        // Determine overall onboarding status
        const completedCount = accounts.filter(acc => acc.onboarding_status === 'completed').length;
        const pendingCount = accounts.filter(acc => acc.onboarding_status === 'pending').length;
        
        let onboardingStatus: 'completed' | 'pending' | 'mixed';
        if (completedCount === accounts.length) {
          onboardingStatus = 'completed';
        } else if (pendingCount === accounts.length) {
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
            onboardingStatus: acc.onboarding_status,
            headOfFamily: acc.head_of_family,
            createdAt: acc.created_at,
            loginCount: acc.login_attempts || 0,
            lastLogin: acc.first_login_at,
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
    const allGroupedClients = Array.from(clientGroups.entries()).map(([ownerId, accounts]) => {
      const completedCount = accounts.filter(acc => acc.onboarding_status === 'completed').length;
      const pendingCount = accounts.filter(acc => acc.onboarding_status === 'pending').length;
      
      let onboardingStatus: 'completed' | 'pending' | 'mixed';
      if (completedCount === accounts.length) {
        onboardingStatus = 'completed';
      } else if (pendingCount === accounts.length) {
        onboardingStatus = 'pending';
      } else {
        onboardingStatus = 'mixed';
      }

      return {
        onboardingStatus,
        accounts,
        totalLogins: accounts.reduce((sum, acc) => sum + (acc.login_attempts || 0), 0),
      };
    });

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
      totalLogins: allGroupedClients.reduce((sum, g) => sum + g.totalLogins, 0),
      uniqueLoginsToday: allClients.filter((c: any) => {
        if (!c.first_login_at) return false;
        const loginDate = new Date(c.first_login_at);
        const today = new Date();
        return loginDate.toDateString() === today.toDateString();
      }).length,
      uniqueLoginsThisWeek: allClients.filter((c: any) => {
        if (!c.first_login_at) return false;
        const loginDate = new Date(c.first_login_at);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return loginDate >= weekAgo;
      }).length,
    };

    const dashboardData: AdminDashboardData = {
      clients: groupedClients,
      queries,
      statistics,
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

// Admin impersonation endpoint (unchanged from original)
export async function POST(request: NextRequest) {
  try {
    const { action, clientCode } = await request.json();

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