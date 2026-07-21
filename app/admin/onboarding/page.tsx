// app/admin/onboarding/page.tsx
"use client";

import { AdminAuthProvider } from '@/components/admin-auth-provider';
import { AdminLayout } from '@/components/admin-layout';
import { useAdminAuthContext } from '@/components/admin-auth-provider';
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { SessionDebug } from '@/components/session-debug';
import {
  Users,
  LogIn,
  MessageSquare,
  Crown,
  User,
  Activity,
  Calendar,
  AlertTriangle,
  Eye,
  RefreshCw,
  Search,
  TrendingUp,
  CheckCircle,
  Clock,
  Mail,
  Shield,
  X,
  FileText,
  UserCog,
  Building2,
  Hash,
  Download,
  Grid,
  List,
  MoreHorizontal,
  Trash2,
  Smartphone,
  BarChart2,
  AlertCircle
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

interface GroupedClientData {
  ownerId: string;
  ownerEmail: string;
  ownerName: string | null | undefined;
  groupId: string;
  groupName: string | null | undefined;
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
  clientName: string | null | undefined;
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
  resolved_at: string | null;
}

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

/* =========================
   Helper: sanitizeName
   ========================= */
const sanitizeName = (name: string | null | undefined) => {
  if (!name || name === "null" || name.includes("null")) {
    return name?.replace(/\s*null\s*/g, "").trim() || "Unknown";
  }
  return name.trim();
};

// Emails that can only see the Distributors tab
const DISTRIBUTOR_ONLY_ADMINS = [
  'kruti.dave@qodeinvest.com',
  'accounts@qodeinvest.com',
];

function AdminDashboardContent() {
  const { user } = useAdminAuthContext();
  const isDistributorOnlyAdmin = DISTRIBUTOR_ONLY_ADMINS.includes((user?.email || '').toLowerCase());

  const [clients, setClients] = useState<GroupedClientData[]>([]);
  const [allClients, setAllClients] = useState<GroupedClientData[]>([]);
  const [queries, setQueries] = useState<QueryData[]>([]);
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'mixed'>('all');
  const [selectedClient, setSelectedClient] = useState<GroupedClientData | null>(null);
  const [showImpersonateDialog, setShowImpersonateDialog] = useState(false);
  const [showQueriesDialog, setShowQueriesDialog] = useState(false);
  const [showAccountsDialog, setShowAccountsDialog] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [message, setMessage] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  // Add these new state variables after the existing ones
  const [showLoginsDialog, setShowLoginsDialog] = useState(false);
  const [loginsData, setLoginsData] = useState<any[]>([]);
  const [loadingLogins, setLoadingLogins] = useState(false);

  const [loginFilter, setLoginFilter] = useState<'all' | 'today' | 'week'>('all');
  const [distributors, setDistributors] = useState<DistributorData[]>([]);
  const [distributorSearch, setDistributorSearch] = useState('');
  const [intermediaryNames, setIntermediaryNames] = useState<string[]>([]);
  
  const [showAddDistributorDialog, setShowAddDistributorDialog] = useState(false);
  const [addingDistributor, setAddingDistributor] = useState(false);
  const [newDistributor, setNewDistributor] = useState({
    clientname: '',
    email: '',
    salutation: 'Mr',
    firstname: '',
    lastname: '',
    intermediaryname: 'QODE ADVISORS LLP INT',
    intermediary_fee_percentage: 50.00
  });
  const [activeTab, setActiveTab] = useState<'owners' | 'distributors' | 'app-analytics'>(
    isDistributorOnlyAdmin ? 'distributors' : 'owners'
  );

  // ── App Analytics state (simplified) ─────────────────────────────────────
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [analyticsError, setAnalyticsError] = useState('');
  // App Store (Apple Sales Reports)
  const [salesData, setSalesData] = useState<any>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [vendorNumber, setVendorNumber] = useState(process.env.NEXT_PUBLIC_APP_STORE_VENDOR_NUMBER ?? '');
  // Play Store (Google Play Developer Reporting API)
  const [playData, setPlayData] = useState<any>(null);
  const [playLoading, setPlayLoading] = useState(false);
  // In-app analytics (pms_mobile_analytics — both iOS & Android)
  const [mobileData, setMobileData] = useState<any>(null);
  const [mobileLoading, setMobileLoading] = useState(false);
  // Web vs app login split (real, from pms_clients_master platform counters)
  const [loginSplitData, setLoginSplitData] = useState<any>(null);
  const [loginSplitLoading, setLoginSplitLoading] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/dashboard`);
      const data = await response.json();

      if (data.success) {
        // Sanitize names in the client data
        const sanitizedClients = data.data.clients.map((client: GroupedClientData) => ({
          ...client,
          ownerName: sanitizeName(client.ownerName),
          groupName: sanitizeName(client.groupName),
          accounts: client.accounts.map((account: ClientAccount) => ({
            ...account,
            clientName: sanitizeName(account.clientName),
          })),
        }));
        setAllClients(sanitizedClients);
        setQueries(data.data.queries);
        setStatistics(data.data.statistics);
        setDistributors((data.data.distributors || []).map((d: DistributorData) => ({
          ...d,
          clientname: sanitizeName(d.clientname),
        })));
        if (data.data.intermediaryNames) {
          setIntermediaryNames(data.data.intermediaryNames);
        }
      } else {
        setMessage('Failed to load dashboard data');
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setMessage('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesData = async (days = analyticsDays, vendor = vendorNumber) => {
    if (!vendor) return;
    setSalesLoading(true);
    try {
      const res = await fetch(`/api/admin/app-store-analytics?action=sales&vendorNumber=${encodeURIComponent(vendor)}&days=${days}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSalesData(data);
    } catch (e: any) {
      setAnalyticsError(`App Store: ${e.message}`);
    } finally {
      setSalesLoading(false);
    }
  };

  const fetchPlayData = async (days = analyticsDays) => {
    setPlayLoading(true);
    try {
      const res = await fetch(`/api/admin/play-store-analytics?days=${days}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlayData(data);
    } catch (e: any) {
      setAnalyticsError(`Play Store: ${e.message}`);
    } finally {
      setPlayLoading(false);
    }
  };

  const fetchMobileData = async (days = analyticsDays) => {
    setMobileLoading(true);
    try {
      // Prefer Firebase Analytics (GA4 Data API). Fall back to the legacy
      // pms_mobile_analytics table if Firebase isn't configured yet.
      let res = await fetch(`/api/admin/firebase-analytics?days=${days}`);
      let data = await res.json();
      if (res.status === 503) {
        res = await fetch(`/api/admin/mobile-analytics?days=${days}`);
        data = await res.json();
      }
      if (data.error) throw new Error(data.error);
      setMobileData(data);
    } catch (e: any) {
      setAnalyticsError(`In-app analytics: ${e.message}`);
    } finally {
      setMobileLoading(false);
    }
  };

  const fetchLoginSplitData = async (days = analyticsDays) => {
    setLoginSplitLoading(true);
    try {
      const res = await fetch(`/api/admin/login-analytics?days=${days}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLoginSplitData(data);
    } catch (e: any) {
      setAnalyticsError(`Login split: ${e.message}`);
    } finally {
      setLoginSplitLoading(false);
    }
  };

  const fetchAllAnalytics = (days = analyticsDays) => {
    setAnalyticsError('');
    fetchSalesData(days, vendorNumber);
    fetchPlayData(days);
    fetchMobileData(days);
    fetchLoginSplitData(days);
  };

  // One-time estimate, computed 2026-07-21 from pms_clients_master (password-set
  // status) joined against pms_master_sheet (first NAV date vs the Apr 7 2026
  // app launch date). NOT live data — kept only until enough real logins have
  // accumulated in web_login_count / app_login_count to replace it.
  const ESTIMATED_PLATFORM_SPLIT = {
    computedOn: '2026-07-21',
    totalPeople: 228,
    onboarded: 161,
    notOnboarded: 67,
    web: 78,
    app: 83,
  };

  // Add this function after fetchDashboardData
  const fetchLoginsData = (filter: 'all' | 'today' | 'week' = 'all') => {
    setLoadingLogins(true);
    setLoginFilter(filter);

    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfWeek.getDate() - 7);

      // Group by owner email
      const ownerLoginsMap = new Map<string, {
        ownerEmail: string;
        ownerName: string;
        groupName: string;
        totalLoginCount: number;
        accountsLoggedIn: number;
        totalAccounts: number;
        lastLogin: string | null;
        accounts: Array<{
          clientCode: string;
          clientName: string;
          loginCount: number;
          lastLogin: string | null;
          headOfFamily: boolean;
        }>;
      }>();

      allClients.forEach(owner => {
        const filteredAccounts = owner.accounts.filter(acc => {
          if (!acc.lastLogin) return false;

          const lastLoginDate = new Date(acc.lastLogin);

          if (filter === 'today') {
            return lastLoginDate >= startOfToday;
          } else if (filter === 'week') {
            return lastLoginDate >= startOfWeek;
          }
          return acc.loginCount > 0 || acc.lastLogin;
        });

        if (filteredAccounts.length > 0) {
          const totalLoginCount = filteredAccounts.reduce((sum, acc) => sum + (acc.loginCount || 0), 0);
          const lastLoginDates = filteredAccounts
            .filter(acc => acc.lastLogin)
            .map(acc => new Date(acc.lastLogin!).getTime());
          const lastLogin = lastLoginDates.length > 0
            ? new Date(Math.max(...lastLoginDates)).toISOString()
            : null;

          ownerLoginsMap.set(owner.ownerEmail, {
            ownerEmail: owner.ownerEmail,
            ownerName: owner.ownerName || 'Unknown',
            groupName: owner.groupName || 'Unknown',
            totalLoginCount,
            accountsLoggedIn: filteredAccounts.length,
            totalAccounts: owner.totalAccounts,
            lastLogin,
            accounts: filteredAccounts.map(acc => ({
              clientCode: acc.clientCode,
              clientName: acc.clientName || 'Unknown',
              loginCount: acc.loginCount || 0,
              lastLogin: acc.lastLogin,
              headOfFamily: acc.headOfFamily,
            })),
          });
        }
      });

      // Convert to array and sort by last login
      const groupedLogins = Array.from(ownerLoginsMap.values()).sort((a, b) => {
        if (!a.lastLogin) return 1;
        if (!b.lastLogin) return -1;
        return new Date(b.lastLogin).getTime() - new Date(a.lastLogin).getTime();
      });

      setLoginsData(groupedLogins);
    } catch (error) {
      console.error('Failed to fetch logins data:', error);
    } finally {
      setLoadingLogins(false);
    }
  };



  const handleShowLogins = () => {
    fetchLoginsData();
    setShowLoginsDialog(true);
  };

  const filteredClients = useMemo(() => {
    return allClients.filter(client => {
      const matchesSearch = !searchTerm ||
        sanitizeName(client.ownerName).toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.ownerId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sanitizeName(client.groupName).toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.groupId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.primaryClientCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.accounts.some(acc =>
          acc.clientCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
          sanitizeName(acc.clientName).toLowerCase().includes(searchTerm.toLowerCase()) ||
          acc.clientId.toLowerCase().includes(searchTerm.toLowerCase())
        );

      const matchesStatus = statusFilter === 'all' || client.onboardingStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [allClients, searchTerm, statusFilter]);

  const filteredDistributors = useMemo(() => {
    if (!distributorSearch) return distributors;
    const term = distributorSearch.toLowerCase();
    return distributors.filter(d =>
      sanitizeName(d.clientname).toLowerCase().includes(term) ||
      d.email.toLowerCase().includes(term) ||
      (d.clientcode || '').toLowerCase().includes(term) ||
      (d.mobile || '').toLowerCase().includes(term)
    );
  }, [distributors, distributorSearch]);

  const handleImpersonate = async (clientCode: string) => {
    setImpersonating(true);
    try {
      const response = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'impersonate', clientCode }),
      });

      const data = await response.json();

      if (data.success) {
        window.open(data.redirectUrl, '_blank');
        setMessage(`Successfully initiated impersonation for ${clientCode}`);
      } else {
        setMessage(`Impersonation failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Impersonation error:', error);
      setMessage('Failed to initiate impersonation');
    } finally {
      setImpersonating(false);
      setShowImpersonateDialog(false);
    }
  };

  const handleImpersonateDistributor = async (distributorEmail: string, distributorName: string) => {
    setImpersonating(true);
    try {
      const response = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'impersonate-distributor', distributorEmail }),
      });

      const data = await response.json();

      if (data.success) {
        window.open(data.redirectUrl, '_blank');
        setMessage(`Successfully logged in as distributor ${distributorName}`);
      } else {
        setMessage(`Distributor login failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Distributor impersonation error:', error);
      setMessage('Failed to initiate distributor login');
    } finally {
      setImpersonating(false);
    }
  };

  const handleDeleteDistributor = async (email: string, id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete distributor ${name}? This action cannot be undone.`)) {
      return;
    }
    
    try {
      const response = await fetch('/api/admin/distributors/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, id })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage(`Distributor ${name} deleted successfully`);
        fetchDashboardData();
      } else {
        setMessage(`Failed to delete distributor: ${data.error}`);
      }
    } catch (error) {
      console.error('Delete distributor error:', error);
      setMessage('Failed to delete distributor');
    }
  };

  const handleAddDistributor = async () => {
    if (!newDistributor.clientname || !newDistributor.email) {
      setMessage('Client Name and Email are required.');
      return;
    }
    setAddingDistributor(true);
    try {
      const response = await fetch('/api/admin/distributors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDistributor)
      });
      const data = await response.json();
      if (data.success) {
        setMessage('Distributor created successfully');
        setShowAddDistributorDialog(false);
        setNewDistributor({
          clientname: '', email: '', salutation: 'Mr', firstname: '', lastname: '',
          intermediaryname: 'QODE ADVISORS LLP INT', intermediary_fee_percentage: 50.00
        });
        fetchDashboardData();
      } else {
        setMessage(`Failed to create distributor: ${data.error}`);
      }
    } catch (error) {
      console.error('Add distributor error:', error);
      setMessage('Failed to create distributor');
    } finally {
      setAddingDistributor(false);
    }
  };


  const exportToCSV = (data: any[], filename: string, type: 'owners' | 'accounts') => {
    let csvContent = '';
    let headers: string[] = [];

    if (type === 'owners') {
      headers = [
        'Owner ID',
        'Owner Name',
        'Owner Email',
        'Group ID',
        'Group Name',
        'Total Accounts',
        'Onboarding Status',
        'Total Queries',
        'Pending Queries',
        'Total Logins',
        'Primary Client Code',
        'Created Date',
        'Last Activity'
      ];

      csvContent = headers.join(',') + '\n';

      data.forEach(owner => {
        const ownerQueries = getOwnerQueries(owner.ownerEmail);
        const pendingQueries = ownerQueries.filter(q => q.status === 'pending').length;

        const row = [
          `"${owner.ownerId}"`,
          `"${sanitizeName(owner.ownerName)}"`,
          `"${owner.ownerEmail}"`,
          `"${owner.groupId}"`,
          `"${sanitizeName(owner.groupName)}"`,
          owner.totalAccounts,
          owner.onboardingStatus,
          owner.totalQueries,
          pendingQueries,
          owner.totalLogins,
          `"${owner.primaryClientCode}"`,
          new Date(owner.createdAt).toLocaleDateString(),
          owner.lastActivity ? new Date(owner.lastActivity).toLocaleDateString() : 'Never'
        ].join(',');

        csvContent += row + '\n';
      });
    } else {
      // Export all accounts
      headers = [
        'Owner ID',
        'Owner Name',
        'Owner Email',
        'Client ID',
        'Client Code',
        'Client Name',
        'Onboarding Status',
        'Head of Family',
        'Login Count',
        'Last Login',
        'Created Date'
      ];

      csvContent = headers.join(',') + '\n';

      data.forEach(owner => {
        owner.accounts.forEach((account: ClientAccount) => {
          const row = [
            `"${owner.ownerId}"`,
            `"${sanitizeName(owner.ownerName)}"`,
            `"${owner.ownerEmail}"`,
            `"${account.clientId}"`,
            `"${account.clientCode}"`,
            `"${sanitizeName(account.clientName)}"`,
            account.onboardingStatus,
            account.headOfFamily ? 'Yes' : 'No',
            account.loginCount,
            account.lastLogin ? new Date(account.lastLogin).toLocaleDateString() : 'Never',
            new Date(account.createdAt).toLocaleDateString()
          ].join(',');

          csvContent += row + '\n';
        });
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setMessage(`Successfully exported ${data.length} ${type} to CSV`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'mixed':
        return <Badge className="bg-blue-100 text-blue-800"><AlertTriangle className="h-3 w-3 mr-1" />Mixed</Badge>;
      case 'pending':
      default:
        return <Badge variant="outline" className="text-orange-600"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    }
  };

  const getQueryStatusBadge = (status: string) => {
    switch (status) {
      case 'resolved':
        return <Badge className="bg-green-100 text-green-800">Resolved</Badge>;
      case 'pending':
      default:
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
    }
  };

  const getQueryTypeBadge = (type: string) => {
    const colors = {
      'strategy': 'bg-blue-100 text-blue-800',
      'discussion': 'bg-purple-100 text-purple-800',
      'switch': 'bg-orange-100 text-orange-800',
      'withdrawal': 'bg-red-100 text-red-800',
      'feedback': 'bg-green-100 text-green-800',
      'raised_request': 'bg-teal-100 text-teal-800',
      'new_strategy_payment_success': 'bg-indigo-100 text-indigo-800',
      'payment_success': 'bg-emerald-100 text-emerald-800',
      'sip_success': 'bg-cyan-100 text-cyan-800',
      'default': 'bg-gray-100 text-gray-800'
    };

    return <Badge className={colors[type as keyof typeof colors] || colors.default}>{type}</Badge>;
  };

  const getOwnerQueries = (ownerEmail: string) => {
    return queries.filter(q => q.user_email.toLowerCase() === ownerEmail.toLowerCase());
  };

  const StatCard = ({ icon: Icon, title, value, subtitle, color = "text-blue-500" }: any) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center space-x-2">
          <Icon className={`h-5 w-5 ${color}`} />
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // Owners List Table Component
  const OwnersListTable = () => (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-blue-500" />
              <span>Owner View - List Format</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Manage owners with their grouped accounts
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Export Options</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportToCSV(filteredClients, 'owners-list', 'owners')}>
                <FileText className="h-4 w-4 mr-2" />
                Export Owners CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportToCSV(filteredClients, 'all-accounts-list', 'accounts')}>
                <Users className="h-4 w-4 mr-2" />
                Export All Accounts CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Owner ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Accounts</TableHead>
                <TableHead className="text-center">Queries</TableHead>
                <TableHead className="text-center">Logins</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClients.map((owner) => {
                const ownerQueries = getOwnerQueries(owner.ownerEmail);
                const headOfFamily = owner.accounts.find(acc => acc.headOfFamily);

                return (
                  <TableRow key={owner.ownerId}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {headOfFamily ? (
                          <Crown className="h-4 w-4 text-blue-600" />
                        ) : (
                          <User className="h-4 w-4 text-gray-600" />
                        )}
                        <div>
                          <div className="font-medium text-sm">{sanitizeName(owner.ownerName)}</div>
                          <div className="text-xs text-muted-foreground">{owner.ownerEmail}</div>
                          <div className="text-xs text-muted-foreground">
                            Code: {owner.primaryClientCode}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-mono">{owner.ownerId}</div>
                      <div className="text-xs text-muted-foreground">
                        Group: {sanitizeName(owner.groupName)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(owner.onboardingStatus)}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {owner.accounts.filter(acc => acc.onboardingStatus === 'completed').length}/{owner.totalAccounts} complete
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="font-semibold">{owner.totalAccounts}</div>
                      <div className="text-xs text-muted-foreground">{sanitizeName(owner.groupName)}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="font-semibold">{ownerQueries.length}</div>
                      <div className="text-xs text-muted-foreground">
                        {ownerQueries.filter(q => q.status === 'pending').length} pending
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="font-semibold">{owner.totalLogins}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {owner.lastActivity
                          ? new Date(owner.lastActivity).toLocaleDateString()
                          : 'No activity'
                        }
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Created: {new Date(owner.createdAt).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedClient(owner);
                              setShowAccountsDialog(true);
                            }}
                          >
                            <Hash className="h-4 w-4 mr-2" />
                            View Accounts
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedClient(owner);
                              setShowQueriesDialog(true);
                            }}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            View Queries
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedClient(owner);
                              setShowImpersonateDialog(true);
                            }}
                            className="text-orange-600"
                          >
                            <UserCog className="h-4 w-4 mr-2" />
                            Impersonate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {filteredClients.length === 0 && !loading && (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No owners found</h3>
            <p className="text-muted-foreground">Try adjusting your search or filter criteria.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Admin Dashboard</h2>
          <p className="text-muted-foreground mt-2">
            Monitor owners, distributors, manage accounts, and track queries
          </p>
        </div>
        <Button
          onClick={fetchDashboardData}
          variant="outline"
          className="flex items-center space-x-2"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Enhanced Statistics Cards — hidden for distributor-only admins */}
      {statistics && !isDistributorOnlyAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <StatCard
            icon={Users}
            title="Total Owners"
            value={statistics.totalOwners}
            color="text-blue-500"
          />
          <StatCard
            icon={Building2}
            title="Total Accounts"
            value={statistics.totalAccounts}
            color="text-purple-500"
          />
          <StatCard
            icon={CheckCircle}
            title="Successful Account Setup"
            value={statistics.activeOwners}
            subtitle={`${statistics.pendingOnboarding} pending`}
            color="text-green-500"
          />
          <Link href="/admin/queries" className="block hover:shadow-md transition-shadow">
            <StatCard
              icon={MessageSquare}
              title="Total Queries"
              value={statistics.totalQueries}
              subtitle={`${statistics.pendingQueries} pending`}
              color="text-orange-500"
            />
          </Link>
          {/* Replace this StatCard */}
          {/* Total Logins - Clickable */}
          <div
            onClick={() => { fetchLoginsData('all'); setShowLoginsDialog(true); }}
            className="cursor-pointer hover:shadow-md transition-shadow rounded-lg"
          >
            <StatCard
              icon={LogIn}
              title="Total Logins"
              value={statistics.totalLogins}
              subtitle={`${statistics.uniqueLoginsThisWeek} this week`}
              color="text-teal-500"
            />
          </div>

          {/* Today's Logins - Clickable */}
          <div
            onClick={() => { fetchLoginsData('today'); setShowLoginsDialog(true); }}
            className="cursor-pointer hover:shadow-md transition-shadow rounded-lg"
          >
            <StatCard
              icon={TrendingUp}
              title="Today's Logins"
              value={statistics.uniqueLoginsToday}
              color="text-indigo-500"
            />
          </div>
        </div>
      )}

      {/* Main Tabs: Owners | Distributors */}
      <Tabs value={activeTab} onValueChange={(v) => {
        const tab = v as 'owners' | 'distributors' | 'app-analytics';
        setActiveTab(tab);
        if (tab === 'app-analytics' && !mobileData && !mobileLoading) {
          fetchAllAnalytics(analyticsDays);
        }
      }}>
        <TabsList>
          {!isDistributorOnlyAdmin && (
            <TabsTrigger value="owners" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Owners
              <Badge variant="secondary" className="ml-1">{allClients.length}</Badge>
            </TabsTrigger>
          )}
          <TabsTrigger value="distributors" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Distributors
            <Badge variant="secondary" className="ml-1">{distributors.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="app-analytics" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            App Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── OWNERS TAB ── */}
        <TabsContent value="owners" className="space-y-4 mt-4">

          {/* Filters and Search */}
          <Card>
            <CardHeader>
              <CardTitle>Owner Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center space-x-2 flex-1 min-w-64">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search owners, emails, or client codes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1"
                  />
                </div>

                <Select value={statusFilter} onValueChange={(value: 'all' | 'pending' | 'completed' | 'mixed') => setStatusFilter(value)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>

                {/* View Mode Toggle */}
                <div className="flex border rounded-lg">
                  <Button
                    variant={viewMode === 'cards' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('cards')}
                    className="rounded-r-none"
                  >
                    <Grid className="h-4 w-4 mr-2" />
                    Cards
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className="rounded-l-none"
                  >
                    <List className="h-4 w-4 mr-2" />
                    List
                  </Button>
                </div>
              </div>

              {message && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Content based on view mode */}
          {viewMode === 'list' ? (
            <OwnersListTable />
          ) : (
            <>
              {/* Export Button for Card View */}
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold flex items-center space-x-2">
                    <Grid className="h-5 w-5 text-blue-500" />
                    <span>Owner View - Card Format</span>
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Visual overview of owners with their grouped accounts
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>Export Options</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => exportToCSV(filteredClients, 'owners-cards', 'owners')}>
                      <FileText className="h-4 w-4 mr-2" />
                      Export Owners CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportToCSV(filteredClients, 'all-accounts-cards', 'accounts')}>
                      <Users className="h-4 w-4 mr-2" />
                      Export All Accounts CSV
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Owners Grid - Existing card view */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredClients.map((owner) => {
                  const ownerQueries = getOwnerQueries(owner.ownerEmail);
                  const headOfFamily = owner.accounts.find(acc => acc.headOfFamily);

                  return (
                    <Card key={owner.ownerId} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          {/* Header */}
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-2">
                              {headOfFamily ? (
                                <Crown className="h-4 w-4 text-blue-600" />
                              ) : (
                                <User className="h-4 w-4 text-gray-600" />
                              )}
                              <div>
                                <h3 className="font-semibold text-sm">{sanitizeName(owner.ownerName)}</h3>
                                <p className="text-xs text-muted-foreground">{owner.ownerEmail}</p>
                              </div>
                            </div>
                            {getStatusBadge(owner.onboardingStatus)}
                          </div>

                          {/* Stats Row */}
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="bg-muted/50 rounded p-2">
                              <div className="text-lg font-bold">{owner.totalAccounts}</div>
                              <div className="text-xs text-muted-foreground">Accounts</div>
                            </div>
                            <div className="bg-muted/50 rounded p-2">
                              <div className="text-lg font-bold">{owner.totalLogins}</div>
                              <div className="text-xs text-muted-foreground">Logins</div>
                            </div>
                            <div className="bg-muted/50 rounded p-2">
                              <div className="text-lg font-bold">{ownerQueries.length}</div>
                              <div className="text-xs text-muted-foreground">Queries</div>
                            </div>
                            <div className="bg-muted/50 rounded p-2">
                              <div className="text-lg font-bold">
                                {ownerQueries.filter(q => q.status === 'pending').length}
                              </div>
                              <div className="text-xs text-muted-foreground">Pending</div>
                            </div>
                          </div>

                          {/* Account Status Breakdown */}
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="font-medium">Account Status:</span>
                              <div className="flex space-x-1">
                                {owner.accounts.filter(acc => acc.onboardingStatus === 'completed').length > 0 && (
                                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                                    {owner.accounts.filter(acc => acc.onboardingStatus === 'completed').length} Complete
                                  </Badge>
                                )}
                                {owner.accounts.filter(acc => acc.onboardingStatus === 'pending').length > 0 && (
                                  <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">
                                    {owner.accounts.filter(acc => acc.onboardingStatus === 'pending').length} Pending
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Details */}
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <div className="flex justify-between">
                              <span>Owner ID:</span>
                              <span className="font-mono">{owner.ownerId}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Group:</span>
                              <span className="truncate ml-2">{sanitizeName(owner.groupName)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Group ID:</span>
                              <span className="font-mono">{owner.groupId}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Primary Code:</span>
                              <span className="font-mono">{owner.primaryClientCode}</span>
                            </div>
                            {owner.lastActivity && (
                              <div className="flex justify-between">
                                <span>Last Activity:</span>
                                <span>{new Date(owner.lastActivity).toLocaleDateString()}</span>
                              </div>
                            )}
                          </div>

                          {/* Recent Queries Preview */}
                          {ownerQueries.length > 0 && (
                            <div className="border-t pt-2">
                              <p className="text-xs font-medium mb-1">Recent Queries:</p>
                              <div className="space-y-1">
                                {ownerQueries.slice(0, 2).map((query) => (
                                  <div key={query.id} className="flex items-center justify-between text-xs">
                                    <span className="truncate">{query.subject}</span>
                                    {getQueryTypeBadge(query.type)}
                                  </div>
                                ))}
                                {ownerQueries.length > 2 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{ownerQueries.length - 2} more queries
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex space-x-1 pt-2 border-t">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedClient(owner);
                                setShowAccountsDialog(true);
                              }}
                              className="flex-1 text-xs"
                            >
                              <Hash className="h-3 w-3 mr-1" />
                              Accounts
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedClient(owner);
                                setShowImpersonateDialog(true);
                              }}
                              className="flex-1 text-xs"
                            >
                              <UserCog className="h-3 w-3 mr-1" />
                              Login
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedClient(owner);
                                setShowQueriesDialog(true);
                              }}
                              className="flex-1 text-xs"
                            >
                              <FileText className="h-3 w-3 mr-1" />
                              Queries
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {filteredClients.length === 0 && !loading && (
                <Card>
                  <CardContent className="text-center py-12">
                    <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No owners found</h3>
                    <p className="text-muted-foreground">Try adjusting your search or filter criteria.</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}

        </TabsContent>

        {/* ── DISTRIBUTORS TAB ── */}
        <TabsContent value="distributors" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="flex items-center space-x-2">
                    <Building2 className="h-5 w-5 text-orange-500" />
                    <span>Distributor Management</span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    All registered distributors in the system
                  </p>
                </div>
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    onClick={() => setShowAddDistributorDialog(true)}
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <Building2 className="h-4 w-4 mr-2" />
                    Add Distributor
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const headers = ['Client Code', 'Name', 'Email', 'Mobile', 'Onboarding Status', 'Login Count', 'Last Login', 'Created Date'];
                      const rows = filteredDistributors.map(d => [
                        `"${d.clientcode}"`,
                        `"${sanitizeName(d.clientname)}"`,
                        `"${d.email}"`,
                        `"${d.mobile || ''}"`,
                        d.onboarding_status,
                        d.login_count || 0,
                        d.last_login_at ? new Date(d.last_login_at).toLocaleDateString() : 'Never',
                        new Date(d.created_at).toLocaleDateString(),
                      ].join(','));
                      const csv = [headers.join(','), ...rows].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'distributors.csv';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or client code..."
                  value={distributorSearch}
                  onChange={(e) => setDistributorSearch(e.target.value)}
                  className="max-w-sm"
                />
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Client Code</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Logins</TableHead>
                      <TableHead>Last Login</TableHead>

                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDistributors.length > 0 ? (
                      filteredDistributors.map((d, idx) => (
                        <TableRow key={d.id || d.clientcode || idx}>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <Building2 className="h-4 w-4 text-orange-500" />
                              <span className="font-medium text-sm">{sanitizeName(d.clientname)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">{d.clientcode}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-1 text-sm">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span>{d.email}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{d.mobile || '—'}</TableCell>
                          <TableCell>
                            {getStatusBadge(d.onboarding_status)}
                          </TableCell>
                          <TableCell className="text-center font-semibold">
                            {d.login_count || 0}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {d.last_login_at
                              ? new Date(d.last_login_at).toLocaleDateString()
                              : 'Never'}
                          </TableCell>

                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={impersonating || !d.email}
                                onClick={() => handleImpersonateDistributor(d.email, sanitizeName(d.clientname))}
                                className="flex items-center gap-1 text-xs"
                              >
                                <UserCog className="h-3 w-3" />
                                Login as
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleDeleteDistributor(d.email || '', d.id || '', sanitizeName(d.clientname))}
                                className="flex items-center gap-1 text-xs px-2 bg-red-600 hover:bg-red-700 text-white border-0"
                                title="Delete Distributor"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-12">
                          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                          <p className="text-lg font-semibold">No distributors found</p>
                          <p className="text-muted-foreground text-sm">
                            {distributorSearch ? 'Try adjusting your search.' : 'No distributors registered yet.'}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                Showing {filteredDistributors.length} of {distributors.length} distributors
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── APP ANALYTICS TAB ── */}
        <TabsContent value="app-analytics" className="space-y-6 mt-4">

          {/* Controls */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5 text-blue-500" />
                    App Analytics
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Installs, users, sessions and daily usage across iOS and Android
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">App Store Vendor #</label>
                    <Input
                      placeholder="e.g. 85534321"
                      value={vendorNumber}
                      onChange={e => setVendorNumber(e.target.value)}
                      className="w-40 font-mono text-sm"
                    />
                  </div>
                  <Select
                    value={String(analyticsDays)}
                    onValueChange={v => { const d = parseInt(v); setAnalyticsDays(d); fetchAllAnalytics(d); }}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="14">Last 14 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => fetchAllAnalytics(analyticsDays)}
                    disabled={salesLoading || playLoading || mobileLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${(salesLoading || playLoading || mobileLoading) ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            {analyticsError && (
              <CardContent>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{analyticsError}</AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>

          {/* Summary stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download className="h-4 w-4 text-green-500" />
                  Installs ({analyticsDays}d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(salesLoading || playLoading) ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <div className="text-3xl font-bold">
                      {(((salesData?.summary ?? []).reduce((s: number, r: any) => s + (r.installs ?? 0), 0)) +
                        (playData?.totals?.newInstalls ?? 0)).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
                      <div className="flex justify-between">
                        <span>iOS (App Store)</span>
                        <span className="font-medium">
                          {((salesData?.summary ?? []).reduce((s: number, r: any) => s + (r.installs ?? 0), 0)).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Android (Play Store)</span>
                        <span className="font-medium">
                          {playData ? (playData.totals?.newInstalls ?? 0).toLocaleString() : '—'}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-500" />
                  Users ({analyticsDays}d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {mobileLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <div className="text-3xl font-bold">{(mobileData?.summary?.totalUsers ?? 0).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
                      {(mobileData?.platformSplit ?? []).length === 0 ? (
                        <div>No platform data yet</div>
                      ) : (
                        mobileData.platformSplit.map((p: any) => (
                          <div key={p.platform || 'unknown'} className="flex justify-between">
                            <span className="capitalize">{p.platform || 'unknown'}</span>
                            <span className="font-medium">{parseInt(p.users ?? '0').toLocaleString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-purple-500" />
                  Sessions ({analyticsDays}d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {mobileLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <div className="text-3xl font-bold">{(mobileData?.summary?.totalSessions ?? 0).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
                      {(mobileData?.platformSplit ?? []).length === 0 ? (
                        <div>No platform data yet</div>
                      ) : (
                        mobileData.platformSplit.map((p: any) => (
                          <div key={p.platform || 'unknown'} className="flex justify-between">
                            <span className="capitalize">{p.platform || 'unknown'}</span>
                            <span className="font-medium">{parseInt(p.sessions ?? '0').toLocaleString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-orange-500" />
                  Avg Daily Active Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                {mobileLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <div className="text-3xl font-bold">
                      {(() => {
                        const dau = mobileData?.dau ?? [];
                        if (dau.length === 0) return '0';
                        const sum = dau.reduce((s: number, r: any) => s + parseInt(r.active_users ?? '0'), 0);
                        return Math.round(sum / dau.length).toLocaleString();
                      })()}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      over {mobileData?.dau?.length ?? 0} day(s)
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Daily Usage table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Daily Usage
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Active users and sessions per day from in-app analytics (iOS + Android)
              </p>
            </CardHeader>
            <CardContent>
              {mobileLoading ? (
                <div className="space-y-2">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Active Users</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Events</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(mobileData?.dau ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                          No usage data yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      mobileData.dau.map((row: any) => (
                        <TableRow key={row.day}>
                          <TableCell className="font-medium">{new Date(row.day).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right font-semibold text-blue-700">{parseInt(row.active_users ?? '0').toLocaleString()}</TableCell>
                          <TableCell className="text-right">{parseInt(row.sessions ?? '0').toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{parseInt(row.total_events ?? '0').toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Per-store install breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-gray-700" />
                  iOS — Daily Installs (App Store)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!vendorNumber ? (
                  <p className="text-sm text-muted-foreground">Enter your App Store Vendor Number above and click Refresh to load data.</p>
                ) : salesLoading ? (
                  <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Installs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(salesData?.summary ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-muted-foreground py-6">No data</TableCell>
                        </TableRow>
                      ) : (
                        salesData.summary.map((row: any) => (
                          <TableRow key={row.date}>
                            <TableCell className="font-medium">{row.date}</TableCell>
                            <TableCell className="text-right font-semibold text-green-700">{row.installs.toLocaleString()}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-green-700" />
                  Android — Daily Installs (Play Store)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  From Play Console statistics report bucket — updated daily by Google with ~24h lag
                </p>
              </CardHeader>
              <CardContent>
                {playLoading ? (
                  <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : !playData ? (
                  <p className="text-sm text-muted-foreground">
                    Set <span className="font-mono text-xs">GOOGLE_PLAY_PACKAGE_NAME</span>, <span className="font-mono text-xs">GOOGLE_PLAY_REPORT_BUCKET</span>, and <span className="font-mono text-xs">GOOGLE_PLAY_SERVICE_ACCOUNT_KEY</span> env vars and click Refresh.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Installs</TableHead>
                        <TableHead className="text-right">Uninstalls</TableHead>
                        <TableHead className="text-right">Active</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(playData.summary ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-6">No data</TableCell>
                        </TableRow>
                      ) : (
                        playData.summary.map((row: any) => (
                          <TableRow key={row.date}>
                            <TableCell className="font-medium">{row.date}</TableCell>
                            <TableCell className="text-right font-semibold text-green-700">{row.newInstalls.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{row.uninstalls.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.activeInstalls.toLocaleString()}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Web vs App login split */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" />
                Web vs App — Login Split
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                How client logins break down between the web portal and the mobile app
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Live data */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  Live (tracked since platform-split rollout)
                </div>
                {loginSplitLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Distinct users — Web</div>
                      <div className="text-2xl font-bold">{loginSplitData?.distinctUsers?.web ?? 0}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Distinct users — App</div>
                      <div className="text-2xl font-bold">{loginSplitData?.distinctUsers?.app ?? 0}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Used both</div>
                      <div className="text-2xl font-bold">{loginSplitData?.distinctUsers?.both ?? 0}</div>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Sourced live from <span className="font-mono">/api/admin/login-analytics</span>. Will read
                  zero/low until real logins accumulate on the new platform counters.
                </p>
              </div>

              {/* Estimated snapshot — clearly separated from live data */}
              <div className="border-t pt-4">
                <div className="text-xs font-semibold text-amber-600 mb-2 uppercase tracking-wide">
                  Estimated snapshot — not live data
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs text-muted-foreground">Onboarded (password set)</div>
                    <div className="text-2xl font-bold">{ESTIMATED_PLATFORM_SPLIT.onboarded}</div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs text-muted-foreground">Modeled — Web</div>
                    <div className="text-2xl font-bold">{ESTIMATED_PLATFORM_SPLIT.web}</div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs text-muted-foreground">Modeled — App</div>
                    <div className="text-2xl font-bold">{ESTIMATED_PLATFORM_SPLIT.app}</div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs text-muted-foreground">Not onboarded yet</div>
                    <div className="text-2xl font-bold">{ESTIMATED_PLATFORM_SPLIT.notOnboarded}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  One-time estimate computed {ESTIMATED_PLATFORM_SPLIT.computedOn} from onboarding status and each
                  client&apos;s first NAV date relative to the Apr 7, 2026 app launch — not observed login events.
                  Replace with the live numbers above once real usage accumulates.
                </p>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

      </Tabs>

      {/* Add Distributor Dialog */}
      <Dialog open={showAddDistributorDialog} onOpenChange={setShowAddDistributorDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Distributor</DialogTitle>
            <DialogDescription>
              Enter the initial details for the distributor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Salutation</label>
              <Select 
                value={newDistributor.salutation} 
                onValueChange={(val) => setNewDistributor({...newDistributor, salutation: val})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select salutation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mr">Mr</SelectItem>
                  <SelectItem value="Ms">Ms</SelectItem>
                  <SelectItem value="Mrs">Mrs</SelectItem>
                  <SelectItem value="Dr">Dr</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Distributor Name (Company/Person) *</label>
              <Select
                value={newDistributor.clientname}
                onValueChange={(val) => setNewDistributor({
                  ...newDistributor,
                  clientname: val,
                  firstname: val
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select or type distributor name" />
                </SelectTrigger>
                <SelectContent>
                  {intermediaryNames.map((name, idx) => (
                    <SelectItem key={idx} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Email Address *</label>
              <Input
                type="email"
                placeholder="e.g. contact@distributor.com"
                value={newDistributor.email}
                onChange={e => setNewDistributor({...newDistributor, email: e.target.value})}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Intermediary Name</label>
              <Input
                placeholder="e.g. QODE ADVISORS LLP INT"
                value={newDistributor.intermediaryname}
                onChange={e => setNewDistributor({...newDistributor, intermediaryname: e.target.value})}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Intermediary Fee Percentage</label>
              <Input
                type="number"
                placeholder="50.00"
                value={newDistributor.intermediary_fee_percentage}
                onChange={e => setNewDistributor({...newDistributor, intermediary_fee_percentage: parseFloat(e.target.value) || 0})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDistributorDialog(false)} disabled={addingDistributor}>
              Cancel
            </Button>
            <Button onClick={handleAddDistributor} disabled={addingDistributor || !newDistributor.clientname || !newDistributor.email}>
              {addingDistributor ? 'Adding...' : 'Add Distributor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accounts Detail Dialog */}
      <Dialog open={showAccountsDialog} onOpenChange={setShowAccountsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Hash className="h-5 w-5 text-blue-500" />
              <span>Owner Accounts - {sanitizeName(selectedClient?.ownerName)}</span>
            </DialogTitle>
            <DialogDescription>
              <div className="flex items-center space-x-4 text-sm">
                <span><strong>Email:</strong> {selectedClient?.ownerEmail}</span>
                <span><strong>Total Accounts:</strong> {selectedClient?.totalAccounts}</span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[400px] w-full">
            <div className="space-y-3 pr-4">
              {selectedClient?.accounts.map((account) => (
                <Card key={account.clientCode} className="border border-muted">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {account.headOfFamily ? (
                          <Crown className="h-4 w-4 text-blue-600" />
                        ) : (
                          <User className="h-4 w-4 text-gray-600" />
                        )}
                        <div>
                          <h4 className="font-semibold text-sm">{sanitizeName(account.clientName)}</h4>
                          <p className="text-xs text-muted-foreground font-mono">{account.clientCode}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {getStatusBadge(account.onboardingStatus)}
                        {account.headOfFamily && (
                          <Badge variant="outline" className="text-xs">Head of Family</Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <div>
                        <span className="font-medium">Created:</span>
                        <p className="text-muted-foreground">{new Date(account.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <span className="font-medium">Logins:</span>
                        <p className="text-muted-foreground">{account.loginCount}</p>
                      </div>
                      <div>
                        <span className="font-medium">Last Login:</span>
                        <p className="text-muted-foreground">
                          {account.lastLogin ? new Date(account.lastLogin).toLocaleDateString() : 'Never'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccountsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Queries Detail Dialog */}
      <Dialog open={showQueriesDialog} onOpenChange={setShowQueriesDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <FileText className="h-5 w-5 text-blue-500" />
              <span>Owner Queries - {sanitizeName(selectedClient?.ownerName)}</span>
            </DialogTitle>
            <DialogDescription>
              <div className="flex items-center space-x-4 text-sm">
                <span><strong>Email:</strong> {selectedClient?.ownerEmail}</span>
                <span><strong>Total Queries:</strong> {selectedClient ? getOwnerQueries(selectedClient.ownerEmail).length : 0}</span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[500px] w-full">
            <div className="space-y-4 pr-4">
              {selectedClient && getOwnerQueries(selectedClient.ownerEmail).length > 0 ? (
                getOwnerQueries(selectedClient.ownerEmail).map((query) => (
                  <Card key={query.id} className="border border-muted">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm">{query.subject}</h4>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(query.created_at).toLocaleString()} • Client: {query.nuvama_code}
                            </p>
                          </div>
                          <div className="flex items-center space-x-2">
                            {getQueryTypeBadge(query.type)}
                            {getQueryStatusBadge(query.status)}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="font-medium">Priority:</span>
                            <Badge variant="outline" className="ml-2 text-xs">
                              {query.priority}
                            </Badge>
                          </div>
                          <div>
                            <span className="font-medium">Email Sent:</span>
                            <span className="ml-2">{query.email_sent ? 'Yes' : 'No'}</span>
                          </div>
                        </div>

                        {query.data && Object.keys(query.data).length > 0 && (
                          <div className="bg-muted/50 rounded p-3">
                            <p className="font-medium text-xs mb-2">Query Details:</p>
                            <div className="text-xs space-y-1">
                              {Object.entries(query.data).map(([key, value]) => (
                                <div key={key} className="flex justify-between">
                                  <span className="font-medium capitalize">{key.replace(/_/g, ' ')}:</span>
                                  <span className="text-muted-foreground truncate ml-2">
                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {query.resolved_at && (
                          <div className="text-xs text-green-600">
                            <span className="font-medium">Resolved:</span>
                            <span className="ml-2">{new Date(query.resolved_at).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-8">
                  <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No queries found</h3>
                  <p className="text-muted-foreground">This owner hasn't submitted any queries yet.</p>
                </div>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQueriesDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonation Confirmation Dialog */}
      <Dialog open={showImpersonateDialog} onOpenChange={setShowImpersonateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span>Admin Impersonation Warning</span>
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>You are about to impersonate:</p>
              <div className="bg-muted p-3 rounded">
                <p><strong>Owner:</strong> {sanitizeName(selectedClient?.ownerName)}</p>
                <p><strong>Email:</strong> {selectedClient?.ownerEmail}</p>
                <p><strong>Primary Code:</strong> {selectedClient?.primaryClientCode}</p>
                <p><strong>Total Accounts:</strong> {selectedClient?.totalAccounts}</p>
              </div>
              <div className="bg-red-50 border border-red-200 p-3 rounded">
                <p className="text-red-800 text-sm">
                  <strong>Security Notice:</strong> This will give you access to all of this owner's accounts.
                  Only proceed if this is for legitimate support purposes. All actions will be logged.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowImpersonateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedClient && handleImpersonate(selectedClient.primaryClientCode)}
              disabled={impersonating}
              className="bg-red-600 hover:bg-red-700"
            >
              {impersonating ? 'Impersonating...' : 'Confirm Impersonation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logins History Dialog */}
      {/* Logins History Dialog */}
      <Dialog open={showLoginsDialog} onOpenChange={setShowLoginsDialog}>
        <DialogContent className="max-w-6xl  max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <LogIn className="h-5 w-5 text-teal-500" />
              <span>Login History</span>
            </DialogTitle>
            <DialogDescription>
              <div className="flex items-center space-x-4 text-sm">
                <span><strong>Total Logins:</strong> {statistics?.totalLogins || 0}</span>
                <span><strong>Today:</strong> {statistics?.uniqueLoginsToday || 0}</span>
                <span><strong>This Week:</strong> {statistics?.uniqueLoginsThisWeek || 0}</span>
              </div>
            </DialogDescription>
          </DialogHeader>

          {/* Filter Tabs */}
          <div className="flex space-x-2 border-b pb-2">
            <Button
              variant={loginFilter === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => fetchLoginsData('all')}
            >
              <Users className="h-4 w-4 mr-2" />
              All Logins
            </Button>
            <Button
              variant={loginFilter === 'today' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => fetchLoginsData('today')}
            >
              <Calendar className="h-4 w-4 mr-2" />
              Today ({statistics?.uniqueLoginsToday || 0})
            </Button>
            <Button
              variant={loginFilter === 'week' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => fetchLoginsData('week')}
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              This Week ({statistics?.uniqueLoginsThisWeek || 0})
            </Button>
          </div>

          <ScrollArea className="h-[450px] w-full">
            {loadingLogins ? (
              <div className="space-y-3">
                {Array(5).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : loginsData.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Owner</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-center">Total Logins</TableHead>
                      {/* <TableHead className="text-center">Accounts</TableHead> */}
                      <TableHead>Last Login</TableHead>
                      {/* <TableHead>Details</TableHead> */}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loginsData.map((owner, index) => (
                      <TableRow key={`${owner.ownerEmail}-${index}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium text-sm">{sanitizeName(owner.ownerName)}</div>
                            <div className="text-xs text-muted-foreground">{owner.ownerEmail}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{sanitizeName(owner.groupName)}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className="bg-teal-100 text-teal-800">
                            {owner.totalLoginCount}
                          </Badge>
                        </TableCell>
                        {/* <TableCell className="text-center">
                          <span className="text-sm">
                            {owner.accountsLoggedIn}/{owner.totalAccounts}
                          </span>
                        </TableCell> */}
                        <TableCell>
                          {owner.lastLogin ? (
                            <div>
                              <div className="text-sm">
                                {new Date(owner.lastLogin).toLocaleDateString('en-IN', {
                                  timeZone: 'Asia/Kolkata'
                                })}
                              </div>
                              {/* <div className="text-xs text-muted-foreground">
                                  {new Date(owner.lastLogin).toLocaleTimeString('en-IN', {
                                    timeZone: 'Asia/Kolkata',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    hour12: true
                                  })}
                                </div> */}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">Never</span>
                          )}
                        </TableCell>
                        {/* <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-72">
                              <DropdownMenuLabel>Account Login Details</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {owner.accounts.map((acc: any) => (
                                <div key={acc.clientCode} className="px-2 py-1.5 text-xs">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-1">
                                      {acc.headOfFamily ? (
                                        <Crown className="h-3 w-3 text-blue-600" />
                                      ) : (
                                        <User className="h-3 w-3 text-gray-500" />
                                      )}
                                      <span className="font-mono">{acc.clientCode}</span>
                                    </div>
                                    <Badge variant="outline" className="text-xs">
                                      {acc.loginCount} logins
                                    </Badge>
                                  </div>
                                  <div className="text-muted-foreground mt-0.5 ml-4">
                                    {acc.lastLogin
                                      ? `Last: ${new Date(acc.lastLogin).toLocaleString()}`
                                      : 'Never logged in'
                                    }
                                  </div>
                                </div>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell> */}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <LogIn className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {loginFilter === 'today'
                    ? 'No logins today'
                    : loginFilter === 'week'
                      ? 'No logins this week'
                      : 'No login history'}
                </h3>
                <p className="text-muted-foreground">
                  {loginFilter === 'today'
                    ? 'No users have logged in today yet.'
                    : loginFilter === 'week'
                      ? 'No users have logged in this week.'
                      : 'No users have logged in yet.'}
                </p>
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Showing {loginsData.length} owner{loginsData.length !== 1 ? 's' : ''} with {loginsData.reduce((sum, o) => sum + o.totalLoginCount, 0)} total logins
            </div>
            <Button variant="outline" onClick={() => setShowLoginsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminOnboardingPage() {
  return (
    <AdminAuthProvider>
      <AdminLayout title="Admin Dashboard">
        <AdminDashboardContent />
      </AdminLayout>
    </AdminAuthProvider>
  );
}