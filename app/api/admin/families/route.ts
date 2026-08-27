import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import { getFamilyGroups } from "@/lib/adminClientQueries";

export async function GET(request: NextRequest) {
  const admin = await requireRole(request, "families");
  if (!isRoleUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const missingHeadOnly = searchParams.get("missingHeadOnly") === "1";

    // Both sets are needed: the full list to browse, and the missing-head
    // count as the headline number even when browsing everything.
    const all = await getFamilyGroups({ missingHeadOnly: false });
    const missingHead = all.filter((g) => g.headCount === 0).length;
    const groups = missingHeadOnly ? all.filter((g) => g.headCount === 0) : all;

    return NextResponse.json({ groups, total: all.length, missingHead });
  } catch (error) {
    console.error("[admin/families] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
