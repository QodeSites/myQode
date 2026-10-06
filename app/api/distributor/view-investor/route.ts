// POST /api/distributor/view-investor { clientCode }
// Lets a distributor open one of THEIR investors' portal view. The distributor is resolved from their own
// httpOnly portal session (qode-user-context email + resolveDistributorByEmail), never from the request body,
// and the account must sit in their book (intermediaryname = distributor.clientname). Returns the same kind of
// signed one-time link the backoffice uses (lib/impersonation.ts), recorded against the distributor's email.
import { signedUserContext } from '@/lib/webSession';
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { investorPortalImpersonation } from "@/lib/impersonation";

export async function POST(request: NextRequest) {
  try {
    const raw = (await signedUserContext())?.value;
    if (!raw) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    let sessionEmail: string | undefined;
    try {
      sessionEmail = JSON.parse(raw)?.email;
    } catch {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    const distributor = await resolveDistributorByEmail(sessionEmail);
    if (!distributor) {
      return NextResponse.json({ error: "Not a partner" }, { status: 403 });
    }

    let body: any = {};
    try { body = await request.json(); } catch {}
    const clientCode = typeof body?.clientCode === "string" ? body.clientCode.trim() : "";
    if (!clientCode) {
      return NextResponse.json({ error: "Missing account" }, { status: 400 });
    }

    // Ownership: the account must be in this partner's own book.
    const owned = await query(
      `SELECT 1 FROM pms_clients_master WHERE clientcode = $1 AND intermediaryname = $2 LIMIT 1`,
      [clientCode, distributor.clientname],
    );
    if (owned.rows.length === 0) {
      return NextResponse.json({ error: "This account is not in your book" }, { status: 404 });
    }

    const imp = await investorPortalImpersonation(clientCode, distributor.email, "distributor");
    if (!imp) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, redirectUrl: imp.redirectUrl });
  } catch (error) {
    console.error("[distributor/view-investor]", error);
    return NextResponse.json({ error: "Could not open this account" }, { status: 500 });
  }
}
