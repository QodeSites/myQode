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
  Calendar,
  Filter,
  Download,
  Eye,
  Edit,
  Send,
  FileText,
  TrendingUp,
  XCircle,
  UserCog,
  MoreVertical,
  History,
  Plus,
  X as CloseIcon,
  MessageCircle,
  AlertCircle,
  ArrowRight
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

interface QueryThread {
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
  thread_id: string;
  total_messages: number;
  last_message_at: string;
  has_unread: boolean;
  client_name?: string;
}

interface QueryMessage {
  id: string;
  type: string;
  nuvama_code: string;
  subject: string;
  status: string;
  data: any;
  email_sent: boolean;
  created_at: string;
  parent_inquiry_id: string | null;
  is_client_message: boolean;
  last_updated_by: string | null;
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
  totalThreads: number;
  pendingThreads: number;
  resolvedThreads: number;
  todayThreads: number;
  thisWeekThreads: number;
  highPriorityThreads: number;
  threadsByType: Record<string, number>;
  avgResolutionTime: string;
  totalMessages: number;
  unreadAdminMessages: number;
}

interface EmailData {
  to: string;
  cc: string[];
  subject: string;
  message: string;
}

function QueryResolverContent() {
  const [threads, setThreads] = useState<QueryThread[]>([]);
  const [filteredThreads, setFilteredThreads] = useState<QueryThread[]>([]);
  const [threadMessages, setThreadMessages] = useState<QueryMessage[]>([]);
  const [statistics, setStatistics] = useState<QueryStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [selectedThread, setSelectedThread] = useState<QueryThread | null>(null);
  const [queryNotes, setQueryNotes] = useState<QueryNote[]>([]);
  const [showThreadDialog, setShowThreadDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [showReplyDialog, setShowReplyDialog] = useState(false);
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
    fetchThreadsData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [threads, searchTerm, statusFilter, typeFilter, priorityFilter]);

  const fetchThreadsData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/queries');
      const data = await response.json();

      if (data.success) {
        setThreads(data.data.threads);
        setStatistics(data.data.statistics);
      } else {
        setMessage('Failed to load threads data');
      }
    } catch (error) {
      console.error('Failed to fetch threads:', error);
      setMessage('Failed to load threads data');
    } finally {
      setLoading(false);
    }
  };

  const fetchThreadConversation = async (threadId: string) => {
    try {
      const response = await fetch(`/api/admin/queries?action=getThread&threadId=${threadId}`);
      const data = await response.json();
      if (data.success) {
        setThreadMessages(data.data.messages);
      }
    } catch (error) {
      console.error('Failed to fetch thread conversation:', error);
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
    let filtered = [...threads];

    if (searchTerm) {
      filtered = filtered.filter(t =>
        t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.nuvama_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.user_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.client_name && t.client_name.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(t => t.status === statusFilter);
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(t => t.type === typeFilter);
    }

    if (priorityFilter !== 'all') {
      filtered = filtered.filter(t => t.priority === priorityFilter);
    }

    setFilteredThreads(filtered);
  };

  const handleThreadClick = async (thread: QueryThread) => {
    setSelectedThread(thread);
    await fetchThreadConversation(thread.thread_id);
    await fetchQueryNotes(thread.id);
    setShowThreadDialog(true);
  };

  const handleSendReply = async () => {
    if (!selectedThread || !emailData.to || !emailData.subject || !emailData.message) {
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
          threadId: selectedThread.thread_id,
          emailData: {
            to: emailData.to,
            cc: emailData.cc.length > 0 ? emailData.cc : undefined,
            subject: emailData.subject,
            message: emailData.message,
          },
        }),
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        throw new Error('Server returned an error. Please check the console for details.');
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      setMessage('Reply sent successfully');
      setShowReplyDialog(false);
      setEmailData({ to: '', cc: [], subject: '', message: '' });
      
      // Refresh thread conversation
      await fetchThreadConversation(selectedThread.thread_id);
      await fetchQueryNotes(selectedThread.id);
      fetchThreadsData();
    } catch (error) {
      console.error('Send reply error:', error);
      setMessage(error instanceof Error ? error.message : 'Failed to send reply');
    } finally {
      setProcessing(false);
    }
  };

  const handleResolveThread = async () => {
    if (!selectedThread || !resolveNote.trim()) {
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
          threadId: selectedThread.thread_id,
          note: resolveNote,
          sendEmail: sendEmailOnResolve,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Thread resolved successfully');
        setShowResolveDialog(false);
        setResolveNote('');
        setShowThreadDialog(false);
        fetchThreadsData();
      } else {
        setMessage(`Failed to resolve thread: ${data.error}`);
      }
    } catch (error) {
      console.error('Resolve error:', error);
      setMessage('Failed to resolve thread');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedThread || !newNote.trim()) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addNote',
          queryId: selectedThread.id,
          note: newNote,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setNewNote('');
        fetchQueryNotes(selectedThread.id);
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

  const handleUpdatePriority = async (threadId: string, priority: string) => {
    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePriority',
          threadId,
          priority,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Priority updated for entire thread');
        fetchThreadsData();
        if (selectedThread?.thread_id === threadId) {
          fetchQueryNotes(selectedThread.id);
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

  const handleReopenThread = async (threadId: string) => {
    setProcessing(true);
    try {
      const response = await fetch('/api/admin/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reopen',
          threadId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage('Thread reopened successfully');
        fetchThreadsData();
      } else {
        setMessage('Failed to reopen thread');
      }
    } catch (error) {
      console.error('Reopen error:', error);
      setMessage('Failed to reopen thread');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddCc = () => {
  console.log('🔵 Attempting to add CC:', ccInput);
  
  if (ccInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccInput.trim())) {
    const newCc = [...emailData.cc, ccInput.trim()];
    setEmailData(prev => ({
      ...prev,
      cc: newCc
    }));
    setCcInput('');
    console.log('✅ CC added successfully. New CC list:', newCc);
  } else {
    console.log('❌ Invalid email format');
    setMessage('Please enter a valid email address');
  }
};

  const handleRemoveCc = (email: string) => {
    setEmailData(prev => ({
      ...prev,
      cc: prev.cc.filter(e => e !== email)
    }));
  };

  const openReplyDialog = (thread: QueryThread) => {
    setSelectedThread(thread);
    setEmailData({
      to: thread.user_email,
      cc: [],
      subject: `Re: ${thread.subject}`,
      message: `Dear Client,\n\nRegarding your query: "${thread.subject}"\n\n`,
    });
    setShowReplyDialog(true);
  };

  const exportToCSV = () => {
    const csvContent = [
      ['Thread ID', 'Type', 'Client Code', 'Client Name', 'Email', 'Subject', 'Status', 'Priority', 'Messages', 'Created', 'Last Message', 'Resolved'].join(','),
      ...filteredThreads.map(t => [
        t.thread_id,
        t.type,
        t.nuvama_code,
        `"${t.client_name || 'Unknown'}"`,
        t.user_email,
        `"${t.subject}"`,
        t.status,
        t.priority,
        t.total_messages,
        new Date(t.created_at).toLocaleDateString(),
        new Date(t.last_message_at).toLocaleDateString(),
        t.resolved_at ? new Date(t.resolved_at).toLocaleDateString() : 'N/A'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `query-threads-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setMessage(`Exported ${filteredThreads.length} threads to CSV`);
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
      'raised_request': 'bg-teal-100 text-teal-800',
      'new_strategy_payment_success': 'bg-indigo-100 text-indigo-800',
      'payment_success': 'bg-emerald-100 text-emerald-800',
      'sip_success': 'bg-cyan-100 text-cyan-800',
      'admin_response': 'bg-slate-100 text-slate-800',
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
    const types = new Set(threads.map(t => t.type));
    return Array.from(types);
  }, [threads]);

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
          <h2 className="text-2xl font-bold">Query Threads Dashboard</h2>
          <p className="text-muted-foreground mt-2">
            Track complete conversation threads with clients
          </p>
        </div>
        <div className="flex space-x-2">
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={fetchThreadsData} variant="outline">
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
            title="Total Threads"
            value={statistics.totalThreads}
            subtitle={`${statistics.totalMessages} messages`}
            color="text-blue-500"
          />
          <StatCard
            icon={Clock}
            title="Pending"
            value={statistics.pendingThreads}
            subtitle={`${statistics.highPriorityThreads} high priority`}
            color="text-orange-500"
          />
          <StatCard
            icon={CheckCircle}
            title="Resolved"
            value={statistics.resolvedThreads}
            subtitle={`Avg: ${statistics.avgResolutionTime}`}
            color="text-green-500"
          />
          <StatCard
            icon={AlertCircle}
            title="Needs Response"
            value={statistics.unreadAdminMessages}
            subtitle="Unread client messages"
            color="text-red-500"
          />
          <StatCard
            icon={TrendingUp}
            title="Today"
            value={statistics.todayThreads}
            subtitle={`${statistics.thisWeekThreads} this week`}
            color="text-purple-500"
          />
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Filter className="h-5 w-5" />
            <span>Thread Filters</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center space-x-2 flex-1 min-w-64">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search threads, clients, subjects..."
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

      {/* Threads Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Conversation Threads ({filteredThreads.length})</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thread Info</TableHead>
                  <TableHead>Client & Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredThreads.map((thread) => (
                  <TableRow 
                    key={thread.thread_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleThreadClick(thread)}
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <MessageCircle className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="outline" className="text-xs">
                            {thread.total_messages} {thread.total_messages === 1 ? 'message' : 'messages'}
                          </Badge>
                          {thread.has_unread && (
                            <Badge className="bg-red-100 text-red-800 text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              New
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {thread.thread_id.substring(0, 8)}...
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium text-sm">{thread.nuvama_code}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{thread.client_name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{thread.user_email}</div>
                        {getQueryTypeBadge(thread.type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-md">
                        <div className="font-medium text-sm line-clamp-2">{thread.subject}</div>
                        {thread.assigned_to && (
                          <div className="text-xs text-muted-foreground mt-1">
                            <UserCog className="h-3 w-3 inline mr-1" />
                            {thread.assigned_to}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(thread.status)}
                      {thread.resolved_at && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(thread.resolved_at).toLocaleDateString()}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getPriorityBadge(thread.priority)}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="text-xs text-muted-foreground">Created:</div>
                        <div>{new Date(thread.created_at).toLocaleDateString()}</div>
                        <div className="text-xs text-muted-foreground mt-1">Last message:</div>
                        <div>{new Date(thread.last_message_at).toLocaleDateString()}</div>
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
                          <DropdownMenuItem onClick={() => openReplyDialog(thread)}>
                            <Mail className="h-4 w-4 mr-2" />
                            Send Reply
                          </DropdownMenuItem>
                          {thread.status === 'pending' && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedThread(thread);
                                  setShowResolveDialog(true);
                                }}
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Resolve Thread
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>Change Priority</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleUpdatePriority(thread.thread_id, 'high')}>
                                High Priority
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdatePriority(thread.thread_id, 'medium')}>
                                Medium Priority
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdatePriority(thread.thread_id, 'low')}>
                                Low Priority
                              </DropdownMenuItem>
                            </>
                          )}
                          {thread.status === 'resolved' && (
                            <DropdownMenuItem onClick={() => handleReopenThread(thread.thread_id)}>
                              <XCircle className="h-4 w-4 mr-2" />
                              Reopen Thread
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredThreads.length === 0 && (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No threads found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or search criteria.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thread Conversation Dialog */}
      <Dialog open={showThreadDialog} onOpenChange={setShowThreadDialog}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MessageCircle className="h-5 w-5 text-blue-500" />
                <span>Conversation Thread</span>
                <Badge variant="outline">{threadMessages.length} messages</Badge>
              </div>
              {selectedThread && getStatusBadge(selectedThread.status)}
            </DialogTitle>
            <DialogDescription>
              Complete conversation history with {selectedThread?.client_name || 'client'}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="conversation" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="conversation">Conversation</TabsTrigger>
              <TabsTrigger value="notes">Internal Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="conversation" className="flex-1 overflow-auto mt-4">
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {threadMessages.map((msg, idx) => (
                    <Card key={msg.id} className={`${msg.is_client_message ? 'border-l-4 border-l-blue-500' : 'border-l-4 border-l-green-500 bg-muted/30'}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            {msg.is_client_message ? (
                              <User className="h-4 w-4 text-blue-500" />
                            ) : (
                              <UserCog className="h-4 w-4 text-green-500" />
                            )}
                            <span className="font-medium text-sm">
                              {msg.is_client_message ? `Client (${msg.nuvama_code})` : `Admin Response${msg.last_updated_by ? ` by ${msg.last_updated_by}` : ''}`}
                            </span>
                            {getQueryTypeBadge(msg.type)}
                            {idx === threadMessages.length - 1 && (
                              <Badge variant="outline" className="text-xs">Latest</Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(msg.created_at).toLocaleString()}
                          </span>
                        </div>
                        
                        <div className="space-y-2">
                          <div>
                            <span className="font-medium text-sm">Subject: </span>
                            <span className="text-sm">{msg.subject}</span>
                          </div>
                          
                          {msg.data && typeof msg.data === 'object' && (
                            <div className="bg-muted/50 p-3 rounded text-sm">
                              {msg.data.message ? (
                                <div className="whitespace-pre-wrap">{msg.data.message}</div>
                              ) : (
                                <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(msg.data, null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                          
                          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                            {msg.email_sent && (
                              <Badge variant="outline" className="text-xs">
                                <Mail className="h-3 w-3 mr-1" />
                                Email Sent
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
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

                <ScrollArea className="h-[350px]">
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
            {selectedThread?.status === 'pending' && (
              <>
                <Button variant="outline" onClick={() => openReplyDialog(selectedThread)}>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Reply
                </Button>
                <Button 
                  onClick={() => setShowResolveDialog(true)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Resolve Thread
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setShowThreadDialog(false)}>
              Close
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
              <span>Reply to Thread</span>
            </DialogTitle>
            <DialogDescription>
              Send a response that will be added to this conversation thread
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-auto pr-2">
            <div className="bg-muted p-3 rounded text-sm">
              <p><strong>Thread:</strong> {selectedThread?.subject}</p>
              <p><strong>Client:</strong> {selectedThread?.nuvama_code} - {selectedThread?.client_name}</p>
              <p><strong>Messages:</strong> {selectedThread?.total_messages}</p>
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

      {/* Resolve Thread Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span>Resolve Conversation Thread</span>
            </DialogTitle>
            <DialogDescription>
              Mark this entire conversation as resolved. All messages in this thread will be closed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-muted p-3 rounded text-sm">
              <p><strong>Thread:</strong> {selectedThread?.subject}</p>
              <p><strong>Client:</strong> {selectedThread?.nuvama_code}</p>
              <p><strong>Total Messages:</strong> {selectedThread?.total_messages}</p>
            </div>

            <div className="space-y-2">
              <Label>Resolution Notes *</Label>
              <Textarea
                placeholder="Describe how this thread was resolved..."
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
              onClick={handleResolveThread}
              disabled={processing || !resolveNote.trim()}
              className="bg-green-600 hover:bg-green-700"
            >
              {processing ? 'Resolving...' : 'Resolve Thread'}
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
      <AdminLayout title="Query Threads Dashboard">
        <QueryResolverContent />
      </AdminLayout>
    </AdminAuthProvider>
  );
}