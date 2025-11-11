// app/admin/queries/page.tsx
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  MessageSquare,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Mail,
  User,
  Filter,
  Download,
  Send,
  TrendingUp,
  XCircle,
  UserCog,
  MoreVertical,
  History,
  Plus,
  X as CloseIcon,
  AlertCircle,
  ArrowRight,
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

interface Query {
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
  assigned_to: string | null;
  last_updated_by: string | null;
  parent_inquiry_id: string | null;
  thread_id: string;
  is_client_message: boolean;
  client_name?: string;
}

interface QueryNote {
  id: number;
  inquiry_id: string;
  admin_email: string;
  note_type: string;
  content: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface QueryStatistics {
  totalQueries: number;
  pendingQueries: number;
  resolvedQueries: number;
  todayQueries: number;
  thisWeekQueries: number;
  highPriorityQueries: number;
  queriesByType: Record<string, number>;
  avgResolutionTime: string;
}

interface EmailData {
  to: string;
  cc: string[];
  subject: string;
  message: string;
}

function QueryResolverContent() {
  const [queries, setQueries] = useState<Query[]>([]);
  const [filteredQueries, setFilteredQueries] = useState<Query[]>([]);
  const [statistics, setStatistics] = useState<QueryStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [selectedQuery, setSelectedQuery] = useState<Query | null>(null);
  const [queryNotes, setQueryNotes] = useState<QueryNote[]>([]);
  const [showQueryDialog, setShowQueryDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [showReplyDialog, setShowReplyDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [queryToDelete, setQueryToDelete] = useState<Query | null>(null);
  const [message, setMessage] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [newNote, setNewNote] = useState('');
  const [sendEmailOnResolve, setSendEmailOnResolve] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // Email state
  const [emailData, setEmailData] = useState<EmailData>({
    to: '',
    cc: [],
    subject: '',
    message: '',
  });
  const [ccInput, setCcInput] = useState('');

  useEffect(() => {
    fetchQueriesData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [queries, searchTerm, statusFilter, typeFilter, priorityFilter]);

  const fetchQueriesData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/queries');
      const data = await response.json();

      if (data.success) {
        setQueries(data.data.queries);
        setStatistics(data.data.statistics);
      } else {
        setMessage('Failed to load queries data');
      }
    } catch (error) {
      console.error('Failed to fetch queries:', error);
      setMessage('Failed to load queries data');
    } finally {
      setLoading(false);
    }
  };

  const fetchQueryNotes = async (queryId: string) => {
    try {
      const response = await fetch(`/api/admin/queries?queryId=${queryId}&action=getNotes`);
      const data = await response.json();
      if (data.success) {
        setQueryNotes(data.data.notes);
      }
    } catch (error) {
      console.error('Failed to fetch query notes:', error);
    }
  };

  const applyFilters = () => {
    let filtered = [...queries];

    if (searchTerm) {
      filtered = filtered.filter(q =>
        q.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.nuvama_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.user_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (q.client_name && q.client_name.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(q => q.status === statusFilter);
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(q => q.type === typeFilter);
    }

    if (priorityFilter !== 'all') {
      filtered = filtered.filter(q => q.priority === priorityFilter);
    }

    setFilteredQueries(filtered);
  };

  const handleQueryClick = async (queryItem: Query) => {
    setSelectedQuery(queryItem);
    await fetchQueryNotes(queryItem.id);
    setShowQueryDialog(true);
  };

  const handleSendReply = async () => {
    if (!selectedQuery || !emailData.to || !emailData.subject || !emailData.message) {
      setMessage('Please fill in all email fields');
      return;
    }

    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendResponse',
          queryId: selectedQuery.id,
          emailData: {
            to: emailData.to,
            cc: emailData.cc.length > 0 ? emailData.cc : undefined,
            subject: emailData.subject,
            message: emailData.message,
          },
        }),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        throw new Error('Server returned an error.');
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      setMessage('Reply sent successfully');
      setShowReplyDialog(false);
      setEmailData({ to: '', cc: [], subject: '', message: '' });
      
      await fetchQueryNotes(selectedQuery.id);
      fetchQueriesData();
    } catch (error) {
      console.error('Send reply error:', error);
      setMessage(error instanceof Error ? error.message : 'Failed to send reply');
    } finally {
      setProcessing(false);
    }
  };

  const handleResolveQuery = async () => {
    if (!selectedQuery || !resolveNote.trim()) {
      setMessage('Please add a resolution note');
      return;
    }

    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          queryId: selectedQuery.id,
          note: resolveNote,
          sendEmail: sendEmailOnResolve,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Query resolved successfully');
        setShowResolveDialog(false);
        setResolveNote('');
        setShowQueryDialog(false);
        fetchQueriesData();
      } else {
        setMessage(`Failed to resolve query: ${data.error}`);
      }
    } catch (error) {
      console.error('Resolve error:', error);
      setMessage('Failed to resolve query');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteQuery = async () => {
    if (!queryToDelete) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          queryId: queryToDelete.id,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Query deleted successfully');
        setShowDeleteDialog(false);
        setQueryToDelete(null);
        setShowQueryDialog(false);
        fetchQueriesData();
      } else {
        setMessage(`Failed to delete query: ${data.error}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      setMessage('Failed to delete query');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedQuery || !newNote.trim()) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addNote',
          queryId: selectedQuery.id,
          note: newNote,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setNewNote('');
        fetchQueryNotes(selectedQuery.id);
        setMessage('Note added successfully');
      } else {
        setMessage('Failed to add note');
      }
    } catch (error) {
      console.error('Add note error:', error);
      setMessage('Failed to add note');
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdatePriority = async (queryId: string, priority: string) => {
    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePriority',
          queryId,
          priority,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Priority updated');
        fetchQueriesData();
        if (selectedQuery?.id === queryId) {
          fetchQueryNotes(selectedQuery.id);
        }
      } else {
        setMessage('Failed to update priority');
      }
    } catch (error) {
      console.error('Update priority error:', error);
      setMessage('Failed to update priority');
    } finally {
      setProcessing(false);
    }
  };

  const handleReopenQuery = async (queryId: string) => {
    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reopen',
          queryId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Query reopened successfully');
        fetchQueriesData();
      } else {
        setMessage('Failed to reopen query');
      }
    } catch (error) {
      console.error('Reopen error:', error);
      setMessage('Failed to reopen query');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddCc = () => {
    if (ccInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccInput.trim())) {
      setEmailData(prev => ({
        ...prev,
        cc: [...prev.cc, ccInput.trim()]
      }));
      setCcInput('');
    } else {
      setMessage('Please enter a valid email address');
    }
  };

  const handleRemoveCc = (email: string) => {
    setEmailData(prev => ({
      ...prev,
      cc: prev.cc.filter(e => e !== email)
    }));
  };

  const openReplyDialog = (queryItem: Query) => {
    setSelectedQuery(queryItem);
    setEmailData({
      to: queryItem.user_email,
      cc: [],
      subject: `Re: ${queryItem.subject}`,
      message: `Dear Client,\n\nRegarding your query: "${queryItem.subject}"\n\n`,
    });
    setShowReplyDialog(true);
  };

  const exportToCSV = () => {
    const csvContent = [
      ['Query ID', 'Type', 'Client Code', 'Client Name', 'Email', 'Subject', 'Status', 'Priority', 'Created', 'Resolved'].join(','),
      ...filteredQueries.map(q => [
        q.id,
        q.type,
        q.nuvama_code,
        `"${q.client_name || 'Unknown'}"`,
        q.user_email,
        `"${q.subject}"`,
        q.status,
        q.priority,
        new Date(q.created_at).toLocaleDateString(),
        q.resolved_at ? new Date(q.resolved_at).toLocaleDateString() : 'N/A'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `queries-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setMessage(`Exported ${filteredQueries.length} queries to CSV`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'resolved':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Resolved</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    const colors = {
      'high': 'bg-red-100 text-red-800',
      'medium': 'bg-orange-100 text-orange-800',
      'low': 'bg-blue-100 text-blue-800',
    };
    return <Badge className={colors[priority as keyof typeof colors] || 'bg-gray-100 text-gray-800'}>{priority}</Badge>;
  };

  const getQueryTypeBadge = (type: string) => {
    const colors = {
      'strategy': 'bg-blue-100 text-blue-800',
      'discussion': 'bg-purple-100 text-purple-800',
      'switch': 'bg-orange-100 text-orange-800',
      'withdrawal': 'bg-red-100 text-red-800',
      'feedback': 'bg-green-100 text-green-800',
      'testimonial': 'bg-lime-100 text-lime-800',
      'referral': 'bg-pink-100 text-pink-800',
      'investor_referral': 'bg-pink-100 text-pink-800',
      'raised_request': 'bg-teal-100 text-teal-800',
      'payment_confirmation': 'bg-yellow-100 text-yellow-800',
      'new_strategy_payment': 'bg-violet-100 text-violet-800',
      'payment_success': 'bg-emerald-100 text-emerald-800',
      'new_strategy_payment_success': 'bg-indigo-100 text-indigo-800',
      'sip_success': 'bg-cyan-100 text-cyan-800',
      'admin_response': 'bg-slate-100 text-slate-800',
      'admin_notification': 'bg-gray-100 text-gray-800',
    };
    return <Badge className={colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800'}>{type}</Badge>;
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

  const queryTypes = useMemo(() => {
    const types = new Set(queries.map(q => q.type));
    return Array.from(types);
  }, [queries]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Queries Management</h2>
          <p className="text-muted-foreground mt-2">
            Manage and resolve client queries
          </p>
        </div>
        <div className="flex space-x-2">
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={fetchQueriesData} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Statistics */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            icon={MessageSquare}
            title="Total Queries"
            value={statistics.totalQueries}
            color="text-blue-500"
          />
          <StatCard
            icon={Clock}
            title="Pending"
            value={statistics.pendingQueries}
            subtitle={`${statistics.highPriorityQueries} high priority`}
            color="text-orange-500"
          />
          <StatCard
            icon={CheckCircle}
            title="Resolved"
            value={statistics.resolvedQueries}
            subtitle={`Avg: ${statistics.avgResolutionTime}`}
            color="text-green-500"
          />
          <StatCard
            icon={TrendingUp}
            title="Today"
            value={statistics.todayQueries}
            subtitle={`${statistics.thisWeekQueries} this week`}
            color="text-purple-500"
          />
          <StatCard
            icon={AlertCircle}
            title="High Priority"
            value={statistics.highPriorityQueries}
            subtitle="Needs attention"
            color="text-red-500"
          />
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Filter className="h-5 w-5" />
            <span>Query Filters</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center space-x-2 flex-1 min-w-64">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search queries, clients, subjects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1"
              />
            </div>

            <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {queryTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {message && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Queries Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>All Queries ({filteredQueries.length})</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client & Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQueries.map((queryItem) => (
                  <TableRow 
                    key={queryItem.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleQueryClick(queryItem)}
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium text-sm">{queryItem.nuvama_code}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{queryItem.client_name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{queryItem.user_email}</div>
                        {getQueryTypeBadge(queryItem.type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-md">
                        <div className="font-medium text-sm line-clamp-2">{queryItem.subject}</div>
                        {queryItem.assigned_to && (
                          <div className="text-xs text-muted-foreground mt-1">
                            <UserCog className="h-3 w-3 inline mr-1" />
                            {queryItem.assigned_to}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(queryItem.status)}
                      {queryItem.resolved_at && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(queryItem.resolved_at).toLocaleDateString()}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getPriorityBadge(queryItem.priority)}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {new Date(queryItem.created_at).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openReplyDialog(queryItem)}>
                            <Mail className="h-4 w-4 mr-2" />
                            Send Reply
                          </DropdownMenuItem>
                          {queryItem.status === 'pending' && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedQuery(queryItem);
                                  setShowResolveDialog(true);
                                }}
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Resolve Query
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>Change Priority</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleUpdatePriority(queryItem.id, 'high')}>
                                High Priority
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdatePriority(queryItem.id, 'medium')}>
                                Medium Priority
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdatePriority(queryItem.id, 'low')}>
                                Low Priority
                              </DropdownMenuItem>
                            </>
                          )}
                          {queryItem.status === 'resolved' && (
                            <DropdownMenuItem onClick={() => handleReopenQuery(queryItem.id)}>
                              <XCircle className="h-4 w-4 mr-2" />
                              Reopen Query
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => {
                              setQueryToDelete(queryItem);
                              setShowDeleteDialog(true);
                            }}
                            className="text-red-600 focus:text-red-600"
                          >
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            Delete Query
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredQueries.length === 0 && (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No queries found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or search criteria.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Query Detail Dialog */}
      <Dialog open={showQueryDialog} onOpenChange={setShowQueryDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MessageSquare className="h-5 w-5 text-blue-500" />
                <span>Query Details</span>
              </div>
              {selectedQuery && getStatusBadge(selectedQuery.status)}
            </DialogTitle>
            <DialogDescription>
              Query from {selectedQuery?.client_name || 'client'}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="details" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details">Query Details</TabsTrigger>
              <TabsTrigger value="notes">Internal Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="flex-1 overflow-auto mt-4">
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-4">
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Client Code</p>
                          <p className="text-sm">{selectedQuery?.nuvama_code}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Client Name</p>
                          <p className="text-sm">{selectedQuery?.client_name}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Email</p>
                          <p className="text-sm">{selectedQuery?.user_email}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Priority</p>
                          {selectedQuery && getPriorityBadge(selectedQuery.priority)}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Subject</p>
                        <p className="text-sm font-medium">{selectedQuery?.subject}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Query Details</p>
                        {selectedQuery?.data && typeof selectedQuery.data === 'object' && (
                          <div className="bg-muted/50 p-3 rounded text-sm">
                            <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(selectedQuery.data, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                        <div>
                          <p className="font-medium">Created</p>
                          <p>{selectedQuery && new Date(selectedQuery.created_at).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="font-medium">Last Updated</p>
                          <p>{selectedQuery && new Date(selectedQuery.updated_at).toLocaleString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="notes" className="flex-1 overflow-auto mt-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Add Internal Note</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Textarea
                      placeholder="Add an internal note (not visible to client)..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      rows={3}
                    />
                    <Button onClick={handleAddNote} disabled={processing || !newNote.trim()} size="sm">
                      <Send className="h-4 w-4 mr-2" />
                      Add Note
                    </Button>
                  </CardContent>
                </Card>

                <ScrollArea className="h-[300px]">
                  <div className="space-y-3 pr-4">
                    {queryNotes.length > 0 ? (
                      queryNotes.map((note) => (
                        <Card key={note.id} className="border-l-4 border-l-purple-500">
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <History className="h-4 w-4 text-muted-foreground" />
                                <span className="text-xs font-medium">{note.admin_email}</span>
                                <Badge variant="outline" className="text-xs">{note.note_type}</Badge>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {new Date(note.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                            {note.old_value && note.new_value && (
                              <div className="mt-2 text-xs">
                                <span className="text-red-600">{note.old_value}</span>
                                <span className="mx-2">→</span>
                                <span className="text-green-600">{note.new_value}</span>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <div className="text-center py-8">
                        <History className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No internal notes yet</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            {selectedQuery?.status === 'pending' && (
              <>
                <Button variant="outline" onClick={() => openReplyDialog(selectedQuery)}>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Reply
                </Button>
                <Button 
                  onClick={() => setShowResolveDialog(true)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Resolve Query
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setShowQueryDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Query Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <span>Delete Query</span>
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the query and all associated notes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                <strong>Warning:</strong> You are about to delete:
              </AlertDescription>
            </Alert>

            <div className="bg-muted p-4 rounded text-sm space-y-2">
              <p><strong>Subject:</strong> {queryToDelete?.subject}</p>
              <p><strong>Client:</strong> {queryToDelete?.nuvama_code} - {queryToDelete?.client_name}</p>
              <p><strong>Status:</strong> {queryToDelete?.status}</p>
              <p><strong>Created:</strong> {queryToDelete && new Date(queryToDelete.created_at).toLocaleString()}</p>
            </div>

            <p className="text-sm text-muted-foreground">
              Type <strong>DELETE</strong> to confirm this action:
            </p>
            <Input
              id="delete-confirmation"
              placeholder="Type DELETE to confirm"
              onChange={(e) => {
                const btn = document.getElementById('confirm-delete-btn') as HTMLButtonElement;
                if (btn) {
                  btn.disabled = e.target.value !== 'DELETE';
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteDialog(false);
                setQueryToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              id="confirm-delete-btn"
              onClick={handleDeleteQuery}
              disabled={processing}
              className="bg-red-600 hover:bg-red-700"
            >
              {processing ? 'Deleting...' : 'Delete Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Reply Dialog */}
      <Dialog open={showReplyDialog} onOpenChange={setShowReplyDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <ArrowRight className="h-5 w-5 text-blue-500" />
              <span>Reply to Query</span>
            </DialogTitle>
            <DialogDescription>
              Send a response to this query
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-auto pr-2">
            <div className="bg-muted p-3 rounded text-sm">
              <p><strong>Subject:</strong> {selectedQuery?.subject}</p>
              <p><strong>Client:</strong> {selectedQuery?.nuvama_code} - {selectedQuery?.client_name}</p>
            </div>

            <div className="space-y-2">
              <Label>To *</Label>
              <Input
                type="email"
                value={emailData.to}
                onChange={(e) => setEmailData(prev => ({ ...prev, to: e.target.value }))}
                placeholder="recipient@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label>CC (Optional)</Label>
              <div className="flex space-x-2">
                <Input
                  type="email"
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCc())}
                  placeholder="cc@example.com"
                />
                <Button type="button" onClick={handleAddCc} size="sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {emailData.cc.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {emailData.cc.map((email) => (
                    <Badge key={email} variant="secondary" className="pl-2 pr-1">
                      {email}
                      <button
                        onClick={() => handleRemoveCc(email)}
                        className="ml-1 hover:bg-muted rounded-full p-0.5"
                      >
                        <CloseIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={emailData.subject}
                onChange={(e) => setEmailData(prev => ({ ...prev, subject: e.target.value }))}
                placeholder="Email subject"
              />
            </div>

            <div className="space-y-2">
              <Label>Message *</Label>
              <Textarea
                value={emailData.message}
                onChange={(e) => setEmailData(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Compose your reply..."
                rows={10}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowReplyDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendReply}
              disabled={processing || !emailData.to || !emailData.subject || !emailData.message}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {processing ? 'Sending...' : 'Send Reply'}
              <Send className="h-4 w-4 ml-2" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Query Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span>Resolve Query</span>
            </DialogTitle>
            <DialogDescription>
              Mark this query as resolved
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-muted p-3 rounded text-sm">
              <p><strong>Subject:</strong> {selectedQuery?.subject}</p>
              <p><strong>Client:</strong> {selectedQuery?.nuvama_code}</p>
            </div>

            <div className="space-y-2">
              <Label>Resolution Notes *</Label>
              <Textarea
                placeholder="Describe how this query was resolved..."
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                rows={4}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="sendEmail"
                checked={sendEmailOnResolve}
                onChange={(e) => setSendEmailOnResolve(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="sendEmail" className="text-sm">
                Send resolution email notification to client
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleResolveQuery}
              disabled={processing || !resolveNote.trim()}
              className="bg-green-600 hover:bg-green-700"
            >
              {processing ? 'Resolving...' : 'Resolve Query'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function QueryResolverPage() {
  return (
    <AdminAuthProvider>
      <AdminLayout title="Queries Management">
        <QueryResolverContent />
      </AdminLayout>
    </AdminAuthProvider>
  );
}