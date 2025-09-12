"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useClient } from "@/contexts/ClientContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

// Updated type to include all required columns from pms_clients_master
type FamAcc = {
  relation: string;
  holderName: string;
  clientcode: string;
  clientid: string;
  status: "Active" | "Pending KYC" | "Dormant";
  groupid?: string;
  groupname?: string;
  groupemailid?: string;
  ownerid?: string;
  ownername?: string;
  owneremailid?: string;
  accountname?: string;
  accountid?: string;
  email?: string;
  mobile?: string;
  address1?: string;
  city?: string;
  state?: string;
  pannumber?: string;
};

// Skeleton Loader Component
const FamilyTreeSkeleton = () => (
  <div className="space-y-4">
    <Card className="animate-pulse">
      <CardContent className="pt-6">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="pl-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="pl-6">
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
);

// Family Accounts Section
export default function FamilyAccountsSection() {
  const { clients, selectedClientCode, setSelectedClient, loading } = useClient();
  const [isPending, startTransition] = useTransition();
  const [familyAccounts, setFamilyAccounts] = useState<FamAcc[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Pending KYC" | "Dormant">("All");

  // Collapse state management
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedOwners, setCollapsedOwners] = useState<Set<string>>(new Set());
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set());

  // Fetch family accounts from API
  useEffect(() => {
    const fetchFamilyAccounts = async () => {
      try {
        const res = await fetch('/api/auth/client-data');
        const data = await res.json();
        if (data.success && data.family) {
          // Map API response to FamAcc type
          const mappedAccounts: FamAcc[] = data.family.map((member: any) => ({
            clientid: member.clientid,
            clientcode: member.clientcode,
            holderName: member.holderName,
            relation: member.relation,
            status: member.status,
            groupid: member.groupid,
            groupname: member.groupname,
            groupemailid: member.groupemailid, // Head of family email
            ownerid: member.ownerid,
            ownername: member.ownername,
            owneremailid: member.email, // Individual member email
            accountname: member.accountname,
            accountid: member.clientcode, // Using clientcode as account ID
            email: member.email,
            mobile: member.mobile,
            address1: member.address1,
            city: member.city,
            state: member.state,
            pannumber: member.pannumber,
          }));
          setFamilyAccounts(mappedAccounts);
        } else {
          console.error('No family data found:', data);
        }
      } catch (err) {
        console.error('Failed to fetch family data:', err);
      }
    };
    fetchFamilyAccounts();
  }, []);

  // Filter and search accounts
  const filteredAccounts = useMemo(() => {
    return familyAccounts.filter((acc) => {
      const matchesSearch =
        (acc.holderName?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
        (acc.clientcode?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
        (acc.groupname?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
        (acc.ownername?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
        (acc.email?.toLowerCase().includes(searchTerm.toLowerCase()) || false);
      const matchesStatus = statusFilter === "All" || acc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [familyAccounts, searchTerm, statusFilter]);

  // Group accounts by group, then by owner ID
  const groupedAccounts = useMemo(() => {
    const groups = filteredAccounts.reduce((acc, member) => {
      const groupKey = member.groupname || 'Unknown Group';

      if (!acc[groupKey]) {
        acc[groupKey] = {
          groupName: member.groupname,
          groupId: member.groupid,
          groupEmail: member.groupemailid,
          owners: {}
        };
      }

      const ownerKey = member.ownerid || 'Unknown Owner';
      if (!acc[groupKey].owners[ownerKey]) {
        acc[groupKey].owners[ownerKey] = {
          ownerId: member.ownerid,
          ownerName: member.ownername,
          ownerEmail: member.owneremailid,
          accounts: []
        };
      }

      acc[groupKey].owners[ownerKey].accounts.push(member);
      return acc;
    }, {} as Record<string, {
      groupName?: string;
      groupId?: string;
      groupEmail?: string;
      owners: Record<string, {
        ownerId?: string;
        ownerName?: string;
        ownerEmail?: string;
        accounts: FamAcc[];
      }>
    }>);

    // Sort accounts within each owner (Primary first, then alphabetically by name)
    Object.values(groups).forEach(group => {
      Object.values(group.owners).forEach(owner => {
        owner.accounts.sort((a, b) => {
          if (a.relation === 'Primary') return -1;
          if (b.relation === 'Primary') return 1;
          return a.holderName.localeCompare(b.holderName);
        });
      });
    });

    return groups;
  }, [filteredAccounts]);

  // Sort groups alphabetically by group name
  const sortedGroupEntries = useMemo(() => {
    return Object.entries(groupedAccounts).sort(([a], [b]) => a.localeCompare(b));
  }, [groupedAccounts]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active":
        return "bg-green-100 text-green-800";
      case "Pending KYC":
        return "bg-yellow-100 text-yellow-800";
      case "Dormant":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const toggleOwnerCollapse = (ownerKey: string) => {
    setCollapsedOwners(prev => {
      const next = new Set(prev);
      if (next.has(ownerKey)) {
        next.delete(ownerKey);
      } else {
        next.add(ownerKey);
      }
      return next;
    });
  };

  const toggleAccountCollapse = (accountKey: string) => {
    setCollapsedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(accountKey)) {
        next.delete(accountKey);
      } else {
        next.add(accountKey);
      }
      return next;
    });
  };

  return (
    <section className="space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-foreground">Account Tree</h2>
        <p>If you hold multiple accounts with Qode, you will be able to see how each account has been mapped by us under your family structure.
          This helps ensure that all your holdings and reports are consolidated in one place for a complete view of your investments.
          Even if you hold a single account with Qode, the account will still be displayed in the same family mapping format in our backend systems.</p>
        <div className="flex gap-2">
          <Input
            placeholder="Search family members..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Statuses</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Pending KYC">Pending KYC</SelectItem>
              <SelectItem value="Dormant">Dormant</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <FamilyTreeSkeleton />
      ) : sortedGroupEntries.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <div className="text-muted-foreground">No family members found</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedGroupEntries.map(([groupKey, group]) => {
            const isGroupCollapsed = collapsedGroups.has(groupKey);
            const totalAccounts = Object.values(group.owners).reduce((sum, owner) => sum + owner.accounts.length, 0);

            return (
              <Card key={groupKey} className="overflow-hidden py-0">
                <CardContent className="pt-6">
                  {/* Group Level - Collapsible */}
                  <div
                    className="flex items-center gap-3 mb-4 cursor-pointer hover:bg-muted/50 rounded p-2 -m-2"
                    onClick={() => toggleGroupCollapse(groupKey)}
                  >
                    {isGroupCollapsed ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                    <div className="flex-1">
                      <div className="font-semibold text-lg">{group.groupName || 'Family Group'}</div>
                      <div className="text-sm text-muted-foreground">
                        Group ID: {group.groupId} | Email: {group.groupEmail || 'N/A'}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {Object.keys(group.owners).length} owner{Object.keys(group.owners).length !== 1 ? 's' : ''} | {totalAccounts} account{totalAccounts !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Owners Structure - Collapsible */}
                  {!isGroupCollapsed && (
                    <div className="ml-6">
                      {Object.entries(group.owners)
                        .sort(([, ownerA], [, ownerB]) => (ownerA.ownerName || 'Unknown').localeCompare(ownerB.ownerName || 'Unknown'))
                        .map(([ownerKey, owner], ownerIdx) => {
                          const fullOwnerKey = `${groupKey}-${ownerKey}`;
                          const isOwnerCollapsed = collapsedOwners.has(fullOwnerKey);

                          return (
                            <div key={fullOwnerKey} className="relative mb-4">
                              {/* Tree Line for Owner */}
                              <div className="absolute left-0 top-0 bottom-0 w-px bg-border"></div>
                              <div className="absolute left-0 top-6 w-4 h-px bg-border"></div>

                              {/* Owner Level - Collapsible */}
                              <div className="ml-6">
                                <div
                                  className="flex items-center gap-3 mb-2 cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
                                  onClick={() => toggleOwnerCollapse(fullOwnerKey)}
                                >
                                  {isOwnerCollapsed ? (
                                    <ChevronRight className="h-3 w-3" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3" />
                                  )}
                                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                                  <div className="flex-1">
                                    <div className="font-medium">{owner.ownerName || 'Unknown Owner'}</div>
                                    <div className="text-sm text-muted-foreground">
                                      Owner ID: {owner.ownerId} | Email: {owner.ownerEmail || 'N/A'}
                                    </div>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {owner.accounts.length} account{owner.accounts.length !== 1 ? 's' : ''}
                                  </div>
                                </div>

                                {/* Accounts Level - Collapsible */}
                                {!isOwnerCollapsed && (
                                  <div className="ml-6">
                                    {owner.accounts.map((account, accountIdx) => {
                                      const accountKey = `${fullOwnerKey}-${account.clientid}`;
                                      const isAccountCollapsed = collapsedAccounts.has(accountKey);

                                      return (
                                        <div key={`${account.clientid}-${accountIdx}`} className="relative mb-3">
                                          {/* Tree Line for Account */}
                                          <div className="absolute left-0 top-0 bottom-0 w-px bg-border opacity-50"></div>
                                          <div className="absolute left-0 top-6 w-3 h-px bg-border opacity-50"></div>

                                          {/* Account Level - Collapsible */}
                                          <div className="ml-4">
                                            <div
                                              className="flex items-center gap-3 mb-2 cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
                                              onClick={() => toggleAccountCollapse(accountKey)}
                                            >
                                              {isAccountCollapsed ? (
                                                <ChevronRight className="h-2 w-2" />
                                              ) : (
                                                <ChevronDown className="h-2 w-2" />
                                              )}
                                              <div className={`h-1.5 w-1.5 rounded-full ${account.relation === 'Primary' ? 'bg-orange-500' : 'bg-gray-400'}`}></div>
                                              <div className="flex-1">
                                                <div className="font-medium text-sm">{account.holderName}</div>
                                                <div className="text-xs text-muted-foreground">
                                                  Account ID: {account.accountid} | {account.relation}
                                                </div>
                                              </div>
                                              <Badge variant="outline" className={`text-xs ${getStatusColor(account.status)}`}>
                                                {account.status}
                                              </Badge>
                                            </div>

                                            {/* Account Details - Collapsible */}
                                            {!isAccountCollapsed && (
                                              <div className="ml-4 p-2 bg-muted/20 rounded text-xs border-l-2 border-primary/10">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                  <div>
                                                    <div className="text-muted-foreground">Client ID</div>
                                                    <div className="font-medium">{account.clientid}</div>
                                                  </div>
                                                  <div>
                                                    <div className="text-muted-foreground">Email</div>
                                                    <div className="font-medium truncate">{account.email || 'N/A'}</div>
                                                  </div>
                                                  {account.mobile && (
                                                    <div>
                                                      <div className="text-muted-foreground">Mobile</div>
                                                      <div className="font-medium">{account.mobile}</div>
                                                    </div>
                                                  )}
                                                  {account.pannumber && (
                                                    <div>
                                                      <div className="text-muted-foreground">PAN</div>
                                                      <div className="font-medium">{account.pannumber}</div>
                                                    </div>
                                                  )}
                                                  {(account.city || account.state) && (
                                                    <div className="md:col-span-2">
                                                      <div className="text-muted-foreground">Location</div>
                                                      <div className="font-medium">{[account.city, account.state].filter(Boolean).join(', ')}</div>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Information text below the family tree */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-sm text-amber-800 leading-relaxed mb-3">
          If your family structure has changed or if you would like to update how your accounts are grouped, you can:
        </p>
        <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside ml-2">
          <li>Request to merge multiple accounts under one family head.</li>
          <li>Request to reassign accounts to a different owner within the same family.</li>
          <li>Request to split accounts into a new family group.</li>
          <li>Update or change your contact email ID for reporting and login purposes.</li>
        </ul>
      </div>
    </section>
  );
}