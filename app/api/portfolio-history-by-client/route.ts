import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const client_name = searchParams.get("client_name");
    if (!client_name || !client_name.trim()) {
      return NextResponse.json(
        { success: false, error: "client_name parameter is required" },
        { status: 400 }
      );
    }

    // Exclude all account_codes that start with these patterns (QAW%, etc.)
    const permanentExcludes = ["QAW", "QFH", "QTF", "QGF"];
    // This is used to build NOT LIKE conditions
    const excludePatterns = permanentExcludes.map((code) => `${code}%`);
    
    let query: string;
    let params: any[] = [];
    
    // Build dynamic NOT LIKE clauses for each exclude pattern
    const notLikeClauses = excludePatterns
      .map((pattern, idx) => `account_code NOT LIKE $${idx + 2}`)
      .join(' AND ');

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
        ${notLikeClauses ? `AND ${notLikeClauses}` : ''}
      ORDER BY report_date ASC, account_code ASC
    `;

    params.push(`%${client_name.trim()}%`, ...excludePatterns);
    console.log("Executing Portfolio History By Client Query:", query, "with params:", params );
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
