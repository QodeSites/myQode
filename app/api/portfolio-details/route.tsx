// app/api/portfolio-value/route.ts
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

    // Get the latest portfolio value for the specific nuvama_code
    const query = `
      SELECT 
        id, 
        client_name, 
        account_code, 
        report_date, 
        portfolio_value, 
        cash_in_out, 
        nav, 
        prev_nav, 
        pnl, 
        pnl_percent, 
        exposure_value, 
        prev_portfolio_value, 
        prev_exposure_value, 
        prev_pnl, 
        drawdown_percent, 
        system_tag, 
        period_return_percent, 
        cumulative_return_percent, 
        created_at
      FROM public.pms_master_sheet 
      WHERE account_code = $1 
      ORDER BY report_date DESC, created_at DESC 
      LIMIT 1
    `;

    const result = await pool.query(query, [nuvama_code]);
    
    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "No portfolio data found for this nuvama_code"
      });
    }

    return NextResponse.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Portfolio API Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Alternative endpoint to get portfolio values for multiple nuvama_codes
export async function POST(request: NextRequest) {
  try {
    const { nuvama_codes } = await request.json();
    
    if (!Array.isArray(nuvama_codes) || nuvama_codes.length === 0) {
      return NextResponse.json(
        { success: false, error: "nuvama_codes array is required" },
        { status: 400 }
      );
    }

    // Get latest portfolio values for multiple nuvama_codes
    const placeholders = nuvama_codes.map((_, index) => `$${index + 1}`).join(',');
    const query = `
      WITH ranked_data AS (
        SELECT 
          id, 
          client_name, 
          account_code, 
          report_date, 
          portfolio_value, 
          cash_in_out, 
          nav, 
          prev_nav, 
          pnl, 
          pnl_percent, 
          exposure_value, 
          prev_portfolio_value, 
          prev_exposure_value, 
          prev_pnl, 
          drawdown_percent, 
          system_tag, 
          period_return_percent, 
          cumulative_return_percent, 
          created_at,
          ROW_NUMBER() OVER (PARTITION BY account_code ORDER BY report_date DESC, created_at DESC) as rn
        FROM public.pms_master_sheet 
        WHERE account_code IN (${placeholders})
      )
      SELECT * FROM ranked_data WHERE rn = 1
      ORDER BY account_code
    `;

    const result = await pool.query(query, nuvama_codes);
    
    return NextResponse.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error("Portfolio Bulk API Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}