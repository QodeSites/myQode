"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useClient } from "@/contexts/ClientContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Crown, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ModalShell";
import { useToast } from "@/hooks/use-toast";

/* =========================
   Types
   ========================= */
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
  head_of_family?: boolean;
};

/* =========================
   Helper: sendEmail
   ========================= */
async function sendEmail(payload: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  inquiry_type?: string;
  nuvama_code?: string;
  client_id?: string;
  user_email?: string;
  message?: string;
}) {
  const res = await fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      inquiry_type: payload.inquiry_type || "family_mapping",
      nuvama_code: payload.nuvama_code,
      client_id: payload.client_id,
      user_email: payload.user_email,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Email API error");
  }
  return res.json().catch(() => ({}));
}

/* =========================
   Skeleton
   ========================= */
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

/* =========================
   Component
   ========================= */
export default function FamilyAccountsSection() {
  const { clients, selectedClientCode, setSelectedClient, loading } = useClient();
  const [isPending] = useTransition();
  const { toast } = useToast();

  const [familyAccounts, setFamilyAccounts] = useState<FamAcc[]>([]);
  const [isHeadOfFamily, setIsHeadOfFamily] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Pending KYC" | "Dormant">("All");

  // Modal + submit states
  const [modalOpen, setModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Collapse state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedOwners, setCollapsedOwners] = useState<Set<string>>(new Set());
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set());

  const onClose = () => setModalOpen(false);

  /* =========================
     Fetch family data with role-based logic
     ========================= */
  useEffect(() => {
    const fetchFamilyAccounts = async () => {
      try {
        const res = await fetch("/api/auth/client-data");
        const data = await res.json();
        if (data.success && data.family) {
          const mapped: FamAcc[] = data.family.map((member: any) => ({
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
            accountname: member.accountname,
            accountid: member.clientcode,
            email: member.email,
            mobile: member.mobile,
            address1: member.address1,
            city: member.city,
            state: member.state,
            pannumber: member.pannumber,
            head_of_family: member.head_of_family,
          }));
          setFamilyAccounts(mapped);
          setIsHeadOfFamily(data.isHeadOfFamily || false);
        } else {
          console.error("No family data found:", data);
        }
      } catch (err) {
        console.error("Failed to fetch family data:", err);
      }
    };
    fetchFamilyAccounts();
  }, []);

  /* =========================
     Derived: selection & email fallbacks
     ========================= */
  const selectedClient = useMemo(
    () => clients.find(c => c.clientcode === selectedClientCode),
    [clients, selectedClientCode]
  );
  const selectedClientId = selectedClient?.clientid ?? "";

  // Try to find a sensible user email to CC/From (fallback to group/owner/account email)
  const fallbackEmail = useMemo(() => {
    const forSelected = familyAccounts.find(f => f.clientcode === selectedClientCode);
    return (
      forSelected?.email ||
      forSelected?.owneremailid ||
      forSelected?.groupemailid ||
      "investor.relations@qodeinvest.com"
    );
  }, [familyAccounts, selectedClientCode]);

  /* =========================
     Search/Filter/Group
     ========================= */
  const filteredAccounts = useMemo(() => {
    return familyAccounts.filter(acc => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        acc.holderName?.toLowerCase().includes(q) ||
        acc.clientcode?.toLowerCase().includes(q) ||
        acc.groupname?.toLowerCase().includes(q) ||
        acc.ownername?.toLowerCase().includes(q) ||
        acc.email?.toLowerCase().includes(q) ||
        false;
      const matchesStatus = statusFilter === "All" || acc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [familyAccounts, searchTerm, statusFilter]);

  const groupedAccounts = useMemo(() => {
    const groups = filteredAccounts.reduce((acc, member) => {
      const groupKey = member.groupname || "Onwer Account";
      if (!acc[groupKey]) {
        acc[groupKey] = {
          groupName: member.groupname,
          groupId: member.groupid,
          groupEmail: member.groupemailid,
          owners: {} as Record<
            string,
            { ownerId?: string; ownerName?: string; ownerEmail?: string; accounts: FamAcc[] }
          >,
        };
      }
      const ownerKey = member.ownerid || member.clientid || "Owner";
      if (!acc[groupKey].owners[ownerKey]) {
        acc[groupKey].owners[ownerKey] = {
          ownerId: member.ownerid || member.clientid,
          ownerName: member.ownername || member.holderName,
          ownerEmail: member.owneremailid,
          accounts: [],
        };
      }
      acc[groupKey].owners[ownerKey].accounts.push(member);
      return acc;
    }, {} as Record<
      string,
      {
        groupName?: string;
        groupId?: string;
        groupEmail?: string;
        owners: Record<string, { ownerId?: string; ownerName?: string; ownerEmail?: string; accounts: FamAcc[] }>;
      }
    >);

    Object.values(groups).forEach(group => {
      Object.values(group.owners).forEach(owner => {
        owner.accounts.sort((a, b) => {
          if (a.relation === "Primary") return -1;
          if (b.relation === "Primary") return 1;
          if (a.head_of_family) return -1;
          if (b.head_of_family) return 1;
          return a.holderName.localeCompare(b.holderName);
        });
      });
    });

    return groups;
  }, [filteredAccounts]);

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

  const toggleAccountCollapse = (k: string) =>
    setCollapsedAccounts(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  /* =========================
     Handle Submit (Modal with only textarea)
     ========================= */
  const HandleSubmitRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const message = (fd.get("message")?.toString() || "").trim();

    if (!selectedClientCode || !selectedClientId) {
      toast({
        title: "Missing account",
        description: "No account is selected. Please select an account and try again.",
        variant: "destructive",
      });
      return;
    }
    if (!message) {
      toast({ title: "Message required", description: "Please write your request.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);

    const subject = `${isHeadOfFamily ? 'Family Mapping' : 'Account'} Request — ${selectedClientCode}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:Lato,Arial,sans-serif;line-height:1.6;color:#002017;background-color:#EFECD3}
      .container{max-width:600px;margin:0 auto;padding:20px}.header{background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center}
      .content{background:#FFFFFF;padding:16px;border:1px solid #37584F;border-radius:8px}.info{background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0}
      h1{font-family:'Playfair Display',Georgia,serif;color:#DABD38;font-size:20px;margin:0}</style>
      </head><body><div class="container">
        <div class="header"><h1>${isHeadOfFamily ? 'Family Mapping' : 'Account'} Request</h1></div>
        <div class="content">
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <div class="info">
            <p><strong>User Role:</strong> ${isHeadOfFamily ? 'Head of Family' : 'Account Owners'}</p>
            <p><strong>Account Code:</strong> ${selectedClientCode}</p>
            <p><strong>Client ID:</strong> ${selectedClientId}</p>
            <p><strong>User Email:</strong> ${fallbackEmail}</p>
            <p><strong>Message:</strong></p>
            <p>${message.replace(/\n/g, "<br/>")}</p>
          </div>
        </div>
      </div></body></html>`;

    try {
      await sendEmail({
        to: 'investor.relations@qodeinvest.com',
        subject,
        html,
        from: "investor.relations@qodeinvest.com",
        fromName: "myQode Portal",
        inquiry_type: "raised_request",
        nuvama_code: selectedClientCode,
        client_id: selectedClientId,
        user_email: fallbackEmail,
        message, // Add message to the payload for storage in the data column
      });

      toast({
        title: "Request sent",
        description: "Your message has been emailed to our team. We'll get back to you soon.",
      });
      formRef.current?.reset();
      setModalOpen(false);
    } catch (err) {
      console.error("Email send error:", err);
      toast({
        title: "Failed to send",
        description: "Could not send your request. Please try again or contact us directly.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">
            {isHeadOfFamily ? "Family Account Tree" : "My Account"}
          </h2>
          {isHeadOfFamily ? (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              <Crown className="w-3 h-3 mr-1" />
              Head of Family
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
              <User className="w-3 h-3 mr-1" />
              Owners
            </Badge>
          )}
        </div>
        
        <div className="flex gap-2">
          <Input
            placeholder={isHeadOfFamily ? "Search family members..." : "Search accounts..."}
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
          <p>As the head of family, you can see how all family accounts are mapped and organized. This consolidated view helps you manage all your family's investments in one place.</p>
        ) : (
          <p>This shows your individual account details. If you're part of a family group, only the head of family can see all family accounts.</p>
        )}
      </div>

      {loading ? (
        <FamilyTreeSkeleton />
      ) : sortedGroupEntries.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-sm text-muted-foreground">No account data available.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-0 md:space-y-2">
          {sortedGroupEntries.map(([groupKey, group]) => {
            const isGroupCollapsed = collapsedGroups.has(groupKey);
            const totalAccounts = Object.values(group.owners).reduce((sum, owner) => sum + owner.accounts.length, 0);

            return (
              <Card key={groupKey} className="overflow-hidden py-0 p-0 md:p-6">
                <CardContent className="p-2 md:p-6">
                  {/* Group header */}
                  <div
                    className="flex items-center gap-3 mb-4 cursor-pointer hover:bg-muted/50 rounded p-2 -m-2"
                    onClick={() => toggleGroupCollapse(groupKey)}
                  >
                    {isGroupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <div className={`h-3 w-3 rounded-full ${isHeadOfFamily ? 'bg-blue-500' : 'bg-gray-500'}`} />
                    <div className="flex-1">
                      <div className="font-semibold text-md md:text-lg">
                        {isHeadOfFamily ? (group.groupName || "Family Group") : "Account Owner"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {isHeadOfFamily ? (
                          `Group ID: ${group.groupId} | Email: ${group.groupEmail || "N/A"}`
                        ) : (
                          `Account Email: ${group.groupEmail || "N/A"}`
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {isHeadOfFamily ? (
                        `${Object.keys(group.owners).length} owner${Object.keys(group.owners).length !== 1 ? "s" : ""} | ${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`
                      ) : (
                        `${totalAccounts} account${totalAccounts !== 1 ? "s" : ""}`
                      )}
                    </div>
                  </div>

                  {/* Owners */}
                  {!isGroupCollapsed && (
                    <div className="ml-4 md:ml-6">
                      {Object.entries(group.owners)
                        .sort(([, a], [, b]) => (a.ownerName || "Unknown").localeCompare(b.ownerName || "Unknown"))
                        .map(([ownerKey, owner]) => {
                          const fullOwnerKey = `${groupKey}-${ownerKey}`;
                          const isOwnerCollapsed = collapsedOwners.has(fullOwnerKey);

                          return (
                            <div key={fullOwnerKey} className="relative mb-4">
                              {/* Tree Line for Owner */}
                              <div className="absolute left-0 top-0 bottom-0 w-px bg-border"></div>
                              <div className="absolute left-0 top-6 w-4 h-px bg-border"></div>

                              {/* Owner Level - Collapsible */}
                              <div className="ml-4 md:ml-6">
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
                                    <div className="font-medium">{owner.ownerName || 'Account Holder'}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {isHeadOfFamily ? (
                                        `Owner ID: ${owner.ownerId} | Email: ${owner.ownerEmail || "N/A"}`
                                      ) : (
                                        `Owner ID: ${owner.ownerId} | Email: ${owner.ownerEmail || "N/A"}`
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {owner.accounts.length} account{owner.accounts.length !== 1 ? 's' : ''}
                                  </div>
                                </div>

                                {/* Accounts */}
                                {!isOwnerCollapsed && (
                                  <div className="ml-4 md:ml-6">
                                    {owner.accounts.map((account, accountIdx) => {
                                      const accountKey = `${fullOwnerKey}-${account.clientid}`;
                                      const isAccountCollapsed = collapsedAccounts.has(accountKey);

                                      return (
                                        <div key={`${account.clientid}-${accountIdx}`} className="relative mb-3">
                                          {/* Tree Line for Account */}
                                          <div className="absolute left-0 top-0 bottom-0 w-px bg-border opacity-50"></div>
                                          <div className="absolute left-0 top-6 w-3 h-px bg-border opacity-50"></div>

                                          {/* Account Level - Collapsible */}
                                          <div className="ml-2 md:ml-4">
                                            <div
                                              className="flex items-center gap-3 mb-2 cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
                                              onClick={() => toggleAccountCollapse(accountKey)}
                                            >
                                              {isAccountCollapsed ? (
                                                <ChevronRight className="h-2 w-2" />
                                              ) : (
                                                <ChevronDown className="h-2 w-2" />
                                              )}
                                              <div className={`h-1.5 w-1.5 rounded-full ${
                                                account.head_of_family ? 'bg-blue-500' : 
                                                account.relation === 'Primary' ? 'bg-orange-500' : 'bg-gray-400'
                                              }`}></div>
                                              <div className="flex-1">
                                                <div className="font-medium text-sm flex items-center gap-2">
                                                  {account.holderName}
                                                  {account.head_of_family && <Crown className="w-3 h-3 text-blue-600" />}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                  Account ID: {account.accountid} | {account.relation}
                                                </div>
                                              </div>
                                              <Badge variant="outline" className={`text-xs ${getStatusColor(account.status)}`}>
                                                {account.status}
                                              </Badge>
                                            </div>

                                            {!isAccountCollapsed && (
                                              <div className="ml-2 md:ml-4 p-2 bg-muted/20 rounded text-xs border-l-2 border-primary/10">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                  <div>
                                                    <div className="text-muted-foreground">Client ID</div>
                                                    <div className="font-medium">{account.clientid}</div>
                                                  </div>
                                                  <div>
                                                    <div className="text-muted-foreground">Email</div>
                                                    <div className="font-medium truncate">{account.email || 'N/A'}</div>
                                                  </div>
                                                  {/* {account.mobile && (
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
                                                  )} */}
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

      {/* Info section with role-specific messaging */}
      <div className="rounded-lg">
        {isHeadOfFamily ? (
          <>
            <p className="text-sm leading-relaxed mb-3">
              As the head of family, you can request changes to your family structure:
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside ml-2">
              <li>Request to merge multiple accounts under one family head.</li>
              <li>Request to reassign accounts to a different owner within the same family.</li>
              <li>Request to split accounts into a new family group.</li>
              <li>Update or change contact email ID for reporting and login purposes.</li>
            </ul>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed mb-3">
              For Owner account changes, you can request:
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside ml-2">
              <li>Update your contact email ID or personal details.</li>
              <li>Request to join a family group (if applicable).</li>
              <li>Request account status changes or updates.</li>
              <li>General account-related queries and modifications.</li>
            </ul>
          </>
        )}
      </div>

      <div>
        <Button className="bg-primary" onClick={() => setModalOpen(true)}>
          {isHeadOfFamily ? "Raise Family Request" : "Raise Account Request"}
        </Button>
      </div>

      {/* Modal: ONLY textarea + submit */}
      {modalOpen && (<ModalShell title={`Send ${isHeadOfFamily ? 'family' : 'account'} request`} onClose={onClose} size="lg" open={modalOpen}>
        <form ref={formRef} onSubmit={HandleSubmitRequest} className="space-y-4">
          <div className="text-sm text-muted-foreground">
            This message will be emailed to our team with your <b>Client Code</b> and <b>Client ID</b> attached.
            {isHeadOfFamily && <span className="text-blue-600 font-medium"> As head of family, you can request changes for all family accounts.</span>}
          </div>
          <Textarea
            name="message"
            placeholder={isHeadOfFamily ? 
              "Write your family request here (e.g., merge accounts, reassign owner, update family email)…" :
              "Write your account request here (e.g., update email, change personal details)…"
            }
            className="min-h-40"
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : `Raise ${isHeadOfFamily ? 'Family' : 'Account'} Request`}
            </Button>
          </div>
        </form>
      </ModalShell>)}
    </section>
  );
}