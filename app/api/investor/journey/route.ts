import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getJourneyForInvestor } from "@/lib/zohoInvestorJourney";

/**
 * The signed-in investor's own onboarding journey.
 *
 * Scoped entirely by the httpOnly session cookie — the email is never taken
 * from the request, so one investor cannot ask for another's progress.
 *
 * A null journey is a normal, expected response (no CRM record, or a stage
 * that is deliberately not shown to investors). The client renders nothing in
 * that case rather than treating it as an error.
 */
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

    if (!email) {
      return NextResponse.json({ journey: null }, { status: 200 });
    }

    // Zoho being unreachable must not surface as an error here: the journey is
    // a supplementary section of the portal, and a CRM outage should leave the
    // rest of the page untouched rather than showing a failure banner.
    try {
      const journey = await getJourneyForInvestor(email);
      return NextResponse.json({ journey });
    } catch (err) {
      console.error("[investor/journey] Zoho lookup failed:", err);
      return NextResponse.json({ journey: null });
    }
  } catch (error) {
    console.error("[investor/journey] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
