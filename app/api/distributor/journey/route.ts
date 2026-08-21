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
 * The distributor is carried as a display name in the URL, prefixed "Mr " —
 * the convention the live links use, including for companies and LLPs. The
 * name comes from pms_clients_master.clientname because that is what matches
 * the live links; Zoho's Name field is truncated and would mis-attribute.
 *
 * Verified 2026-08-20 against the 16 live links: 8 of the 8 whose exact URL
 * was available match character-for-character, including punctuation
 * ("Pvt. Ltd.") and casing ("FUTUREWISE ... PVT LTD").
 *
 * The remaining 8 distributors are labelled differently in the operator's
 * list than in the DB (e.g. DB "ENSO FINSERV LLP" vs listed "Mr EnzoFinserv";
 * DB "First Quartile Private Limited" vs listed "Mr Chedda"). They are the
 * same firms — the email addresses match — but their exact live URL was not
 * available to compare. If attribution misses for one of them, the fix is to
 * store the canonical link on the Zoho Distributor record and read it here,
 * NOT to hand-patch names in this function.
 */
function buildReferralLinks(clientname: string) {
  const param = encodeURIComponent(`Mr ${clientname}`);
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
