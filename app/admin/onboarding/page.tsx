// app/admin/onboarding/page.tsx
"use client";

import { AdminAuthProvider } from '@/components/admin-auth-provider';
import { AdminLayout } from '@/components/admin-layout';
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
  MoreHorizontal
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

function AdminDashboardContent() {
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
          <h2 className="text-2xl font-bold">Owner Management Dashboard</h2>
          <p className="text-muted-foreground mt-2">
            Monitor owners, manage multiple accounts, and track queries
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

      {/* Enhanced Statistics Cards */}
      {statistics && (
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
            title="Active Owners"
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
          <StatCard
            icon={LogIn}
            title="Total Logins"
            value={statistics.totalLogins}
            subtitle={`${statistics.uniqueLoginsThisWeek} this week`}
            color="text-teal-500"
          />
          <StatCard
            icon={TrendingUp}
            title="Today's Logins"
            value={statistics.uniqueLoginsToday}
            color="text-indigo-500"
          />
        </div>
      )}

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
    </div>
  );
}

export default function AdminOnboardingPage() {
  return (
    <AdminAuthProvider>
      <AdminLayout title="Owner Management Dashboard">
        <AdminDashboardContent />
      </AdminLayout>
    </AdminAuthProvider>
  );
}