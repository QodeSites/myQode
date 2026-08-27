import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import { searchClients } from "@/lib/adminClientQueries";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? "50") || 50;

    const { rows, total } = await searchClients({
      q: searchParams.get("q") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      page,
      pageSize,
    });

    return NextResponse.json({ rows, total, page, pageSize });
  } catch (error) {
    console.error("[admin/clients] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
