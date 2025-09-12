"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useClient } from "@/contexts/ClientContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Edit3, Trash2, Filter } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// Assuming these are defined in the parent component
type FamAcc = {
  relation: string;
  holderName: string;
  clientcode: string;
  clientid: string;
  status: "Active" | "Pending KYC" | "Dormant";
};

// Skeleton Loader Component
const FamilyAccountSkeleton = () => (
  <div className="rounded-lg border p-4 mb-3 animate-pulse">
    <div className="flex items-start justify-between gap-2">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-32" />
      </div>
      <Skeleton className="h-6 w-24" />
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-24" />
    </div>
  </div>
);

// Family Accounts Section
export default function FamilyAccountsSection() {
  const { clients, selectedClientCode, setSelectedClient, loading } = useClient();
  const [isPending, startTransition] = useTransition();
  const [familyAccounts, setFamilyAccounts] = useState<FamAcc[]>([
    { relation: "Father", holderName: "Mr. Nahar", clientcode: "QAW00087", clientid: "CL-100087", status: "Pending KYC" },
    { relation: "Mother", holderName: "Mrs. Nahar", clientcode: "QAW00092", clientid: "CL-100092", status: "Dormant" },
  ]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Pending KYC" | "Dormant">("All");
  const [openEdit, setOpenEdit] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<FamAcc>>({});

  // Fetch family accounts (from parent component)
  useEffect(() => {
    const fetchFamilyAccounts = async () => {
      try {
        const res = await fetch('/api/auth/client-data');
        const data = await res.json();
        if (data.success && data.family) {
          setFamilyAccounts(data.family);
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
        acc.holderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        acc.clientcode.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "All" || acc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [familyAccounts, searchTerm, statusFilter]);

  // Edit dialog handlers
  const openEditFor = (idx: number) => {
    setEditIndex(idx);
    setEditForm(familyAccounts[idx]);
    setOpenEdit(true);
  };

  const saveEdit = () => {
    if (editIndex === null) return;
    setFamilyAccounts((prev) => {
      const next = [...prev];
      next[editIndex] = { ...(next[editIndex] as FamAcc), ...(editForm as FamAcc) };
      return next;
    });
    setOpenEdit(false);
  };

  // Delete account (mock)
  const deleteAccount = (idx: number) => {
    setFamilyAccounts((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <section className="space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-foreground">Family Accounts</h2>
        <div className="flex gap-2">
          <Input
            placeholder="Search by name or client code"
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

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              <FamilyAccountSkeleton />
              <FamilyAccountSkeleton />
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No family accounts found. Try linking a new account.
            </div>
          ) : (
            <>
              {/* Mobile: Cards */}
              <div className="md:hidden space-y-3">
                {filteredAccounts.map((acc, idx) => (
                  <div
                    key={`${acc.clientid}-${idx}`}
                    className="rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          {acc.holderName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-muted-foreground">{acc.relation}</div>
                          <div className="font-medium truncate">{acc.holderName}</div>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          acc.status === "Active"
                            ? "bg-green-100 text-green-800"
                            : acc.status === "Pending KYC"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }
                      >
                        {acc.status}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Client Code</div>
                        <div className="truncate">{acc.clientcode}</div>
                      </div>
                      <div className="min-w-0 text-right">
                        <div className="text-xs text-muted-foreground">Client ID</div>
                        <div className="truncate">{acc.clientid}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditFor(idx)}
                        aria-label={`Edit ${acc.holderName}`}
                      >
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteAccount(idx)}
                        aria-label={`Delete ${acc.holderName}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: Table */}
              <div className="hidden md:block w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px]">Relationship</TableHead>
                      <TableHead className="min-w-[200px]">Holder Name</TableHead>
                      <TableHead className="min-w-[160px]">Client Code</TableHead>
                      <TableHead className="min-w-[160px]">Client ID</TableHead>
                      <TableHead className="min-w-[140px]">Status</TableHead>
                      {/* <TableHead className="w-[100px] text-right">Actions</TableHead> */}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAccounts.map((acc, idx) => (
                      <TableRow
                        key={`${acc.clientid}-${idx}`}
                        className="hover:bg-muted/50 transition-colors"
                      >
                        <TableCell className="whitespace-nowrap">{acc.relation}</TableCell>
                        <TableCell className="font-medium">{acc.holderName}</TableCell>
                        <TableCell className="whitespace-nowrap">{acc.clientcode}</TableCell>
                        <TableCell className="whitespace-nowrap">{acc.clientid}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              acc.status === "Active"
                                ? "bg-green-100 text-green-800"
                                : acc.status === "Pending KYC"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-800"
                            }
                          >
                            {acc.status}
                          </Badge>
                        </TableCell>
                        {/* <TableCell className="text-right flex gap-2 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditFor(idx)}
                            aria-label={`Edit ${acc.holderName}`}
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteAccount(idx)}
                            aria-label={`Delete ${acc.holderName}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </TableCell> */}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit Family Account Dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="w-[92vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Family Account</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="edit-relation" className="text-sm font-medium">
                  Relationship
                </label>
                <Input
                  id="edit-relation"
                  value={editForm.relation ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, relation: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="edit-holder" className="text-sm font-medium">
                  Holder Name
                </label>
                <Input
                  id="edit-holder"
                  value={editForm.holderName ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, holderName: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="edit-code" className="text-sm font-medium">
                  Client Code
                </label>
                <Input
                  id="edit-code"
                  value={editForm.clientcode ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, clientcode: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="edit-id" className="text-sm font-medium">
                  Client ID
                </label>
                <Input
                  id="edit-id"
                  value={editForm.clientid ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, clientid: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex flex-wrap gap-2">
                {(["Active", "Pending KYC", "Dormant"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={editForm.status === s ? "default" : "secondary"}
                    className={editForm.status === s ? "bg-primary" : ""}
                    onClick={() => setEditForm((f) => ({ ...f, status: s }))}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setOpenEdit(false)}>
              Cancel
            </Button>
            <Button className="bg-primary" onClick={saveEdit}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}