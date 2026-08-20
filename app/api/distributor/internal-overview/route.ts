import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";
import { query } from "@/lib/db";
import {
  getAllDistributorJourneys,
  getDistributorEmailsById,
  STAGE_ORDER,
} from "@/lib/zohoDistributorJourney";

/**
 * Internal overview — every distributor's book in one view.
 *
 * AUTHORIZATION IS ENFORCED HERE, NOT IN MIDDLEWARE.
 * middleware.ts only checks that an admin-session cookie EXISTS; it
 * explicitly defers validation. A forged cookie passes it. So this route
 * validates the session against Redis itself before returning anything.
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.cookies.get("admin-session")?.value;
    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const journeys = await getAllDistributorJourneys();
    const zohoEmails = await getDistributorEmailsById();

    // Portal distributor rows, so the view can show which CRM distributors
    // have no login. clientcode IS NULL is the distributor discriminator —
    // see lib/distributorIdentity.ts for why that is exact.
    const portalResult = await query(
      `SELECT clientname, lower(email) AS email
         FROM pms_clients_master
        WHERE clientcode IS NULL`,
    );
    const portalByEmail = new Map<string, string>();
    for (const row of portalResult.rows ?? []) {
      if (row.email) portalByEmail.set(String(row.email), String(row.clientname));
    }

    const distributors = [];
    const totals: Record<string, number> = {};
    for (const stage of STAGE_ORDER) totals[stage] = 0;
    let zohoOnlyCount = 0;

    for (const journey of journeys.values()) {
      // Coverage check only: does this CRM distributor have a portal login?
      // Matched on email (exact, both Zoho address fields) rather than name,
      // because CRM display names are truncated relative to the portal's.
      // NEVER used for access control — this endpoint is already gated above.
      let portalName: string | null = null;
      let portalEmail: string | null = null;
      for (const addr of zohoEmails.get(journey.zohoId) ?? []) {
        const match = portalByEmail.get(addr);
        if (match) {
          portalName = match;
          portalEmail = addr;
          break;
        }
      }

      const hasPortalLogin = portalName !== null;
      if (!hasPortalLogin) zohoOnlyCount += 1;

      for (const [stage, n] of Object.entries(journey.stageCounts)) {
        totals[stage] = (totals[stage] ?? 0) + n;
      }

      distributors.push({
        zohoId: journey.zohoId,
        zohoName: journey.zohoName,
        portalName,
        email: portalEmail,
        clientCount: journey.clients.length,
        stageCounts: journey.stageCounts,
        hasPortalLogin,
      });
    }

    distributors.sort((a, b) => b.clientCount - a.clientCount);

    return NextResponse.json({ distributors, totals, zohoOnlyCount });
  } catch (error) {
    console.error("[distributor/internal-overview] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
