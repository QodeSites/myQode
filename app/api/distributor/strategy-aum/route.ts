import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
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
 * Accounts are matched on intermediaryname against the partner's own
 * clientname from their httpOnly session, so nothing the client sends selects
 * an account.
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
        GROUP BY 1`,
      [distributor.clientname],
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
