"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useClient } from "@/contexts/ClientContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Crown, User, TrendingUp } from "lucide-react";

/* =========================
   Types
   ========================= */
type FamAccWithPortfolio = {
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
  head_of_family?: boolean;
  // Portfolio data
  portfolioValue?: number;
  reportDate?: string;
};

type PortfolioData = {
  account_code: string;
  portfolio_value: number;
  report_date: string;
};

/* =========================
   Helper Functions
   ========================= */
const formatCurrency = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(Number(value))) return "N/A";
  const numValue = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numValue);
};

/* =========================
   Skeleton Component
   ========================= */
const FamilyPortfolioSkeleton = () => (
  <div className="space-y-4">
    <Card className="animate-pulse">
      <CardContent className="pt-6">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="pl-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="pl-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-24 mt-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
);

/* =========================
   Main Component
   ========================= */
export default function FamilyPortfolioSection() {
  const { clients, loading, isHeadOfFamily } = useClient();
  const [familyAccounts, setFamilyAccounts] = useState<FamAccWithPortfolio[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Pending KYC" | "Dormant">("All");

  // Collapse states
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedOwners, setCollapsedOwners] = useState<Set<string>>(new Set());

  /* =========================
     Fetch Family & Portfolio Data
     ========================= */
  useEffect(() => {
    const fetchFamilyAndPortfolioData = async () => {
      try {
        // First fetch family data (already role-filtered by API)
        const familyRes = await fetch("/api/auth/client-data");
        const familyData = await familyRes.json();

        if (!familyData.success || !familyData.family) {
          console.error("No family data found:", familyData);
          return;
        }

        const mappedFamily: FamAccWithPortfolio[] = familyData.family.map((member: any) => ({
          clientid: member.clientid,
          clientcode: member.clientcode,
          holderName: member.holderName,
          relation: member.relation,
          status: member.status,
          groupid: member.groupid,
          groupname: member.groupname,
          groupemailid: member.groupemailid,
          ownerid: member.ownerid,
          ownername: member.ownername,
          owneremailid: member.email,
          head_of_family: member.head_of_family,
        }));

        // Extract all nuvama codes for portfolio fetch
        const nuvamaCodes = mappedFamily
          .map(acc => acc.clientcode)
          .filter(code => code);

        setPortfolioLoading(true);

        // Fetch portfolio data for all accounts
        const portfolioRes = await fetch("/api/portfolio-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nuvama_codes: nuvamaCodes }),
        });

        const portfolioData = await portfolioRes.json();

        if (portfolioData.success && portfolioData.data) {
          // Create a map of portfolio data by account_code
          const portfolioMap = new Map<string, PortfolioData>();
          portfolioData.data.forEach((item: PortfolioData) => {
            portfolioMap.set(item.account_code, item);
          });

          // Merge portfolio data with family data
          const enrichedFamily = mappedFamily.map(account => {
            const portfolio = portfolioMap.get(account.clientcode);
            if (portfolio) {
              return {
                ...account,
                portfolioValue: portfolio.portfolio_value,
                reportDate: portfolio.report_date,
              };
            }
            return account;
          });

          setFamilyAccounts(enrichedFamily);
        } else {
          setFamilyAccounts(mappedFamily);
        }
      } catch (err) {
        console.error("Failed to fetch family/portfolio data:", err);
      } finally {
        setPortfolioLoading(false);
      }
    };

    fetchFamilyAndPortfolioData();
  }, []);

  /* =========================
     Search/Filter/Group Logic
     ========================= */
  const filteredAccounts = useMemo(() => {
    return familyAccounts.filter(acc => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        acc.holderName?.toLowerCase().includes(q) ||
        acc.clientcode?.toLowerCase().includes(q) ||
        acc.groupname?.toLowerCase().includes(q) ||
        acc.ownername?.toLowerCase().includes(q) ||
        false;
      const matchesStatus = statusFilter === "All" || acc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [familyAccounts, searchTerm, statusFilter]);

  const groupedAccounts = useMemo(() => {
    const groups = filteredAccounts.reduce((acc, member) => {
      const groupKey = isHeadOfFamily ? (member.groupname || "Family Group") : "Owner Portfolio";
      if (!acc[groupKey]) {
        acc[groupKey] = {
          groupName: member.groupname,
          groupId: member.groupid,
          groupEmail: member.groupemailid,
          totalPortfolioValue: 0,
          owners: {} as Record<
            string,
            {
              ownerId?: string;
              ownerName?: string;
              ownerEmail?: string;
              totalPortfolioValue: number;
              accounts: FamAccWithPortfolio[]
            }
          >,
        };
      }

      const ownerKey = isHeadOfFamily ? (member.ownerid || "Unknown Owner") : (member.clientid || "Individual");
      if (!acc[groupKey].owners[ownerKey]) {
        acc[groupKey].owners[ownerKey] = {
          ownerId: member.ownerid || member.clientid,
          ownerName: isHeadOfFamily ? member.ownername : member.holderName,
          ownerEmail: member.owneremailid,
          totalPortfolioValue: 0,
          accounts: [],
        };
      }

      acc[groupKey].owners[ownerKey].accounts.push(member);

      // Add to totals
      const portfolioValue = member.portfolioValue ? Number(member.portfolioValue) : 0;

      if (!isNaN(portfolioValue)) {
        acc[groupKey].totalPortfolioValue += portfolioValue;
        acc[groupKey].owners[ownerKey].totalPortfolioValue += portfolioValue;
      }

      return acc;
    }, {} as Record<
      string,
      {
        groupName?: string;
        groupId?: string;
        groupEmail?: string;
        totalPortfolioValue: number;
        owners: Record<string, {
          ownerId?: string;
          ownerName?: string;
          ownerEmail?: string;
          totalPortfolioValue: number;
          accounts: FamAccWithPortfolio[]
        }>;
      }
    >);

    // Sort accounts within each owner
    Object.values(groups).forEach(group => {
      Object.values(group.owners).forEach(owner => {
        owner.accounts.sort((a, b) => {
          if (a.head_of_family) return -1;
          if (b.head_of_family) return 1;
          if (a.relation === "Primary") return -1;
          if (b.relation === "Primary") return 1;
          return a.holderName.localeCompare(b.holderName);
        });
      });
    });

    return groups;
  }, [filteredAccounts, isHeadOfFamily]);

  const sortedGroupEntries = useMemo(
    () => Object.entries(groupedAccounts).sort(([a], [b]) => a.localeCompare(b)),
    [groupedAccounts]
  );

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

  const toggleGroupCollapse = (k: string) =>
    setCollapsedGroups(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const toggleOwnerCollapse = (k: string) =>
    setCollapsedOwners(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  if (loading || portfolioLoading) {
    return <FamilyPortfolioSkeleton />;
  }

  return (
    <section className="space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">
            {isHeadOfFamily ? "Family Portfolio Values" : "My Portfolio Values"}
          </h2>
          {isHeadOfFamily ? (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              <Crown className="w-3 h-3 mr-1" />
              Head of Family
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
              <User className="w-3 h-3 mr-1" />
              Owner Portfolio
            </Badge>
          )}
        </div>
        
        <div className="flex gap-2">
          <Input
            placeholder={isHeadOfFamily ? "Search family portfolios..." : "Search accounts..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
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

      {/* Description based on user role */}
      <div className="text-sm text-muted-foreground">
        {isHeadOfFamily ? (
          <p>As the head of family, you can view portfolio values for all family accounts. Values are updated regularly and may not reflect real-time market fluctuations.</p>
        ) : (
          <p>View your owner portfolio values. These values are updated regularly and may not reflect real-time market fluctuations.</p>
        )}
      </div>

      {sortedGroupEntries.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No portfolio data found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedGroupEntries.map(([groupKey, group]) => {
            const isGroupCollapsed = collapsedGroups.has(groupKey);
            const totalAccounts = Object.values(group.owners).reduce((sum, owner) => sum + owner.accounts.length, 0);

            return (
              <Card key={groupKey} className="overflow-hidden border-l-4 border-primary">
                <CardContent className="p-4">
                  {/* Group header with total portfolio value */}
                  <div
                    className="flex items-center gap-3 mb-4 cursor-pointer hover:bg-muted/50 rounded p-2 -m-2"
                    onClick={() => toggleGroupCollapse(groupKey)}
                  >
                    {isGroupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <div className={`h-3 w-3 rounded-full ${isHeadOfFamily ? 'bg-blue-500' : 'bg-gray-500'}`} />
                    <div className="flex-1">
                      <div className="font-semibold text-lg">
                        {isHeadOfFamily ? (group.groupName || "Family Group") : "Owner Portfolio"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {isHeadOfFamily ? (
                          `${Object.keys(group.owners).length} owner${Object.keys(group.owners).length !== 1 ? "s" : ""} | ${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`
                        ) : (
                          `${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-xl text-primary">{formatCurrency(group.totalPortfolioValue)}</div>
                      <div className="text-sm text-muted-foreground">Total Value</div>
                    </div>
                  </div>

                  {/* Owners */}
                  {!isGroupCollapsed && (
                    <div className="ml-6 space-y-3">
                      {Object.entries(group.owners)
                        .sort(([, a], [, b]) => (a.ownerName || "Unknown").localeCompare(b.ownerName || "Unknown"))
                        .map(([ownerKey, owner]) => {
                          const fullOwnerKey = `${groupKey}-${ownerKey}`;
                          const isOwnerCollapsed = collapsedOwners.has(fullOwnerKey);

                          return (
                            <div key={fullOwnerKey} className="border-l-2 border-accent pl-4">
                              {/* Owner Level */}
                              <div
                                className="flex items-center gap-3 mb-2 cursor-pointer hover:bg-muted/50 rounded p-2 -m-2"
                                onClick={() => toggleOwnerCollapse(fullOwnerKey)}
                              >
                                {isOwnerCollapsed ? (
                                  <ChevronRight className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                                <div className="flex-1">
                                  <div className="font-medium">{owner.ownerName || 'Account Holder'}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {owner.accounts.length} account{owner.accounts.length !== 1 ? 's' : ''}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-semibold text-lg">{formatCurrency(owner.totalPortfolioValue)}</div>
                                  <div className="text-xs text-muted-foreground">Owner Total</div>
                                </div>
                              </div>

                              {/* Accounts */}
                              {!isOwnerCollapsed && (
                                <div className="ml-6 space-y-2">
                                  {owner.accounts.map((account, accountIdx) => (
                                    <div key={`${account.clientid}-${accountIdx}`} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg">
                                      <div className="flex items-center gap-1">
                                        {account.head_of_family ? (
                                          <Crown className="h-3 w-3 text-blue-600" />
                                        ) : (
                                          <div className={`h-2 w-2 rounded-full ${account.relation === 'Primary' ? 'bg-orange-500' : 'bg-gray-400'}`}></div>
                                        )}
                                      </div>
                                      <div className="flex-1">
                                        <div className="font-medium flex items-center gap-2">
                                          {account.holderName}
                                          {account.head_of_family && isHeadOfFamily && (
                                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                              Head
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          {account.clientcode} | {account.relation}
                                          {account.reportDate && (
                                            <span className="ml-2">• Updated: {new Date(account.reportDate).toLocaleDateString()}</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="font-bold text-lg text-primary">{formatCurrency(account.portfolioValue)}</div>
                                        <Badge variant="outline" className={`text-xs ${getStatusColor(account.status)}`}>
                                          {account.status}
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
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

      {/* Summary Card */}
      <Card className="bg-gradient-to-r from-primary/5 to-secondary/5">
        <CardContent className="p-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-lg">
                {isHeadOfFamily ? "Total Family Portfolio" : "Total Portfolio Value"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isHeadOfFamily ? "Combined value across all family accounts" : "Combined value across all your accounts"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary">
                {formatCurrency(
                  Object.values(groupedAccounts).reduce((sum, group) => sum + group.totalPortfolioValue, 0)
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {familyAccounts.filter(acc => acc.status === "Active").length} Active Account{familyAccounts.filter(acc => acc.status === "Active").length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}