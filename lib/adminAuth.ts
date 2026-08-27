import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";
import { resolveRole, canAccess, type Role, type Section } from "@/lib/adminRoles";

/**
 * The acting admin, from their Microsoft SSO session. Every audited write
 * records this, so a change is always attributable to a person.
 */
export type AdminUser = { email: string; name: string };

/**
 * Validates the admin session against Redis and returns the acting admin,
 * or a ready-to-return error response.
 *
 * AUTHORIZATION LIVES HERE, NOT IN MIDDLEWARE. middleware.ts only checks
 * that the admin-session cookie EXISTS — it explicitly defers validation, so
 * a forged cookie passes it. Every handler must call this.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<AdminUser | NextResponse> {
  const sessionId = request.cookies.get("admin-session")?.value;
  if (!sessionId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const session = await getSession(sessionId);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  return {
    email: String(session.user.email),
    name: String(session.user.name ?? session.user.email),
  };
}

/** Narrows the requireAdmin result. Use: `if (!isAdminUser(a)) return a;` */
export function isAdminUser(v: AdminUser | NextResponse): v is AdminUser {
  return !(v instanceof NextResponse);
}

// ---------------------------------------------------------------------------
// Role-based access
// ---------------------------------------------------------------------------

export type AdminUserWithRole = AdminUser & { role: Role };

/**
 * Validates the admin session AND checks the caller's role may reach this
 * section. Returns the acting admin with their role, or a ready-to-return
 * error response.
 *
 * THIS IS THE SECURITY BOUNDARY. The sidebar hides sections a role cannot
 * reach and /admin redirects to their landing page, but both are UX — a
 * distributor-role user who types /api/admin/console must be refused here,
 * not merely be unable to find the link.
 */
export async function requireRole(
  request: NextRequest,
  section: Section,
): Promise<AdminUserWithRole | NextResponse> {
  const admin = await requireAdmin(request);
  if (!isAdminUser(admin)) return admin;

  const role = resolveRole(admin.email);
  if (!canAccess(role, section)) {
    return NextResponse.json(
      { error: "Not available for your role" },
      { status: 403 },
    );
  }

  return { ...admin, role };
}

/** Narrows the requireRole result. Use: `if (!isRoleUser(a)) return a;` */
export function isRoleUser(
  v: AdminUserWithRole | NextResponse,
): v is AdminUserWithRole {
  return !(v instanceof NextResponse);
}
