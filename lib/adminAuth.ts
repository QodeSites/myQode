import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";

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
