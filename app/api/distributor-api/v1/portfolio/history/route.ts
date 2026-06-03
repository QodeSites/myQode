import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  authenticateDistributor,
  getDistributorAccounts,
  resolveAccountCodes,
  parseAccountCodeParam,
  DISTRIBUTOR_NAME,
} from "@/lib/distributorApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/distributor-api/v1/portfolio/history?account_code=QAW00098
 * GET /api/distributor-api/v1/portfolio/history?account_code=QAW00098,QGF00090
 *
 * Full time-series (NAV, portfolio value, drawdown, returns, capital flow) per
 * account from pms_master_sheet — drives the portfolio "performance" tab.
 * Without account_code it returns the series for ALL of the distributor's
 * accounts. Always scoped to the distributor's own book.
 */
export async function GET(request: NextRequest) {
  const authError = authenticateDistributor(request);
  if (authError) return authError;

  try {
    const accounts = await getDistributorAccounts();
    const requested = parseAccountCodeParam(request);
    const codes = resolveAccountCodes(accounts, requested);

    if (!codes.length) {
      return NextResponse.json({ distributor: DISTRIBUTOR_NAME, data: [] });
    }

    const result = await query(
      `SELECT account_code, client_name, report_date, nav, portfolio_value,
              drawdown_percent, cash_in_out, prev_nav, pnl, pnl_percent,
              prev_portfolio_value, prev_pnl, period_return_percent,
              cumulative_return_percent
         FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        ORDER BY report_date ASC, account_code ASC`,
      [codes]
    );

    return NextResponse.json({ distributor: DISTRIBUTOR_NAME, data: result.rows });
  } catch (error) {
    console.error("[distributor-api/portfolio/history] error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
