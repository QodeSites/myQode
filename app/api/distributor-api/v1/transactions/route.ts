import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  authenticateDistributor,
  getDistributorAccounts,
  resolveAccountCodes,
  parseAccountCodeParam,
  DISTRIBUTOR_NAME,
  toISTDate,
  num,
} from "@/lib/distributorApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/distributor-api/v1/transactions
 *
 * Capital flows (contributions & withdrawals) for the distributor's accounts,
 * derived from pms_master_sheet.cash_in_out — the same flows that drive the
 * portfolio page. Positive = CONTRIBUTION, negative = WITHDRAWAL.
 *
 * Query params (all optional):
 *   account_code  repeatable / comma-separated; narrows to specific accounts
 *   from          ISO date (YYYY-MM-DD) inclusive lower bound on report_date
 *   to            ISO date (YYYY-MM-DD) inclusive upper bound on report_date
 */
export async function GET(request: NextRequest) {
  const authError = authenticateDistributor(request);
  if (authError) return authError;

  try {
    const accounts = await getDistributorAccounts();
    const requested = parseAccountCodeParam(request);
    const codes = resolveAccountCodes(accounts, requested);

    if (!codes.length) {
      return NextResponse.json({ distributor: DISTRIBUTOR_NAME, transactions: [] });
    }

    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const params: any[] = [codes];
    const where = [`account_code = ANY($1)`, `COALESCE(cash_in_out, 0) <> 0`];
    if (from) {
      params.push(from);
      where.push(`report_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`report_date <= $${params.length}`);
    }

    const rows = await query(
      `SELECT account_code, client_name, report_date, cash_in_out,
              portfolio_value, nav
         FROM public.pms_master_sheet
        WHERE ${where.join(" AND ")}
        ORDER BY report_date DESC, account_code`,
      params
    );

    const transactions = rows.rows.map((r: any) => {
      const amount = num(r.cash_in_out);
      return {
        account_code: r.account_code,
        client_name: r.client_name,
        date: toISTDate(r.report_date),
        type: amount >= 0 ? "CONTRIBUTION" : "WITHDRAWAL",
        amount: Math.abs(amount),
        signed_amount: amount,
        portfolio_value_after: num(r.portfolio_value),
        nav: num(r.nav),
      };
    });

    return NextResponse.json({
      distributor: DISTRIBUTOR_NAME,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error("[distributor-api/transactions] error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
