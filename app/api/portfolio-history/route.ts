// app/api/portfolio-history/route.ts
import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getAuthPayload } from "@/lib/auth-api";

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const nuvama_code = searchParams.get('nuvama_code');
    const nuvama_codes = searchParams.get('nuvama_codes'); // Support multiple codes

    if (!nuvama_code && !nuvama_codes) {
      return NextResponse.json(
        { success: false, error: "nuvama_code or nuvama_codes parameter is required" },
        { status: 400 }
      );
    }

    // Handle multiple account codes
    if (nuvama_codes) {
      const codesArray = nuvama_codes.split(',').map(code => code.trim());

      const query = `
        SELECT
          account_code,
          report_date,
          nav,
          portfolio_value,
          drawdown_percent,
          cash_in_out
        FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        ORDER BY report_date ASC, account_code ASC
      `;

      const result = await pool.query(query, [codesArray]);

      return NextResponse.json({
        success: true,
        data: result.rows,
        isMultiAccount: true
      });
    }

    // Handle single account code (existing functionality)
    const query = `
      SELECT
        report_date,
        nav,
        portfolio_value,
        drawdown_percent,
        cash_in_out
      FROM public.pms_master_sheet
      WHERE account_code = $1
      ORDER BY report_date ASC
    `;

    const result = await pool.query(query, [nuvama_code]);

    return NextResponse.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error("Portfolio History API Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}