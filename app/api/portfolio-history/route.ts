// app/api/portfolio-history/route.ts
import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nuvama_code = searchParams.get('nuvama_code');
    
    if (!nuvama_code) {
      return NextResponse.json(
        { success: false, error: "nuvama_code parameter is required" },
        { status: 400 }
      );
    }

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