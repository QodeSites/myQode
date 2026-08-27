import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import { setHeadOfFamily } from "@/lib/adminClientMutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupid: string }> },
) {
  const admin = await requireRole(request, "families");
  if (!isRoleUser(admin)) return admin;

  try {
    const { groupid } = await params;
    const body = (await request.json()) as { clientId?: number };
    const clientId = Number(body?.clientId);

    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    const result = await setHeadOfFamily(groupid, clientId, admin);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, cleared: result.cleared });
  } catch (error) {
    console.error("[admin/families/:groupid/head] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
