import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { getJourneyForDistributor } from "@/lib/zohoDistributorJourney";
import { findSoaForInvestor, downloadSoa } from "@/lib/zohoInvestorSoa";

/**
 * Streams an investor's statement of account to the distributor who referred
 * them.
 *
 * THE OWNERSHIP CHECK IS THE SECURITY BOUNDARY.
 * The investor's email arrives as a query parameter, so without this check a
 * partner could read any investor's statement by guessing an address. The
 * requested email must appear in the caller's OWN book — resolved from their
 * httpOnly session, never from anything the client sends.
 *
 * The PDF is streamed through this route rather than redirecting to Zoho's
 * download_Url, so the CRM credentials never reach the browser.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("qode-user-context")?.value;
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
      return NextResponse.json({ error: "Not a distributor" }, { status: 403 });
    }

    const target = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
    if (!target) {
      return NextResponse.json({ error: "Missing investor" }, { status: 400 });
    }

    // Ownership: the investor must be in this partner's own book.
    const journey = await getJourneyForDistributor(distributor.email);
    const owns = (journey?.clients ?? []).some(
      (c) => String(c.email ?? "").trim().toLowerCase() === target,
    );
    if (!owns) {
      // Deliberately the same shape as "no statement": a partner should not be
      // able to probe which addresses exist by comparing error messages.
      return NextResponse.json({ error: "No statement available" }, { status: 404 });
    }

    const soa = await findSoaForInvestor(target);
    if (!soa) {
      return NextResponse.json({ error: "No statement available" }, { status: 404 });
    }

    const file = await downloadSoa(soa.recordId, soa.attachmentId);
    if (!file) {
      return NextResponse.json({ error: "No statement available" }, { status: 404 });
    }

    return new NextResponse(file.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${soa.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[distributor/investor-soa] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
