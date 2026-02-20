import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account_code = searchParams.get("account_code");

    if (!account_code || !account_code.trim()) {
      return NextResponse.json(
        { success: false, error: "account_code parameter is required" },
        { status: 400 }
      );
    }

    const query = `
      SELECT
        id,
        client_name,
        account_code,
        report_date,
        nav,
        portfolio_value,
        drawdown_percent,
        cash_in_out,
        prev_nav,
        pnl,
        pnl_percent,
        prev_portfolio_value,
        prev_pnl,
        period_return_percent,
        cumulative_return_percent,
        created_at
      FROM public.pms_master_sheet
      WHERE account_code = $1
      ORDER BY report_date ASC
    `;

    const result = await pool.query(query, [account_code.trim()]);

    return NextResponse.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Portfolio History By Code API Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
