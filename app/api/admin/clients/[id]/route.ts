import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import {
  getClientDetail,
  getFamilyMembers,
  getClientAudit,
} from "@/lib/adminClientQueries";
import { updateClient } from "@/lib/adminClientMutations";
import { getInvestorProfile } from "@/lib/zohoInvestorProfile";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireRole(request, "clients");
  if (!isRoleUser(admin)) return admin;

  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const client = await getClientDetail(id);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [family, audit] = await Promise.all([
      client.groupid ? getFamilyMembers(client.groupid) : Promise.resolve([]),
      client.clientid ? getClientAudit(client.clientid) : Promise.resolve([]),
    ]);

    // CRM profile, matched on the client's email. Zoho being unreachable must
    // not break the page — the portal's own record is the substance here and
    // the CRM view is enrichment.
    let zoho = null;
    try {
      zoho = await getInvestorProfile(client.email);
    } catch (err) {
      console.error("[admin/clients/:id] Zoho profile lookup failed:", err);
    }

    return NextResponse.json({ client, family, audit, zoho });
  } catch (error) {
    console.error("[admin/clients/:id] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireRole(request, "clients");
  if (!isRoleUser(admin)) return admin;

  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const patch = (await request.json()) as Record<string, unknown>;
    const result = await updateClient(id, patch, admin);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, changedFields: result.changedFields });
  } catch (error) {
    console.error("[admin/clients/:id] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
