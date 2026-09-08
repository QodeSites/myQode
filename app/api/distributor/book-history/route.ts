import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { query } from "@/lib/db";

/**
 * The daily value of a partner's whole book, with drawdown.
 *
 * WHY THIS EXISTS SEPARATELY FROM /api/distributor/journey
 * The journey payload carries one snapshot per investor — a current value and
 * nothing before it. Drawdown needs a curve, so it cannot be derived there at
 * any cost. This reads pms_master_sheet, which holds a daily portfolio_value
 * per account, and sums the partner's accounts into one book series.
 *
 * Accounts are resolved from pms_clients_master.intermediaryname, matched to
 * the partner's own clientname from their httpOnly session. Nothing the client
 * sends selects an account, so a partner cannot read another's book.
 */

type Point = {
  date: string;
  value: number;
  /** Percent below the running peak, ≤ 0. */
  drawdown: number;
  /** How many accounts priced that day, so thin early history is visible. */
  accounts: number;
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

    // One row per day: the partner's accounts summed into a single book.
    const result = await query(
      `SELECT ms.report_date AS date,
              SUM(ms.portfolio_value)::float8 AS value,
              COUNT(*)::int AS accounts
         FROM public.pms_master_sheet ms
         JOIN pms_clients_master cm ON cm.clientcode = ms.account_code
        WHERE cm.intermediaryname = $1
          AND ms.portfolio_value IS NOT NULL
        GROUP BY ms.report_date
        ORDER BY ms.report_date ASC`,
      [distributor.clientname],
    );

    // Drawdown against the running peak of the book itself. The per-account
    // drawdown_percent column is not summable — a book's drawdown is not the
    // sum of its parts — so it is recomputed here over the aggregate.
    let peak = 0;
    const series: Point[] = (result.rows ?? []).map((r: Record<string, unknown>) => {
      const value = Number(r.value) || 0;
      if (value > peak) peak = value;
      return {
        date: String(r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date).slice(0, 10),
        value,
        drawdown: peak > 0 ? ((value - peak) / peak) * 100 : 0,
        accounts: Number(r.accounts) || 0,
      };
    });

    return NextResponse.json(
      { series, inceptionDate: series[0]?.date ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[distributor/book-history] failed:", err);
    return NextResponse.json(
      { error: "Could not load book history" },
      { status: 500 },
    );
  }
}
