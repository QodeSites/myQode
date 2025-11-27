// app/api/admin/portfolio/performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import pool from '@/lib/db1';

interface AdminDashboardData {
  clients: GroupedClientData[];
  queries: QueryData[];
  statistics: DashboardStatistics;
  // New: Detailed lists for clickable stats
  loginDetails: {
    today: LoginDetail[];
    thisWeek: LoginDetail[];
    allTime: LoginDetail[];
  };
}

interface LoginDetail {
  clientCode: string;
  clientName: string;
  email: string;
  lastLoginAt: string;
  loginCount: number;
  groupName: string | null;
}

interface GroupedClientData {
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  groupId: string;
  groupName: string;
  totalAccounts: number;
  accounts: ClientAccount[];
  onboardingStatus: 'completed' | 'pending' | 'mixed';
  totalQueries: number;
  totalLogins: number;
  lastActivity: string | null;
  createdAt: string;
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
  totalClients: number;
  totalPortfolioAccounts: number;
  onboardingComplete: number;
  onboardingPending: number;
  onboardingPartial: number;
  totalInquiries: number;
  openInquiries: number;
  resolvedInquiries: number;
  totalLogins: number;
  loginsToday: number;
  loginsThisWeek: number;
}

export async function GET(request: NextRequest) {
  const client = await pool.connect();
  
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const limit = parseInt(searchParams.get('limit') || '10000');

    // Get all clients with ownerid - now including login_count and last_login_at
    let clientQuery = `
      SELECT 
        id, clientid, clientcode, clientname, email, mobile, onboarding_status,
        head_of_family, groupid, groupname, ownerid, password_set_at, first_login_at,
        login_attempts, locked_until, created_at, updated_at,
        salutation, firstname, middlename, lastname,
        COALESCE(login_count, 0) as login_count,
        last_login_at
      FROM pms_clients_master
      WHERE ownerid IS NOT NULL
      ORDER BY created_at DESC
    `;

    const clientResult = await query(clientQuery, []);
    const allClients = clientResult.rows;

    // Group clients by ownerid
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
        const primaryAccount = accounts.find(acc => acc.head_of_family) || accounts[0];
        const allQueries = accounts.flatMap(acc => queryMap.get(acc.clientcode) || []);
        const totalLogins = accounts.reduce((sum, acc) => sum + (acc.login_count || 0), 0);
        
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
            loginCount: acc.login_count || 0,
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
        const matchesSearch = !search || 
          group.ownerName.toLowerCase().includes(search.toLowerCase()) ||
          group.ownerEmail.toLowerCase().includes(search.toLowerCase()) ||
          group.ownerId.toLowerCase().includes(search.toLowerCase()) ||
          group.accounts.some(acc => acc.clientCode.toLowerCase().includes(search.toLowerCase()));
        
        const matchesStatus = status === 'all' || group.onboardingStatus === status;
        
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    // Calculate statistics with proper login tracking
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
        totalLogins: accounts.reduce((sum, acc) => sum + (acc.login_count || 0), 0),
      };
    });

    // Get accurate login statistics from database
    const loginStatsResult = await client.query(`
      SELECT 
        COALESCE(SUM(login_count), 0)::int as total_logins,
        COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE)::int as logins_today,
        COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE - INTERVAL '7 days')::int as logins_this_week
      FROM pms_clients_master
      WHERE ownerid IS NOT NULL
    `);
    
    const loginStats = loginStatsResult.rows[0];

    // Get detailed login lists for clickable stats
    const todayLoginsResult = await client.query(`
      SELECT 
        clientcode, 
        CONCAT(COALESCE(salutation, ''), ' ', firstname, ' ', COALESCE(middlename, ''), ' ', lastname) as clientname,
        email,
        last_login_at,
        COALESCE(login_count, 0) as login_count,
        groupname
      FROM pms_clients_master
      WHERE ownerid IS NOT NULL 
        AND last_login_at >= CURRENT_DATE
      ORDER BY last_login_at DESC
    `);

    const weekLoginsResult = await client.query(`
      SELECT 
        clientcode, 
        CONCAT(COALESCE(salutation, ''), ' ', firstname, ' ', COALESCE(middlename, ''), ' ', lastname) as clientname,
        email,
        last_login_at,
        COALESCE(login_count, 0) as login_count,
        groupname
      FROM pms_clients_master
      WHERE ownerid IS NOT NULL 
        AND last_login_at >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY last_login_at DESC
    `);

    const allLoginsResult = await client.query(`
      SELECT 
        clientcode, 
        CONCAT(COALESCE(salutation, ''), ' ', firstname, ' ', COALESCE(middlename, ''), ' ', lastname) as clientname,
        email,
        last_login_at,
        COALESCE(login_count, 0) as login_count,
        groupname
      FROM pms_clients_master
      WHERE ownerid IS NOT NULL 
        AND last_login_at IS NOT NULL
      ORDER BY last_login_at DESC
      LIMIT 100
    `);

    const formatLoginDetail = (row: any): LoginDetail => ({
      clientCode: row.clientcode,
      clientName: row.clientname?.replace(/\s+/g, ' ').trim() || 'Unknown',
      email: row.email,
      lastLoginAt: row.last_login_at,
      loginCount: row.login_count,
      groupName: row.groupname,
    });

    const loginDetails = {
      today: todayLoginsResult.rows.map(formatLoginDetail),
      thisWeek: weekLoginsResult.rows.map(formatLoginDetail),
      allTime: allLoginsResult.rows.map(formatLoginDetail),
    };

    const statistics: DashboardStatistics = {
      totalClients: allGroupedClients.length,
      totalPortfolioAccounts: allClients.length,
      onboardingComplete: allGroupedClients.filter(g => g.onboardingStatus === 'completed').length,
      onboardingPending: allGroupedClients.filter(g => g.onboardingStatus === 'pending').length,
      onboardingPartial: allGroupedClients.filter(g => g.onboardingStatus === 'mixed').length,
      totalInquiries: queries.length,
      openInquiries: queries.filter((q: QueryData) => q.status === 'pending').length,
      resolvedInquiries: queries.filter((q: QueryData) => q.status === 'resolved').length,
      totalLogins: loginStats.total_logins || 0,
      loginsToday: loginStats.logins_today || 0,
      loginsThisWeek: loginStats.logins_this_week || 0,
    };

    const dashboardData: AdminDashboardData = {
      clients: groupedClients,
      queries,
      statistics,
      loginDetails,
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
    const { action, clientCode } = await request.json();

    if (action === 'impersonate') {
      if (!clientCode) {
        return NextResponse.json(
          { error: 'Client code is required for impersonation' },
          { status: 400 }
        );
      }

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

      let associatedResult;
      
      if (head_of_family) {
        associatedResult = await query(
          'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
          [groupid]
        );
      } else {
        associatedResult = await query(
          'SELECT clientid, clientcode FROM pms_clients_master WHERE ownerid = $1',
          [ownerid]
        );
      }

      const clientData = associatedResult.rows.map((row: any) => ({
        clientid: row.clientid,
        clientcode: row.clientcode
      }));

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