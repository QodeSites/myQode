import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminUser } from "@/lib/adminAuth";
import { resolveRole, sectionsFor, landingFor } from "@/lib/adminRoles";

/**
 * The signed-in admin and what they may reach. The nav calls this to decide
 * which links to render.
 *
 * Uses requireAdmin rather than requireRole: every authenticated admin may
 * ask who they are, whatever their role.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  const role = resolveRole(admin.email);

  return NextResponse.json({
    email: admin.email,
    name: admin.name,
    role,
    sections: sectionsFor(role),
    landing: landingFor(role),
  });
}
