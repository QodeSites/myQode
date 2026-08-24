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
 * NO SALUTATION. Earlier links carried an "Mr " prefix — applied even to
 * companies and LLPs ("Mr FUTUREWISE TECHNOLOGIES PVT LTD"). Zoho's
 * Distributor module has no salutation field at all: it stores the firm in
 * `Name` and the contact person in First_Name/Last_Name. The prefix was only
 * ever added by this function, so it is gone.
 *
 * Verified against the live onboarding app on 2026-08-21: the un-prefixed
 * name is accepted and echoed back on the rendered page, so attribution is
 * unaffected by the removal.
 *
 * The name comes from pms_clients_master.clientname, not Zoho's `Name`:
 * Zoho's is a shortened display label ("One Battalion Ventures", "Funds
 * India") while the portal holds the full legal name the links use.
 *
 * NOTE: the onboarding app does not validate this parameter — a fabricated
 * firm name is echoed back just as readily as a real one. Attribution is
 * therefore a plain unsigned string, and anyone can edit it. Out of scope
 * here, but it is the reason a signed referral code is worth doing.
 */
function buildReferralLinks(clientname: string) {
  const param = encodeURIComponent(clientname);
  return {
    individual: `${ONBOARDING_BASE}/apply?distributor=${param}`,
    nonIndividual: `${ONBOARDING_BASE}/entity?distributor=${param}`,
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

    return NextResponse.json({
      distributor: { name: distributor.clientname, email: distributor.email },
      referralLinks: buildReferralLinks(distributor.clientname),
      journey: journey
        ? { clients: journey.clients, stageCounts: journey.stageCounts }
        : null,
      zohoAvailable,
      crmLinked,
      portalClientCount,
    });
  } catch (error) {
    console.error("[distributor/journey] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
