import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { getJourneyForDistributor } from "@/lib/zohoDistributorJourney";
import { query } from "@/lib/db";

/**
 * A partner's AUM split by strategy — the real split, not an apportionment.
 *
 * WHY THIS EXISTS
 * The journey payload carries an investor's total value and the names of the
 * strategies they hold, but not how much sits in each. The overview was
 * dividing a value evenly across an investor's strategies, which is wrong
 * whenever the holdings are uneven: that gave One Battalion 36.2/33.5/30.3
 * where the true split is 37.1/35.0/27.8.
 *
 * Each strategy is its own account, identified by the account code prefix
 * (QAW/QGF/QTF), so pms_master_sheet gives the exact figure with no
 * apportionment at all. Verified against the Zoho distributor dashboard, which
 * agrees to the decimal wherever the CRM is current — Nuarch 47.3/52.7, Enso
 * 35.6/64.4, First Quartile 60/40.
 *
 * SCOPED BY ZOHO, NOT BY intermediaryname ALONE.
 * pms_clients_master.intermediaryname is not reliable for attribution: it puts
 * Sharan B Hegde (4.99 Cr across three accounts) under One Battalion, while
 * Zoho does not list him among their investors at all. Scoping on it made the
 * overview read 22.01 Cr against a true 17.02 Cr. Zoho is the system of record
 * for who referred whom, so the account set is intersected with the investor
 * emails Zoho returns for this partner.
 *
 * The distributor is still resolved from the httpOnly session, so nothing the
 * client sends selects an account.
 */

const STRATEGY_BY_PREFIX: Record<string, string> = {
  QAW: "Qode All Weather",
  QGF: "Qode Growth Fund",
  QTF: "Qode Tactical Fund",
};

export async function GET() {
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

    // The investors Zoho attributes to this partner, matched by EMAIL.
    //
    // Not by name: the two systems store names differently enough that a name
    // join silently matches nothing — Postgres has "Anand  Thangaraj" against
    // Zoho's "Anand Thagaraj", and "Chekuri Harikiran" against "Harikiran
    // Chekuri". Email is exact on both sides (61 of 61 in Zoho, 85 of 85 in
    // pms_clients_master) and is the same key the SOA ownership check uses.
    const journey = await getJourneyForDistributor(distributor.email);
    const ownEmails = [
      ...new Set(
        (journey?.clients ?? [])
          .map((c) => String(c.email ?? "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (!ownEmails.length) {
      return NextResponse.json(
        { strategies: [], total: 0, valuedOn: null },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const result = await query(
      `WITH latest AS (
         SELECT DISTINCT ON (ms.account_code)
                ms.account_code, ms.portfolio_value, ms.report_date
           FROM public.pms_master_sheet ms
          WHERE ms.portfolio_value IS NOT NULL
          ORDER BY ms.account_code, ms.report_date DESC
       )
       SELECT SUBSTRING(l.account_code FROM 1 FOR 3) AS prefix,
              COUNT(*)::int AS accounts,
              COUNT(DISTINCT cm.clientname)::int AS investors,
              SUM(l.portfolio_value)::float8 AS value,
              MAX(l.report_date) AS valued_on
         FROM latest l
         JOIN pms_clients_master cm ON cm.clientcode = l.account_code
        WHERE cm.intermediaryname = $1
          AND lower(btrim(cm.email)) = ANY($2)
        GROUP BY 1`,
      [distributor.clientname, ownEmails],
    );

    let total = 0;
    let valuedOn: string | null = null;
    const rows = (result.rows ?? [])
      .map((r: Record<string, unknown>) => {
        const name = STRATEGY_BY_PREFIX[String(r.prefix)] ?? String(r.prefix);
        const value = Number(r.value) || 0;
        total += value;
        const d =
          r.valued_on instanceof Date
            ? r.valued_on.toISOString().slice(0, 10)
            : r.valued_on
              ? String(r.valued_on).slice(0, 10)
              : null;
        if (d && (!valuedOn || d > valuedOn)) valuedOn = d;
        return {
          name,
          value,
          investors: Number(r.investors) || 0,
          accounts: Number(r.accounts) || 0,
          pct: 0,
        };
      })
      .filter((r) => r.value > 0);

    for (const r of rows) r.pct = total > 0 ? (r.value / total) * 100 : 0;
    rows.sort((a, b) => b.value - a.value);

    return NextResponse.json(
      { strategies: rows, total, valuedOn },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[distributor/strategy-aum] failed:", err);
    return NextResponse.json(
      { error: "Could not load the strategy split" },
      { status: 500 },
    );
  }
}
