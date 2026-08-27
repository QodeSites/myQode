import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import { query } from "@/lib/db";
import {
  getAllDistributorJourneys,
  getAllDistributorRecords,
  STAGE_ORDER,
} from "@/lib/zohoDistributorJourney";

/**
 * Internal distributor management view.
 *
 * AUTHORIZATION IS ENFORCED HERE, NOT IN MIDDLEWARE.
 * middleware.ts only checks that an admin-session cookie EXISTS; it
 * explicitly defers validation. A forged cookie passes it. So this route
 * validates the session against Redis itself before returning anything.
 *
 * WHAT THIS RETURNS AND WHY
 * Three datasets are joined, because none alone describes a distributor:
 *   - Zoho Distributor records (140): the relationship — stage, terms, contact
 *     cadence. Includes partners who have never referred anyone.
 *   - Zoho Investors grouped by Primary_distributo (~19 distributors): the
 *     investors they actually referred.
 *   - pms_clients_master (16 rows with clientcode IS NULL): who can log in.
 *
 * The gaps between these three are the actionable part — a distributor in
 * Zoho with no portal login cannot sign in, and one whose login address is on
 * no CRM record gets an empty journey page. Both are surfaced as `issues`
 * rather than left for someone to notice.
 */

/** Today in ISO form, for comparing against Zoho's date-only fields. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  // Distributor-role and super-admin staff only. Validates the session and
  // the role before any query runs.
  const admin = await requireRole(request, "distributor");
  if (!isRoleUser(admin)) return admin;

  try {
    const [records, journeys] = await Promise.all([
      getAllDistributorRecords(),
      getAllDistributorJourneys(),
    ]);

    // Portal distributor rows. clientcode IS NULL is the discriminator — see
    // lib/distributorIdentity.ts for why that is exact.
    const portalResult = await query(
      `SELECT clientname, lower(email) AS email
         FROM pms_clients_master
        WHERE clientcode IS NULL`,
    );
    const portalByEmail = new Map<string, string>();
    for (const row of portalResult.rows ?? []) {
      if (row.email) portalByEmail.set(String(row.email), String(row.clientname));
    }

    // Portal client counts per distributor name, so a partner whose CRM link
    // is broken still shows the book we know they have.
    const countResult = await query(
      `SELECT intermediaryname, COUNT(*)::int AS n
         FROM pms_clients_master
        WHERE clientcode IS NOT NULL
        GROUP BY intermediaryname`,
    );
    const clientCountByName = new Map<string, number>();
    for (const row of countResult.rows ?? []) {
      clientCountByName.set(String(row.intermediaryname), Number(row.n));
    }

    const today = todayIso();
    const matchedPortalEmails = new Set<string>();

    const distributors = records.map((r) => {
      const journey = journeys.get(r.zohoId) ?? null;

      // Exact email match against the portal, checking both Zoho address
      // fields. Never a name match: this data holds rahulshetty42@ and
      // rahulshetty432@ as separate distributors, so a near miss would
      // attribute one partner's book to another.
      let portalName: string | null = null;
      let portalEmail: string | null = null;
      for (const addr of [r.email, r.secondaryEmail]) {
        const key = String(addr ?? "").trim().toLowerCase();
        if (!key) continue;
        const hit = portalByEmail.get(key);
        if (hit) {
          portalName = hit;
          portalEmail = key;
          matchedPortalEmails.add(key);
          break;
        }
      }

      const referredCount = journey?.clients.length ?? 0;
      const portalClientCount = portalName
        ? (clientCountByName.get(portalName) ?? 0)
        : 0;

      // Follow-up is overdue when the CRM's own next-contact date has passed.
      const followUpOverdue = Boolean(r.nextContactDate && r.nextContactDate < today);

      // A partner who can sign in but whose CRM record carries neither of
      // their addresses would see an empty journey page. That is the
      // Factorlab/Futurewise/MyAlternates case.
      const loginUnlinked = !portalName && referredCount > 0;

      return {
        ...r,
        portalName,
        portalEmail,
        hasPortalLogin: portalName !== null,
        referredCount,
        portalClientCount,
        stageCounts: journey?.stageCounts ?? null,
        followUpOverdue,
        loginUnlinked,
      };
    });

    // Portal logins whose address appears on no CRM record at all. These are
    // the distributors who see "we couldn't link this login" on their page.
    const unlinkedLogins = [...portalByEmail.entries()]
      .filter(([email]) => !matchedPortalEmails.has(email))
      .map(([email, clientname]) => ({
        email,
        clientname,
        clientCount: clientCountByName.get(clientname) ?? 0,
      }))
      .sort((a, b) => b.clientCount - a.clientCount);

    // Totals across every referred investor, for the funnel row.
    const investorTotals: Record<string, number> = {};
    for (const stage of STAGE_ORDER) investorTotals[stage] = 0;
    for (const journey of journeys.values()) {
      for (const [stage, n] of Object.entries(journey.stageCounts)) {
        investorTotals[stage] = (investorTotals[stage] ?? 0) + n;
      }
    }

    const summary = {
      totalDistributors: distributors.length,
      withPortalLogin: distributors.filter((d) => d.hasPortalLogin).length,
      withReferrals: distributors.filter((d) => d.referredCount > 0).length,
      overdueFollowUps: distributors.filter((d) => d.followUpOverdue).length,
      missingSecondaryEmail: distributors.filter((d) => !d.secondaryEmail).length,
      unlinkedLoginCount: unlinkedLogins.length,
      totalReferredInvestors: distributors.reduce((s, d) => s + d.referredCount, 0),
    };

    return NextResponse.json({
      summary,
      distributors,
      unlinkedLogins,
      investorTotals,
      stageOrder: STAGE_ORDER,
    });
  } catch (error) {
    console.error("[distributor/internal-overview] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
