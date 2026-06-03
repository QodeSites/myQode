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
 * GET /api/distributor-api/v1/portfolio
 *
 * Latest portfolio snapshot + performance metrics for the distributor's
 * accounts. Optional ?account_code=QAW00098 (repeatable / comma-separated)
 * narrows the result to specific accounts — codes not owned by the
 * distributor are ignored.
 */
export async function GET(request: NextRequest) {
  const authError = authenticateDistributor(request);
  if (authError) return authError;

  try {
    const accounts = await getDistributorAccounts();
    const requested = parseAccountCodeParam(request);
    const codes = resolveAccountCodes(accounts, requested);

    if (!codes.length) {
      return NextResponse.json({ distributor: DISTRIBUTOR_NAME, accounts: [] });
    }

    // Latest snapshot per account.
    const latest = await query(
      `SELECT DISTINCT ON (account_code)
              account_code, client_name, report_date, portfolio_value, nav,
              pnl, pnl_percent, drawdown_percent, period_return_percent,
              cumulative_return_percent
         FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        ORDER BY account_code, report_date DESC, created_at DESC`,
      [codes]
    );

    // Invested amount + inception date (first reported flow) per account.
    const agg = await query(
      `SELECT account_code,
              SUM(cash_in_out) AS invested_amount,
              MIN(report_date) AS inception_date
         FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        GROUP BY account_code`,
      [codes]
    );

    const aggMap = new Map<string, any>();
    agg.rows.forEach((r: any) => aggMap.set(r.account_code, r));

    const schemeMap = new Map<string, string | null>();
    accounts.forEach((a) => schemeMap.set(a.clientcode, a.schemename));

    const result = latest.rows.map((r: any) => {
      const a = aggMap.get(r.account_code);
      return {
        account_code: r.account_code,
        client_name: r.client_name,
        scheme: schemeMap.get(r.account_code) ?? null,
        report_date: toISTDate(r.report_date),
        portfolio_value: num(r.portfolio_value),
        invested_amount: num(a?.invested_amount),
        nav: num(r.nav),
        pnl: num(r.pnl),
        pnl_percent: num(r.pnl_percent),
        drawdown_percent: num(r.drawdown_percent),
        period_return_percent: num(r.period_return_percent),
        cumulative_return_percent: num(r.cumulative_return_percent),
        since_inception_date: toISTDate(a?.inception_date),
      };
    });

    return NextResponse.json({ distributor: DISTRIBUTOR_NAME, accounts: result });
  } catch (error) {
    console.error("[distributor-api/portfolio] error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
