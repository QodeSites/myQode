import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { documentBySlug } from "@/lib/distributorDocuments";

/**
 * Streams a Qode marketing document to a signed-in distribution partner.
 *
 * These files live in assets/documents, OUTSIDE public/, so they are not
 * served statically. public/QodePitchDescks already holds a dozen decks that
 * anyone can fetch by guessing the URL; these do not join them. A partner
 * signs in, and the same distributor lookup that guards every other route in
 * this module guards these.
 *
 * The slug is matched against a fixed list rather than used to build a path,
 * so "../../.env" and friends resolve to null and 404 before any file is
 * touched — the list IS the path traversal defence.
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

    const slug = request.nextUrl.searchParams.get("slug")?.trim() ?? "";
    const doc = documentBySlug(slug);
    if (!doc) {
      return NextResponse.json({ error: "No such document" }, { status: 404 });
    }

    const file = path.join(
      process.cwd(),
      "assets",
      "documents",
      `${doc.slug}.pdf`,
    );

    let body: Buffer;
    try {
      body = await readFile(file);
    } catch (err) {
      console.error("[distributor/document] missing file:", file, err);
      return NextResponse.json(
        { error: "That document is unavailable just now" },
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.byteLength),
        // Quoted, since every download name contains spaces.
        "Content-Disposition": `attachment; filename="${doc.downloadName}"`,
        // Partner-specific access, so it must not sit in a shared cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[distributor/document] failed:", err);
    return NextResponse.json(
      { error: "Could not fetch that document" },
      { status: 500 },
    );
  }
}
