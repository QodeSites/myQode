"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useClient } from "@/contexts/ClientContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit3, Plus, Link as LinkIcon, ShieldCheck } from "lucide-react";

/**
 * Single-file page that mirrors header logic to determine the current account,
 * and also shows a Family Accounts section with dummy data + an "Edit" button,
 * and a dialog to request linking a new account.
 */
export default function Page() {
  const { clients, selectedClientCode, setSelectedClient, loading } = useClient();
  const [isPending, startTransition] = useTransition();

  // Auto-select first account if none is selected and clients are available (mirror header logic)
  useEffect(() => {
    if (!loading && clients.length > 0 && !selectedClientCode) {
      setSelectedClient(clients[0].clientcode);
    }
  }, [clients, selectedClientCode, setSelectedClient, loading]);

  // Resolve the currently selected client object
  const current = useMemo(() => {
    if (!clients?.length) return undefined;
    const code = selectedClientCode ?? clients[0]?.clientcode;
    return clients.find((c) => c.clientcode === code) ?? clients[0];
  }, [clients, selectedClientCode]);

  // --- Dummy Family Accounts ---
  type FamAcc = {
    relation: string;
    holderName: string;
    clientcode: string;
    clientid: string;
    status: "Active" | "Pending KYC" | "Dormant";
  };

  const [familyAccounts, setFamilyAccounts] = useState<FamAcc[]>([
    {
      relation: "Father",
      holderName: "Mr. Nahar",
      clientcode: "QAW00087",
      clientid: "CL-100087",
      status: "Pending KYC",
    },
    {
      relation: "Mother",
      holderName: "Mrs. Nahar",
      clientcode: "QAW00092",
      clientid: "CL-100092",
      status: "Dormant",
    },
  ]);

  // Edit dialog state (simple local-only demo edits)
  const [openEdit, setOpenEdit] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<FamAcc>>({});

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

  // Link New Account dialog state (fires a mock request)
  const [openLink, setOpenLink] = useState(false);
  const [linkForm, setLinkForm] = useState({
    holderName: "",
    relation: "",
    clientcode: "",
    clientid: "",
    notes: "",
  });
  const [linkSent, setLinkSent] = useState(false);

  const submitLinkRequest = () => {
    startTransition(async () => {
      try {
        // Replace with a real API endpoint in your app
        await fetch("/api/link-account-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(linkForm),
        });
        setLinkSent(true);
      } catch (e) {
        console.error(e);
      }
    });
  };

  return (
    <main className="container mx-auto max-w-6xl space-y-6 px-4 pb-8 pt-24">
      {/* Current Account */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">Current Account</h1>
          <div className="flex items-center gap-2">
            <Dialog open={openLink} onOpenChange={setOpenLink}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Link a new account
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Request to Link a New Account</DialogTitle>
                  <DialogDescription>
                    Submit details of the family member's account you'd like to link. Our team will verify and enable access.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="holderName">Holder Name</Label>
                    <Input
                      id="holderName"
                      value={linkForm.holderName}
                      onChange={(e) => setLinkForm((f) => ({ ...f, holderName: e.target.value }))}
                      placeholder="e.g., Mr. Nahar"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="relation">Relationship</Label>
                    <Input
                      id="relation"
                      value={linkForm.relation}
                      onChange={(e) => setLinkForm((f) => ({ ...f, relation: e.target.value }))}
                      placeholder="e.g., Father / Mother / Spouse "
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="clientcode">Client Code</Label>
                      <Input
                        id="clientcode"
                        value={linkForm.clientcode}
                        onChange={(e) => setLinkForm((f) => ({ ...f, clientcode: e.target.value }))}
                        placeholder="e.g., QAW00121"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="clientid">Client ID</Label>
                      <Input
                        id="clientid"
                        value={linkForm.clientid}
                        onChange={(e) => setLinkForm((f) => ({ ...f, clientid: e.target.value }))}
                        placeholder="e.g., CL-100121"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="notes">Notes (optional)</Label>
                    <Input
                      id="notes"
                      value={linkForm.notes}
                      onChange={(e) => setLinkForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Any additional details"
                    />
                  </div>
                </div>
                <DialogFooter>
                  {linkSent ? (
                    <Button variant="secondary" disabled>
                      <ShieldCheck className="mr-2 h-4 w-4" /> Request sent
                    </Button>
                  ) : (
                    <Button onClick={submitLinkRequest} disabled={isPending} className="bg-primary inline-flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" /> {isPending ? "Sending…" : "Send request"}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>Primary Holder</span>
              {loading ? (
                <Badge variant="outline">Loading…</Badge>
              ) : (
                <Badge variant="secondary">{current ? "Active" : "No account"}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Client Code</div>
              <div className="text-lg font-medium">
                {current?.clientcode ?? "—"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Client ID</div>
              <div className="text-lg font-medium">{current?.clientid ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Selected</div>
              <div className="text-lg font-medium">{selectedClientCode ?? current?.clientcode ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Switch Account</div>
              <div className="flex flex-wrap gap-2">
                {clients?.map((c) => (
                  <Button
                    key={c.clientid}
                    size="sm"
                    variant={selectedClientCode === c.clientcode ? "default" : "outline"}
                    className={`${selectedClientCode === c.clientcode ? "bg-primary" : "bg-secondary text-primary border-1"} other-class`}
                    onClick={() => setSelectedClient(c.clientcode)}
                  >
                    {c.clientcode}
                  </Button>
                ))}
                {!clients?.length && <span className="text-sm text-muted-foreground">No accounts found</span>}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Family Accounts */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-semibold">Family Accounts</h2>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">Relationship</TableHead>
                    <TableHead className="min-w-[180px]">Holder Name</TableHead>
                    <TableHead className="min-w-[140px]">Client Code</TableHead>
                    <TableHead className="min-w-[140px]">Client ID</TableHead>
                    <TableHead className="min-w-[120px]">Status</TableHead>
                    <TableHead className="w-[80px] text-right">Edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {familyAccounts.map((acc, idx) => (
                    <TableRow key={`${acc.clientid}-${idx}`}>
                      <TableCell>{acc.relation}</TableCell>
                      <TableCell className="font-medium">{acc.holderName}</TableCell>
                      <TableCell>{acc.clientcode}</TableCell>
                      <TableCell>{acc.clientid}</TableCell>
                      <TableCell>
                        <Badge variant={acc.status === "Active" ? "secondary" : "outline"} >{acc.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => openEditFor(idx)} aria-label={`Edit ${acc.holderName}`}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Edit Family Account Dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Family Account</DialogTitle>
            <DialogDescription>Update relationship or identifiers for this linked account.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-relation">Relationship</Label>
                <Input
                  id="edit-relation"
                  value={editForm.relation ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, relation: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-holder">Holder Name</Label>
                <Input
                  id="edit-holder"
                  value={editForm.holderName ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, holderName: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-code">Client Code</Label>
                <Input
                  id="edit-code"
                  value={editForm.clientcode ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, clientcode: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-id">Client ID</Label>
                <Input
                  id="edit-id"
                  value={editForm.clientid ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, clientid: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <div className="flex flex-wrap gap-2">
                {(["Active", "Pending KYC", "Dormant"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    className={`${editForm.status === s ? "bg-primary" : "bg-secondary text-primary border-1"} other-class`}
                    onClick={() => setEditForm((f) => ({ ...f, status: s }))}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-primary" onClick={() => setOpenEdit(false)}>
              Cancel
            </Button>
            <Button className="bg-primary" onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
