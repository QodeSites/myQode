import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  resolveDistributorByEmail,
  getDistributorClientCount,
} from "@/lib/distributorIdentity";
import { getJourneyForDistributor } from "@/lib/zohoDistributorJourney";

const ONBOARDING_BASE = "https://onboarding.qodeinvest.com";

/**
 * Builds the partner referral links.
 *
 * The onboarding app serves each partner a short slug path:
 *     onboarding.qodeinvest.com/{slug}       for an individual
 *     onboarding.qodeinvest.com/ni/{slug}    for a company, LLP, HUF or trust
 *
 * The slug is stored (pms_clients_master.referral_slug, migration 008), never
 * computed. It is not a transformation of the name — "First Quartile Private
 * Limited" is `firstquartile`, "FUTUREWISE TECHNOLOGIES PVT LTD" is
 * `futurewisetechno` — and two distributors share one email while having
 * different slugs, so any derivation rule would send one partner's referrals
 * to the other.
 *
 * Returns null when no slug is recorded. The page then says so rather than
 * offering a link that would attribute nothing.
 */
function buildReferralLinks(
  slug: string | null,
): { individual: string; nonIndividual: string } | null {
  if (!slug) return null;
  const s = encodeURIComponent(slug);
  return {
    individual: `${ONBOARDING_BASE}/${s}`,
    nonIndividual: `${ONBOARDING_BASE}/ni/${s}`,
  };
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("qode-user-context")?.value;
    if (!raw) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let email: string | undefined;
    try {
      email = JSON.parse(raw)?.email;
    } catch {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    // Authorization: only a distributor row may read this. An investor email
    // resolves to null and is refused — the portal has no role field, so this
    // lookup IS the role check.
    const distributor = await resolveDistributorByEmail(email);
    if (!distributor) {
      return NextResponse.json({ error: "Not a distributor" }, { status: 403 });
    }

    const portalClientCount = await getDistributorClientCount(distributor.clientname);

    // Zoho is enrichment: if it is unreachable the referral links and portal
    // counts still render. Never let a CRM outage blank the whole page.
    //
    // `crmLinked` distinguishes two cases the UI must not conflate:
    //   - a matched distributor with no referrals yet (journey, no clients)
    //   - a distributor whose login address is on no Zoho record at all
    // Verified 2026-08-21: 3 of 16 distributors fall in the second group,
    // because their portal login differs from their Zoho Email and their
    // Secondary_Email is empty (e.g. Factorlab signs in as
    // sudhamsh@factorlab.in but Zoho holds research@factorlab.in). Telling
    // them "no investors have been referred yet" would be false — they have
    // clients; we simply cannot match them. The fix is to add the login
    // address to Secondary_Email in Zoho, so the UI says exactly that rather
    // than guessing at a name match, which could attribute one distributor's
    // clients to another.
    let journey = null;
    let zohoAvailable = true;
    let crmLinked = true;
    try {
      journey = await getJourneyForDistributor(distributor.email);
      crmLinked = journey !== null;
    } catch (err) {
      console.error("[distributor/journey] Zoho lookup failed:", err);
      zohoAvailable = false;
    }

    // Book totals across their referred investors. Nulls are skipped rather
    // than counted as zero, so a partner whose CRM amounts are unfilled sees
    // no total instead of a misleading zero.
    const clients = journey?.clients ?? [];
    const priced = clients.filter((c) => c.investedAmount != null).length;
    const invested = clients.reduce((sum, c) => sum + (c.investedAmount ?? 0), 0);
    const currentValue = clients.reduce((sum, c) => sum + (c.currentValue ?? 0), 0);

    return NextResponse.json({
      distributor: { name: distributor.clientname, email: distributor.email },
      referralLinks: buildReferralLinks(distributor.referralSlug),
      journey: journey
        ? { clients: journey.clients, stageCounts: journey.stageCounts }
        : null,
      totals: {
        investors: clients.length,
        invested: priced ? invested : null,
        currentValue: priced ? currentValue : null,
        pricedCount: priced,
      },
      zohoAvailable,
      crmLinked,
      portalClientCount,
    });
  } catch (error) {
    console.error("[distributor/journey] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
