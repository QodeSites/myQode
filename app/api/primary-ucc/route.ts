// app/api/primary-ucc/route.ts
// ----------------------------------------------------------------------------
// Returns the logged-in investor's primary UCC code(s) for the Nuvama portal
// login notice. See lib/primaryUcc.ts for the resolution ladder and why each
// candidate is validated against the family's own account codes.
//
// The caller sends no identifiers: groups are derived from the session cookie,
// so an investor cannot request another family's primary code.
// ----------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import {
  fetchSignoffRows,
  resolvePrimaryUccsByGroup,
  type ClientRow,
} from "@/lib/primaryUcc";

export async function GET() {
  try {
    const cookieStore = await cookies();
    if (cookieStore.get("qode-auth")?.value !== "1") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = cookieStore.get("qode-user-context")?.value;
    if (!raw) {
      return NextResponse.json({ success: true, primaries: [] });
    }

    let email = "";
    let clientcode = "";
    try {
      const ctx = JSON.parse(raw);
      email = (ctx?.email || "").trim();
      clientcode = (ctx?.clientcode || "").trim();
    } catch {
      return NextResponse.json({ success: true, primaries: [] });
    }
    if (!email && !clientcode) {
      return NextResponse.json({ success: true, primaries: [] });
    }

    // Find every group this investor belongs to, then every member of those
    // groups — the ladder needs the family's full code set to validate against.
    const { rows: seed } = await query(
      `SELECT DISTINCT groupid FROM pms_clients_master
        WHERE clientcode IS NOT NULL
          AND groupid IS NOT NULL
          AND (lower(email) = lower($1) OR clientcode = $2)`,
      [email, clientcode]
    );

    const groupIds = seed.map((r: any) => String(r.groupid).trim()).filter(Boolean);
    if (groupIds.length === 0) {
      return NextResponse.json({ success: true, primaries: [] });
    }

    const { rows: members } = await query(
      `SELECT clientcode, groupid, groupname, head_of_family
         FROM pms_clients_master
        WHERE groupid = ANY($1) AND clientcode IS NOT NULL`,
      [groupIds]
    );

    const signoff = await fetchSignoffRows();
    const primaries = resolvePrimaryUccsByGroup(members as ClientRow[], signoff);

    // Nuvama downtime means portfolio figures lag live markets, so the notice
    // states the date the data is current to. Read from the data rather than
    // hardcoded, so it stays true once the feed catches up.
    let dataAsOf: string | null = null;
    try {
      // Format in Postgres, not JS: report_date is a bare date, and the pg
      // driver hands it back as IST midnight — .toISOString() would shift it
      // to 18:30 UTC the PREVIOUS day and report the wrong date.
      const { rows } = await query(
        `SELECT to_char(max(report_date), 'YYYY-MM-DD') AS latest
           FROM pms_master_sheet`,
        []
      );
      const latest = rows?.[0]?.latest;
      if (latest) dataAsOf = String(latest);
    } catch {
      // Non-fatal: the notice simply omits the as-of line.
    }

    const nameByGroup = new Map<string, string>();
    for (const m of members as any[]) {
      const g = String(m.groupid || "").trim();
      if (g && !nameByGroup.has(g)) nameByGroup.set(g, m.groupname || "");
    }

    return NextResponse.json({
      success: true,
      dataAsOf,
      primaries: primaries.map((p) => ({
        uccCode: p.uccCode,
        strategy: p.strategy,
        groupName: nameByGroup.get(p.groupid) || null,
      })),
    });
  } catch (error) {
    // Advisory notice only — never break the dashboard because the feed is down.
    console.error("primary-ucc error:", error);
    return NextResponse.json({ success: false, primaries: [] });
  }
}
