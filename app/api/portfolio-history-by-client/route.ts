// app/api/portfolio-history-by-client/route.ts
// Returns portfolio history rows for accounts matching client name, excluding given clientcodes.
// Same response shape as api/portfolio-history (multi-account).
import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const client_name = searchParams.get("client_name");
    const exclude_clientcodes = searchParams.get("exclude_clientcodes"); // comma-separated e.g. QGF,QAW,QTF,QFH

    if (!client_name || !client_name.trim()) {
      return NextResponse.json(
        { success: false, error: "client_name parameter is required" },
        { status: 400 }
      );
    }

    const excludeList: string[] = exclude_clientcodes
      ? exclude_clientcodes.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // Patterns for "account_code does not contain any of these" (safe parameterized)
    const excludePatterns = excludeList.map((code) => `%${code}%`);

    // Query: search by client_name (ILIKE), exclude account_codes that contain any exclude substring.
    // pms_master_sheet has client_name and account_code.
    let query: string;
    let params: (string | string[])[];

    if (excludePatterns.length === 0) {
      query = `
        SELECT
          account_code,
          report_date,
          nav,
          portfolio_value,
          drawdown_percent,
          cash_in_out
        FROM public.pms_master_sheet
        WHERE client_name ILIKE $1
        ORDER BY report_date ASC, account_code ASC
      `;
      params = [`%${client_name.trim()}%`];
    } else {
      // WHERE client_name ILIKE $1 AND NOT (account_code LIKE ANY($2::text[]))
      query = `
        SELECT
          account_code,
          report_date,
          nav,
          portfolio_value,
          drawdown_percent,
          cash_in_out
        FROM public.pms_master_sheet
        WHERE client_name ILIKE $1
          AND NOT (account_code LIKE ANY($2::text[]))
        ORDER BY report_date ASC, account_code ASC
      `;
      params = [`%${client_name.trim()}%`, excludePatterns];
    }

    const result = await pool.query(query, params);

    return NextResponse.json({
      success: true,
      data: result.rows,
      isMultiAccount: true,
    });
  } catch (error) {
    console.error("Portfolio History By Client API Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
